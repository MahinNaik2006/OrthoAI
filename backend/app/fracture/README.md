# Experimental rib and shoulder fracture segmentation

This package contains an experimental 3D binary CNN that can be trained to mark
fracture voxels in **rib-cage** or **shoulder-girdle** CTs. Shoulder masks should
cover the target fractures in the proximal humerus, clavicle, and scapula /
glenoid. The model does not classify fracture type, identify which bone is
broken, or plan treatment. It is a training pipeline, not a pretrained or
clinically validated model. Until a compatible checkpoint is trained and
installed, CT uploads report `not_trained` and no fracture overlay is drawn.

I found no publicly verifiable Hugging Face checkpoint for 3D shoulder/rib CT
fracture segmentation. The available RibFrac dataset listing is data, not a
pretrained model; its license is non-commercial. The app does not download
training datasets automatically.

## Data format and licensing

Use paired 3D NIfTI CT scans and binary or instance-label NIfTI masks. Each
mask must be in the same physical space as its CT; positive mask values are
treated as fracture foreground. Shoulder masks must include voxel-level
fracture regions in the shoulder bones, not just a fracture/no-fracture
patient label. Keep all scans from one patient within one split. The CSV
manifest requires `image,label,split,region,patient_id`; `region` is `rib` or
`shoulder`, `split` is `train` or `validation`, and paths are relative to the
manifest. Patient IDs are required to reject train/validation leakage. See
`manifest.example.csv`. Each trained region must have a fracture-positive
validation scan.
This pipeline assumes Hounsfield-unit-like CT values and applies the same
fixed intensity window during training and inference. Confirm image scaling
before training. Add accurately labeled fracture-free scans to training and
validation where possible to measure false positives. The public RibFrac
training partition is fracture-positive only, so RibFrac alone may not teach
adequate specificity. For multi-region training, provide data and annotations
for **both** regions in both splits; otherwise the model is scoped only to the
region actually represented.

The Hugging Face
[MedOtter/RibFrac2020 dataset](https://huggingface.co/datasets/MedOtter/RibFrac2020)
describes 500 annotated rib CTs with NIfTI images and masks and declares
**CC BY-NC 4.0**. Verify terms and intended-use suitability before use. This
dataset only covers ribs; it cannot provide shoulder training examples.
The script binarizes instance masks (`mask > 0`) and does not train fracture
type classes.

## Train

From the `backend` directory, after preparing your own manifest and data:

```powershell
python -m app.fracture.train --manifest path\to\manifest.csv --epochs 50 --device auto
```

Training uses canonical RAS orientation, resamples CT/masks to 2 mm, clips and
normalizes CT values to `[0, 1]`, and samples 64³ patches. The training loop
balances sampling between represented regions, favors fracture and
perilesional hard-negative patches, adds spatial/intensity augmentation, and
uses a positive-weighted BCE + soft-Dice loss with learning-rate reduction and
early stopping. It selects the checkpoint by macro mean Dice over
fracture-positive, full-volume validation cases (per-region results and
fracture-free false-positive rate are logged). This is a development metric,
not a held-out clinical evaluation.

The best checkpoint is saved to
`%LOCALAPPDATA%\ORTHO_AI\models\fracture_segmentation\model.pt` by default.
`ORTHO_AI_MODEL_DIR` changes the model-cache root. CPU training can be very
slow; `--device cuda` requires CUDA-enabled PyTorch.

Restart the backend after a checkpoint has been trained. On Patients or
Imaging, select **Shoulder girdle** or **Rib cage** to match the uploaded CT.
The API runs sliding-window inference only when that region was present during
training. Predicted candidate voxels are rendered red over the 3D surface
when available. No-candidate output does not rule out fracture. Checkpoint
integrity and region scope are checked before use.

## Limits

Accuracy cannot be made or claimed without representative labeled shoulder
and rib CTs, rigorous patient-separated external testing, and review of
false-positive and missed-fracture cases. Metrics produced by this training
script do not establish clinical validity. Predicted regions are research
candidates only, require expert review, and must not be used to guide patient
care.
