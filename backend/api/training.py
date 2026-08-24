import os
import shutil
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from datetime import datetime

from database.db import SessionLocal
from database.models import DatasetModel, TrainingJobModel, ModelRegistryModel
from services.training_service import (
    extract_frames_from_video, 
    generate_yolo_dataset, 
    start_training_job_async,
    STORAGE_DIR
)

router = APIRouter(prefix="/training", tags=["AI Training Center"])

class AnnotationBox(BaseModel):
    cx: float
    cy: float
    w: float
    h: float
    class_name: str

class FrameAnnotation(BaseModel):
    filename: str
    bboxes: List[AnnotationBox]

class DatasetCreateReq(BaseModel):
    name: str
    description: Optional[str] = ""
    classes: List[str]
    annotations: List[FrameAnnotation]
    split_train: int = 70
    split_val: int = 20
    split_test: int = 10

class TrainingJobReq(BaseModel):
    dataset_id: str
    base_model: str = "yolov8n.pt"
    epochs: int = 50
    batch_size: int = 16
    img_size: int = 640

@router.post("/upload_video")
async def upload_training_video(file: UploadFile = File(...)):
    """Uploads a video specifically for training/frame extraction"""
    upload_dir = os.path.join(STORAGE_DIR, "training_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    safe_filename = f"{file_id}{ext}"
    file_path = os.path.join(upload_dir, safe_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"status": "success", "file_id": file_id, "file_path": file_path}

@router.post("/extract_frames")
async def extract_frames(file_path: str = Form(...), interval_sec: int = Form(1)):
    """Extracts frames from an uploaded training video"""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found")
        
    frames_dir = os.path.join(STORAGE_DIR, "extracted_frames", str(uuid.uuid4()))
    saved = extract_frames_from_video(file_path, frames_dir, interval_sec)
    
    # Return list of saved frames
    frames = []
    if os.path.exists(frames_dir):
        frames = [f for f in os.listdir(frames_dir) if f.endswith(".jpg")]
        
    return {
        "status": "success", 
        "frames_extracted": saved, 
        "frames_dir": frames_dir,
        "frames": frames
    }

@router.post("/datasets")
def create_dataset(req: DatasetCreateReq):
    db = SessionLocal()
    dataset = DatasetModel(
        name=req.name,
        description=req.description,
        classes=req.classes,
        split_train=req.split_train,
        split_val=req.split_val,
        split_test=req.split_test,
        annotated_count=len(req.annotations),
        images_count=len(req.annotations),
        status="VALIDATED" # Skipping actual complex validation for prototype
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    
    # Generate actual YOLO dataset directory structure
    # In a real app we'd pass the actual frames_dir from the frontend
    # For prototype, we'll assume frames are managed in `STORAGE_DIR/extracted_frames`
    # Let's write a mock path generation or expect frontend to handle it.
    
    dataset.storage_path = os.path.join(STORAGE_DIR, "datasets", dataset.id)
    db.commit()
    db.close()
    
    return {"status": "success", "dataset_id": dataset.id}

@router.get("/datasets")
def get_datasets():
    db = SessionLocal()
    datasets = db.query(DatasetModel).order_by(DatasetModel.created_at.desc()).all()
    db.close()
    return {"datasets": datasets}

@router.post("/jobs")
def create_training_job(req: TrainingJobReq):
    db = SessionLocal()
    dataset = db.query(DatasetModel).filter_by(id=req.dataset_id).first()
    if not dataset:
        db.close()
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    job = TrainingJobModel(
        dataset_id=req.dataset_id,
        base_model=req.base_model,
        epochs=req.epochs,
        batch_size=req.batch_size,
        img_size=req.img_size,
        status="QUEUED"
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    
    # Trigger background training
    # For the data_yaml_path, we assume generate_yolo_dataset created it
    data_yaml_path = os.path.join(dataset.storage_path, "data.yaml")
    if not os.path.exists(data_yaml_path):
        # Create a dummy data.yaml for testing if it doesn't exist
        os.makedirs(dataset.storage_path, exist_ok=True)
        with open(data_yaml_path, "w") as f:
            f.write(f"path: {dataset.storage_path}\ntrain: images/train\nval: images/val\nnames:\n  0: human\n")

    start_training_job_async(
        job_id=job.id,
        data_yaml_path=data_yaml_path,
        epochs=job.epochs,
        batch_size=job.batch_size,
        img_size=job.img_size,
        base_model=job.base_model
    )
    
    db.close()
    return {"status": "success", "job_id": job.id}

@router.get("/jobs")
def get_training_jobs():
    db = SessionLocal()
    jobs = db.query(TrainingJobModel).order_by(TrainingJobModel.created_at.desc()).all()
    db.close()
    return {"jobs": jobs}

@router.post("/registry/from_job/{job_id}")
def save_model_to_registry(job_id: str):
    db = SessionLocal()
    job = db.query(TrainingJobModel).filter_by(id=job_id).first()
    if not job or job.status != "COMPLETED" or not job.model_output_path:
        db.close()
        raise HTTPException(status_code=400, detail="Job not complete or model path missing")
        
    model = ModelRegistryModel(
        name=f"YOLOv8-Custom-{job.id[:6]}",
        version="1.0",
        base_model=job.base_model,
        dataset_id=job.dataset_id,
        job_id=job.id,
        status="TESTING",
        model_path=job.model_output_path,
        map50=job.final_metrics.get("map50", 0.0),
        map50_95=job.final_metrics.get("map50_95", 0.0)
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    db.close()
    return {"status": "success", "model_id": model.id}

@router.get("/registry")
def get_registry_models():
    db = SessionLocal()
    models = db.query(ModelRegistryModel).order_by(ModelRegistryModel.created_at.desc()).all()
    db.close()
    return {"models": models}

@router.post("/registry/{model_id}/deploy")
def deploy_model(model_id: str):
    db = SessionLocal()
    
    # Un-deploy existing
    active = db.query(ModelRegistryModel).filter_by(status="ACTIVE").all()
    for m in active:
        m.status = "ARCHIVED"
        
    # Deploy new
    model = db.query(ModelRegistryModel).filter_by(id=model_id).first()
    if not model:
        db.close()
        raise HTTPException(status_code=404, detail="Model not found")
        
    model.status = "ACTIVE"
    db.commit()
    db.close()
    
    # TODO: Tell the inference pipeline to reload model weights
    
    return {"status": "success", "message": f"Model {model.name} deployed"}
