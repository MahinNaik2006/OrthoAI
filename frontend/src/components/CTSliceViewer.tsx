import { useState } from 'react';
import { Layers3, ScanLine } from 'lucide-react';
import { getCTSliceUrl } from '../services/api';

const SEGMENTATION_LABELS = [
  { name: 'Ribs', color: '#46c8f0' },
  { name: 'Vertebrae and sacrum', color: '#dce5ef' },
  { name: 'Other modeled bones', color: '#a58bfa' },
];

export function CTSliceViewer({
  caseId,
  sliceCount,
  spacingMm,
}: {
  caseId: string;
  sliceCount: number;
  spacingMm: number;
}) {
  const [sliceIndex, setSliceIndex] = useState(Math.floor(sliceCount / 2));
  const [showOverlay, setShowOverlay] = useState(true);
  const [imageError, setImageError] = useState(false);
  const imageUrl = getCTSliceUrl(caseId, sliceIndex, showOverlay);

  return (
    <section className="panel ct-slices-panel">
      <div className="playground-heading">
        <div>
          <p className="eyebrow">Axial view · MONAI anatomy labels</p>
          <h2>CT slice segmentation</h2>
          <p>Scroll through resampled CT slices with the model’s anatomy labels overlaid.</p>
        </div>
        <label className="ct-overlay-toggle">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(event) => {
              setShowOverlay(event.target.checked);
              setImageError(false);
            }}
          />
          <Layers3 size={16} />
          Anatomy overlay
        </label>
      </div>

      <div className="ct-slice-image-frame">
        {imageError ? (
          <div className="ct-slice-placeholder" role="alert">
            <ScanLine size={24} />
            <p>Could not load this CT slice.</p>
          </div>
        ) : (
          <img
            key={imageUrl}
            src={imageUrl}
            alt={`Axial CT slice ${sliceIndex + 1} of ${sliceCount}${showOverlay ? ' with anatomy segmentation overlay' : ''}`}
            onError={() => setImageError(true)}
          />
        )}
        <span className="ct-slice-index">SLICE {sliceIndex + 1} / {sliceCount}</span>
      </div>

      <div className="ct-slice-controls">
        <label htmlFor="ct-slice-slider">Slice position</label>
        <input
          id="ct-slice-slider"
          type="range"
          min={0}
          max={Math.max(0, sliceCount - 1)}
          value={sliceIndex}
          onChange={(event) => {
            setSliceIndex(Number(event.target.value));
            setImageError(false);
          }}
        />
        <span>{sliceIndex + 1} / {sliceCount}</span>
      </div>

      <div className="ct-surface-meta ct-slice-legend">
        <span>Model resampling: {spacingMm} mm isotropic</span>
        {SEGMENTATION_LABELS.map((label) => (
          <span key={label.name} className="ct-anatomy-label">
            <i style={{ backgroundColor: label.color }} />
            {label.name}
          </span>
        ))}
      </div>
      <p className="playground-disclaimer">
        Anatomy segmentation only. Highlighted regions are model-labeled anatomy, not fractures or fracture findings.
      </p>
    </section>
  );
}
