# MONAI whole-body CT anatomy visualization

The CT upload route can run the MONAI Model Zoo `wholeBody_ct_segmentation`
low-resolution checkpoint on the local CPU. It segments anatomical classes,
including ribs and vertebrae, then creates separate 3D bone surfaces for
visualization. It does not have a fracture label, detect a fracture, infer
fragment displacement, or propose a surgical repair.

When inference succeeds, the Imaging page also exposes axial slices from the
same 3 mm resampled volume with optional overlays for the grouped anatomy
labels. The slice endpoint is
`GET /api/cases/{case_id}/slices/{slice_index}?overlay=true`; the overlay is
anatomy segmentation, not fracture localization. The displayed NIfTI value
range is not assumed to be Hounsfield units because NIfTI headers do not
guarantee a consistent intensity scale.

The pinned checkpoint is cached outside the source tree at
`%LOCALAPPDATA%/ORTHO_AI/models/wholeBody_ct_segmentation/model_lowres.pt`
on Windows. Its SHA-256 is checked before loading. Set `ORTHO_AI_MODEL_DIR`
to choose another cache root; the model subdirectory and filename remain the
same.

The MONAI bundle is Apache-2.0. Its model card identifies TotalSegmentator as
its training data source, and the cited [TotalSegmentator dataset is CC-BY
4.0](https://zenodo.org/records/6802614). Preserve attribution to Jakob
Wasserthal and the dataset citation when distributing this application or
model-derived materials. See the [model card](https://huggingface.co/MONAI/wholeBody_ct_segmentation)
and [dataset record](https://zenodo.org/records/6802614).

MONAI marks the bundle as an example not intended for diagnostic use. CPU
inference may be slow and resource intensive. Outputs are for visualization
and require clinician review; no clinical claim is made.
