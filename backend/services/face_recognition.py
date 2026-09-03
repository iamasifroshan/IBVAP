import os
import urllib.request
import logging
import cv2
import numpy as np
from sqlalchemy.orm import Session
from config import settings
from database.models import RegisteredPersonModel

logger = logging.getLogger("ibvap.face_recognition")

class FaceRecognitionService:
    def __init__(self):
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        models_dir = os.path.join(backend_dir, "models")
        os.makedirs(models_dir, exist_ok=True)

        self.detector_path = os.path.join(models_dir, "face_detection_yunet_2023mar.onnx")
        self.recognizer_path = os.path.join(models_dir, "face_recognition_sface_2021dec.onnx")

        self.detector = None
        self.recognizer = None
        self.initialized = False

    def download_models_if_missing(self):
        """
        Downloads YuNet and SFace ONNX models if they are not already locally present.
        """
        try:
            if not os.path.exists(self.detector_path):
                logger.info(f"Downloading face detection model (YuNet) from {settings.FACE_DETECTOR_MODEL_URL}...")
                urllib.request.urlretrieve(settings.FACE_DETECTOR_MODEL_URL, self.detector_path)
                logger.info("Face detection model downloaded successfully.")

            if not os.path.exists(self.recognizer_path):
                logger.info(f"Downloading face recognition model (SFace) from {settings.FACE_RECOGNIZER_MODEL_URL}...")
                urllib.request.urlretrieve(settings.FACE_RECOGNIZER_MODEL_URL, self.recognizer_path)
                logger.info("Face recognition model downloaded successfully.")
        except Exception as e:
            logger.error(f"Failed to download face recognition models: {e}")
            # Do not raise error yet, let model initialization fail if files are missing

    def load_models(self):
        """
        Initializes the YuNet detector and SFace recognizer.
        """
        if self.initialized:
            return

        self.download_models_if_missing()

        if not os.path.exists(self.detector_path) or not os.path.exists(self.recognizer_path):
            raise FileNotFoundError("YuNet or SFace model files are missing and could not be downloaded.")

        try:
            # Create YuNet detector
            # input_size is set to a dummy (320, 320) initially, will update dynamically
            self.detector = cv2.FaceDetectorYN.create(
                model=self.detector_path,
                config="",
                input_size=(320, 320),
                score_threshold=0.5,
                nms_threshold=0.3,
                top_k=5000,
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU
            )

            # Create SFace recognizer
            self.recognizer = cv2.FaceRecognizerSF.create(
                model=self.recognizer_path,
                config="",
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU
            )

            self.initialized = True
            logger.info("Face recognition service models loaded successfully.")
        except Exception as e:
            logger.error(f"Error loading face recognition models: {e}")
            raise RuntimeError(f"Face recognition models initialization failed: {e}")

    def detect_faces(self, frame: np.ndarray):
        """
        Detects faces in a BGR frame.
        Returns: (retval, faces)
        """
        if not self.initialized:
            self.load_models()

        if frame is None or frame.size == 0:
            return False, None

        h, w, c = frame.shape
        self.detector.setInputSize((w, h))
        retval, faces = self.detector.detect(frame)
        return retval, faces

    def extract_embedding(self, frame: np.ndarray, face: np.ndarray) -> list[float]:
        """
        Aligns a face and extracts its 128-dimensional embedding.
        """
        if not self.initialized:
            self.load_models()

        face_aligned = self.recognizer.alignCrop(frame, face)
        embedding = self.recognizer.feature(face_aligned)
        return embedding[0].tolist()

    def compare_embeddings(self, emb1: list[float], emb2: list[float]) -> float:
        """
        Computes the cosine similarity between two embeddings.
        Returns: cosine similarity float score.
        """
        if not self.initialized:
            self.load_models()

        emb1_arr = np.array(emb1, dtype=np.float32).reshape(1, 128)
        emb2_arr = np.array(emb2, dtype=np.float32).reshape(1, 128)
        similarity = self.recognizer.match(emb1_arr, emb2_arr, cv2.FaceRecognizerSF_FR_COSINE)
        return float(similarity)

    def recognize_faces(self, frame: np.ndarray, db: Session) -> list[dict]:
        """
        Detects and recognizes faces in a frame against active registered people and all their references.
        """
        if not self.initialized:
            self.load_models()

        results = []
        retval, faces = self.detect_faces(frame)
        if not retval or faces is None:
            return results

        # Fetch active registered users and eagerly load references
        registered_users = db.query(RegisteredPersonModel).filter(RegisteredPersonModel.is_active == True).all()

        threshold = settings.FACE_RECOGNITION_THRESHOLD
        high_conf = settings.FACE_RECOGNITION_HIGH_CONFIDENCE
        med_conf = settings.FACE_RECOGNITION_MEDIUM_CONFIDENCE

        for face in faces:
            # Extract box and detection score
            x, y, w, h = map(int, face[0:4])
            bbox = [x, y, w, h]
            face_det_score = float(face[14]) if len(face) > 14 else 0.90

            # Extract embedding
            try:
                emb = self.extract_embedding(frame, face)
            except Exception as e:
                logger.error(f"Failed to extract embedding for face box {bbox}: {e}")
                results.append({
                    "person_id": None,
                    "name": None,
                    "identity_code": None,
                    "recognized": False,
                    "confidence": 0.0,
                    "recognition_confidence": 0.0,
                    "face_detection_confidence": round(face_det_score, 4),
                    "confidence_level": "UNKNOWN",
                    "identity_status": "FACE_PROCESSING_ERROR",
                    "matched_reference_id": None,
                    "bounding_box": bbox,
                    "error": str(e)
                })
                continue

            best_match = None
            best_score = -1.0
            best_ref_id = None

            for user in registered_users:
                # Gather all reference embeddings for this user
                refs = user.references if user.references else []
                if refs:
                    for ref in refs:
                        if ref.face_embedding:
                            sim = self.compare_embeddings(emb, ref.face_embedding)
                            if sim > best_score:
                                best_score = sim
                                best_match = user
                                best_ref_id = ref.id
                elif user.face_embedding:
                    # Fallback to direct embedding if user has no references table entries
                    sim = self.compare_embeddings(emb, user.face_embedding)
                    if sim > best_score:
                        best_score = sim
                        best_match = user
                        best_ref_id = None

            # Determine identity and confidence level
            if best_match and best_score >= threshold:
                if best_score >= high_conf:
                    conf_level = "HIGH"
                elif best_score >= med_conf:
                    conf_level = "MEDIUM"
                else:
                    conf_level = "LOW"

                results.append({
                    "person_id": best_match.person_id,
                    "name": best_match.name,
                    "identity_code": best_match.identity_code,
                    "recognized": True,
                    "confidence": round(best_score, 4),
                    "recognition_confidence": round(best_score, 4),
                    "face_detection_confidence": round(face_det_score, 4),
                    "confidence_level": conf_level,
                    "identity_status": "KNOWN",
                    "matched_reference_id": best_ref_id,
                    "bounding_box": bbox
                })
            else:
                results.append({
                    "person_id": None,
                    "name": "UNKNOWN",
                    "identity_code": None,
                    "recognized": False,
                    "confidence": round(max(0.0, best_score), 4) if best_score != -1.0 else 0.0,
                    "recognition_confidence": round(max(0.0, best_score), 4) if best_score != -1.0 else 0.0,
                    "face_detection_confidence": round(face_det_score, 4),
                    "confidence_level": "UNKNOWN",
                    "identity_status": "UNKNOWN",
                    "matched_reference_id": None,
                    "bounding_box": bbox
                })

        return results


face_recognition_service = FaceRecognitionService()
