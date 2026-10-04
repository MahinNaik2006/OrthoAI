from app.fracture.rib import (
    CHECKPOINT_PATH as RIB_FRACTURE_CHECKPOINT_PATH,
    MODEL_NAME as RIB_FRACTURE_MODEL_NAME,
    MODEL_VERSION as RIB_FRACTURE_MODEL_VERSION,
)
from app.monai.wholebody import CHECKPOINT_PATH, MODEL_REPOSITORY, MODEL_REVISION

MODEL_REGISTRY = [
    {
        "name": "MONAI Whole Body CT Segmentation",
        "version": MODEL_REVISION[:12],
        "supported_anatomy": "104 whole-body labels, including bones, ribs, and vertebrae",
        "supported_modality": "CT",
        "training_dataset": "TotalSegmentator",
        "checkpoint": "Installed" if CHECKPOINT_PATH.is_file() else "Not installed",
        "model_card": f"https://huggingface.co/{MODEL_REPOSITORY}",
        "license": "Apache-2.0 bundle; cited TotalSegmentator data CC-BY-4.0",
        "status": "Anatomy segmentation only; no fracture label",
    },
    {
        "name": RIB_FRACTURE_MODEL_NAME,
        "version": RIB_FRACTURE_MODEL_VERSION,
        "supported_anatomy": "Rib cage and shoulder girdle (requires matching labeled training CTs)",
        "supported_modality": "3D CT",
        "training_dataset": "User-supplied paired NIfTI CT and fracture masks; no built-in pretrained weights",
        "checkpoint": "Installed" if RIB_FRACTURE_CHECKPOINT_PATH.is_file() else "Not trained",
        "model_card": "https://huggingface.co/datasets/MedOtter/RibFrac2020",
        "license": "Depends on training data; RibFrac2020 is CC BY-NC 4.0",
        "status": (
            "Experimental candidate segmentation; research visualization only"
            if RIB_FRACTURE_CHECKPOINT_PATH.is_file()
            else "Training pipeline available; no pretrained checkpoint"
        ),
    },
]
