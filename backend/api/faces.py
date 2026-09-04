import os
import uuid
import cv2
import numpy as np
import json
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from database.db import get_db
from database.models import RegisteredPersonModel, FaceReferenceModel
from database.schemas import (
    RegisteredPersonResponse,
    FaceRecognitionResponse,
    RegisteredPersonUpdate,
    FaceReferenceResponse,
)
from services.face_recognition import face_recognition_service
from config import settings

router = APIRouter(
    prefix="/faces",
    tags=["Face Recognition"]
)

def _enrich_person_response(db_person: RegisteredPersonModel) -> RegisteredPersonResponse:
    refs = db_person.references if db_person.references else []
    ref_schemas = [FaceReferenceResponse.model_validate(r) for r in refs]
    resp = RegisteredPersonResponse(
        id=db_person.id,
        person_id=db_person.person_id,
        name=db_person.name,
        identity_code=db_person.identity_code,
        is_active=db_person.is_active,
        image_path=db_person.image_path,
        references_count=len(refs),
        references=ref_schemas,
        created_at=db_person.created_at,
        updated_at=db_person.updated_at
    )
    return resp

@router.post("/register", response_model=RegisteredPersonResponse, status_code=201)
async def register_face(
    name: str = Form(...),
    identity_code: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Registers a new person and their primary face reference representation.
    Requires uploading a clear, single-face image.
    """
    # 1. Read file contents and decode into CV2 image
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if frame is None or frame.size == 0:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    # 2. Run face detection
    retval, faces = face_recognition_service.detect_faces(frame)
    if not retval or faces is None or len(faces) == 0:
        raise HTTPException(status_code=400, detail="No face detected in the image.")
    if len(faces) > 1:
        raise HTTPException(status_code=400, detail="Multiple faces detected. Please upload an image with a single person.")

    # 3. Check for unique identity code
    if identity_code:
        existing = db.query(RegisteredPersonModel).filter(
            RegisteredPersonModel.identity_code == identity_code
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Person with this identity code is already registered.")

    # 4. Extract embedding
    face = faces[0]
    try:
        embedding = face_recognition_service.extract_embedding(frame, face)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process face embedding: {str(e)}")

    # 5. Save reference image to disk
    person_id = f"person_{str(uuid.uuid4())[:8]}"
    os.makedirs(settings.FACE_STORAGE_DIR, exist_ok=True)
    filename = f"{person_id}.jpg"
    image_path = os.path.join(settings.FACE_STORAGE_DIR, filename)
    
    # Save image file safely
    cv2.imwrite(image_path, frame)

    # 6. Save metadata, primary reference, and embedding list to database
    db_person = RegisteredPersonModel(
        person_id=person_id,
        name=name,
        identity_code=identity_code,
        face_embedding=embedding,
        image_path=image_path,
        is_active=True
    )
    db.add(db_person)

    ref_id = f"ref_{str(uuid.uuid4())[:8]}"
    db_ref = FaceReferenceModel(
        id=ref_id,
        person_id=person_id,
        face_embedding=embedding,
        image_path=image_path
    )
    db.add(db_ref)

    db.commit()
    db.refresh(db_person)

    return _enrich_person_response(db_person)

@router.get("/", response_model=List[RegisteredPersonResponse])
def list_registered_people(
    active_only: bool = True,
    db: Session = Depends(get_db)
):
    """
    Lists all registered individuals with reference counts.
    """
    query = db.query(RegisteredPersonModel)
    if active_only:
        query = query.filter(RegisteredPersonModel.is_active == True)
    people = query.all()
    return [_enrich_person_response(p) for p in people]

@router.get("/{person_id}", response_model=RegisteredPersonResponse)
def get_person(
    person_id: str,
    db: Session = Depends(get_db)
):
    """
    Gets details of a registered person by person_id.
    """
    person = db.query(RegisteredPersonModel).filter(
        RegisteredPersonModel.person_id == person_id
    ).first()
    
    if not person:
        raise HTTPException(status_code=404, detail="Registered person not found.")
    return _enrich_person_response(person)

@router.put("/{person_id}", response_model=RegisteredPersonResponse)
async def update_person(
    person_id: str,
    name: Optional[str] = Form(None),
    identity_code: Optional[str] = Form(None),
    is_active: Optional[bool] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """
    Updates details or the reference face image of a registered person.
    """
    db_person = db.query(RegisteredPersonModel).filter(
        RegisteredPersonModel.person_id == person_id
    ).first()
    
    if not db_person:
        raise HTTPException(status_code=404, detail="Registered person not found.")

    # 1. Update basic fields
    if name is not None:
        db_person.name = name
    if identity_code is not None:
        # Check uniqueness
        if identity_code != db_person.identity_code:
            existing = db.query(RegisteredPersonModel).filter(
                RegisteredPersonModel.identity_code == identity_code
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="Person with this identity code is already registered.")
        db_person.identity_code = identity_code
    if is_active is not None:
        db_person.is_active = is_active

    # 2. Process new face image if uploaded
    if file is not None:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None or frame.size == 0:
            raise HTTPException(status_code=400, detail="Invalid image file.")

        retval, faces = face_recognition_service.detect_faces(frame)
        if not retval or faces is None or len(faces) == 0:
            raise HTTPException(status_code=400, detail="No face detected in the image.")
        if len(faces) > 1:
            raise HTTPException(status_code=400, detail="Multiple faces detected. Registration requires a single person.")

        # Extract new embedding
        face = faces[0]
        try:
            embedding = face_recognition_service.extract_embedding(frame, face)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to process face embedding: {str(e)}")

        # Save and overwrite primary image
        os.makedirs(settings.FACE_STORAGE_DIR, exist_ok=True)
        image_path = db_person.image_path or os.path.join(settings.FACE_STORAGE_DIR, f"{person_id}.jpg")
        cv2.imwrite(image_path, frame)

        # Update model
        db_person.face_embedding = embedding
        db_person.image_path = image_path

        # Add to face_references
        ref_id = f"ref_{str(uuid.uuid4())[:8]}"
        db_ref = FaceReferenceModel(
            id=ref_id,
            person_id=person_id,
            face_embedding=embedding,
            image_path=image_path
        )
        db.add(db_ref)

    db_person.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(db_person)
    return _enrich_person_response(db_person)

@router.post("/{person_id}/references", response_model=FaceReferenceResponse, status_code=201)
async def add_face_reference(
    person_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Adds a new face reference image & embedding to an existing registered person.
    """
    db_person = db.query(RegisteredPersonModel).filter(
        RegisteredPersonModel.person_id == person_id
    ).first()
    if not db_person:
        raise HTTPException(status_code=404, detail="Registered person not found.")

    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None or frame.size == 0:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    retval, faces = face_recognition_service.detect_faces(frame)
    if not retval or faces is None or len(faces) == 0:
        raise HTTPException(status_code=400, detail="No face detected in the image.")
    if len(faces) > 1:
        raise HTTPException(status_code=400, detail="Multiple faces detected. Reference upload requires an image with a single person.")

    face = faces[0]
    try:
        embedding = face_recognition_service.extract_embedding(frame, face)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process face embedding: {str(e)}")

    ref_id = f"ref_{str(uuid.uuid4())[:8]}"
    os.makedirs(settings.FACE_STORAGE_DIR, exist_ok=True)
    filename = f"{person_id}_ref_{ref_id}.jpg"
    image_path = os.path.join(settings.FACE_STORAGE_DIR, filename)
    cv2.imwrite(image_path, frame)

    db_ref = FaceReferenceModel(
        id=ref_id,
        person_id=person_id,
        face_embedding=embedding,
        image_path=image_path
    )
    db.add(db_ref)

    db_person.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(db_ref)

    return db_ref

@router.get("/{person_id}/references", response_model=List[FaceReferenceResponse])
def list_face_references(
    person_id: str,
    db: Session = Depends(get_db)
):
    """
    Lists all face references for a registered person.
    """
    db_person = db.query(RegisteredPersonModel).filter(
        RegisteredPersonModel.person_id == person_id
    ).first()
    if not db_person:
        raise HTTPException(status_code=404, detail="Registered person not found.")

    refs = db.query(FaceReferenceModel).filter(
        FaceReferenceModel.person_id == person_id
    ).all()
    return refs

@router.delete("/{person_id}/references/{reference_id}", status_code=200)
def delete_face_reference(
    person_id: str,
    reference_id: str,
    db: Session = Depends(get_db)
):
    """
    Deletes a specific face reference image & embedding for a person.
    Active persons must retain at least one face reference.
    """
    db_person = db.query(RegisteredPersonModel).filter(
        RegisteredPersonModel.person_id == person_id
    ).first()
    if not db_person:
        raise HTTPException(status_code=404, detail="Registered person not found.")

    db_ref = db.query(FaceReferenceModel).filter(
        FaceReferenceModel.id == reference_id,
        FaceReferenceModel.person_id == person_id
    ).first()
    if not db_ref:
        raise HTTPException(status_code=404, detail="Face reference not found.")

    # Active person constraint check
    if db_person.is_active:
        ref_count = db.query(FaceReferenceModel).filter(
            FaceReferenceModel.person_id == person_id
        ).count()
        if ref_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the last remaining face reference for an active registered person."
            )

    # Remove image file from disk if present
    if db_ref.image_path and os.path.exists(db_ref.image_path):
        try:
            os.remove(db_ref.image_path)
        except Exception:
            pass

    db.delete(db_ref)
    db.commit()

    return {"message": "Face reference deleted successfully.", "reference_id": reference_id}

@router.delete("/{person_id}", status_code=200)
def delete_person(
    person_id: str,
    db: Session = Depends(get_db)
):
    """
    Permanently deletes a registered person and all their reference face files.
    """
    db_person = db.query(RegisteredPersonModel).filter(
        RegisteredPersonModel.person_id == person_id
    ).first()
    
    if not db_person:
        raise HTTPException(status_code=404, detail="Registered person not found.")

    # Remove main image file from disk if it exists
    if db_person.image_path and os.path.exists(db_person.image_path):
        try:
            os.remove(db_person.image_path)
        except Exception:
            pass

    # Remove reference images from disk
    if db_person.references:
        for ref in db_person.references:
            if ref.image_path and os.path.exists(ref.image_path):
                try:
                    os.remove(ref.image_path)
                except Exception:
                    pass

    db.delete(db_person)
    db.commit()
    
    return {"message": "Registered person deleted successfully.", "person_id": person_id}

@router.post("/recognize", response_model=List[FaceRecognitionResponse])
async def recognize_faces(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Analyzes an uploaded image/frame and attempts to recognize all faces.
    Returns: A list of matching or UNKNOWN face representations.
    """
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if frame is None or frame.size == 0:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    results = face_recognition_service.recognize_faces(frame, db)
    return results

