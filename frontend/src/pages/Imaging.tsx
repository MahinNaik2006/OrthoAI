import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Box, CheckCircle2, FileImage, FileText, Layers3, ScanLine, ShieldAlert } from 'lucide-react';
import { CTSurfaceViewer } from '../components/CTSurfaceViewer';
import { CTSliceViewer } from '../components/CTSliceViewer';
import { ImagingScanner } from '../components/ImagingScanner';
import { fetchCTSurface, uploadCT, type CTSurface, type CTStudy, type FractureRegion } from '../services/api';

type ImagingLocationState = {
  ctStudy?: CTStudy;
  patientId?: string;
  targetRegion?: FractureRegion;
  notice?: string;
};

export function ImagingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialState = location.state as ImagingLocationState | null;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<CTStudy | null>(initialState?.ctStudy ?? null);
  const [patientId] = useState(initialState?.ctStudy?.patient_id ?? initialState?.patientId ?? 'UNASSIGNED');
  const [targetRegion, setTargetRegion] = useState<FractureRegion>(
    initialState?.ctStudy?.analysis.fracture.target_region ?? initialState?.targetRegion ?? 'shoulder',
  );
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [uploadNotice, setUploadNotice] = useState(initialState?.notice ?? '');
  const [surface, setSurface] = useState<CTSurface | null>(null);
  const [surfaceError, setSurfaceError] = useState('');
  const caseId = result?.id;
  const surfaceStatus = result?.analysis.mesh.status;
  const surfaceLoading = surfaceStatus === 'ready' && !surface && !surfaceError;
  const scanCoverage = result
    ? result.analysis.scan.scan_dimensions.map(
      (size, index) => `${((size - 1) * result.analysis.scan.voxel_spacing[index]).toFixed(0)} mm`,
    )
    : null;

  useEffect(() => {
    if (!caseId || surfaceStatus !== 'ready') return;
    let active = true;
    fetchCTSurface(caseId)
      .then((data) => {
        if (active) setSurface(data);
      })
      .catch((requestError) => {
        if (active) setSurfaceError(requestError instanceof Error ? requestError.message : 'Could not load CT surface.');
      });
    return () => {
      active = false;
    };
  }, [caseId, surfaceStatus]);

  const processFile = async (file: File) => {
    if (!/\.nii(\.gz)?$/i.test(file.name)) {
      setError('Upload one NIfTI volume (.nii or .nii.gz). DICOM series ingestion is not enabled yet.');
      return;
    }
    setSelectedFile(file);
    setError('');
    setBusy(true);
    try {
      const data = await uploadCT(file, patientId, targetRegion);
      setSurface(null);
      setSurfaceError('');
      setResult(data.case);
      setUploadNotice(data.case.disclaimer);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'CT upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void processFile(file);
  };

  const onDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  return (
    <div className="page-shell imaging-page">
      <section className="imaging-hero">
        <div className="imaging-hero-copy">
          <p className="eyebrow">Imaging analysis · Patient {result?.patient_id ?? patientId}</p>
          <h1>CT slices &amp; fracture candidates</h1>
          <p className="dashboard-subtitle">
            Move from raw slices to labeled anatomy and an interactive 3D surface. Fracture outputs stay experimental and require expert review.
          </p>
          <div className="imaging-hero-tags">
            <span><Layers3 size={14} /> Labeled slices</span>
            <span><Box size={14} /> 3D anatomy</span>
            <span><ScanLine size={14} /> NIfTI ingest</span>
          </div>
          <div className="ct-upload-actions">
            <label className="ct-region-select">
              <span>Fracture region</span>
              <select value={targetRegion} onChange={(event) => setTargetRegion(event.target.value === 'rib' ? 'rib' : 'shoulder')}>
                <option value="shoulder">Shoulder girdle</option>
                <option value="rib">Rib cage</option>
              </select>
            </label>
            <label className="upload-button">
              <input type="file" accept=".nii,.nii.gz" onChange={onUpload} />
              <ScanLine size={16} /> Upload NIfTI CT
            </label>
          </div>
        </div>
        <ImagingScanner />
      </section>

      {!result ? (
        <div className="panel upload-panel">
          <label
            className={`upload-dropzone imaging-dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input type="file" accept=".nii,.nii.gz" onChange={onUpload} />
            <span className="imaging-dropzone-icon"><FileImage size={30} /></span>
            <h3>{selectedFile ? selectedFile.name : 'Drop a CT volume here'}</h3>
            <p>or click to browse · NIfTI (.nii / .nii.gz) up to 512 MB</p>
            <span className="imaging-dropzone-hint">
              {dragging ? 'Release to start the anatomy pipeline' : 'MONAI anatomy · slice labels · 3D surface'}
            </span>
          </label>
          {busy ? (
            <div className="progress-list">
              {['Uploading CT', 'Reading NIfTI metadata', 'Running MONAI anatomy segmentation', 'Creating colored 3D anatomy surfaces'].map((step, index) => (
                <div key={step} className={`progress-step ${index < 3 ? 'done' : ''}`}>
                  <span className="dot" /><span>{step}</span>{index < 3 ? <ArrowRight size={14} /> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="imaging-source-note">
            <div><CheckCircle2 size={17} /><span>CT received · {result.filename} · case {result.id.slice(0, 8)}</span></div>
            <span>{uploadNotice || result.disclaimer}</span>
          </div>

          <div className="content-grid two-col">
            <div className="panel">
              <div className="panel-header">
                <h3>Study metadata</h3>
                <span className="chip neutral">NIfTI</span>
              </div>
              <div className="metadata-grid">
                <div><span>Modality</span><strong>{result.analysis.scan.modality}</strong></div>
                <div><span>Body region</span><strong>{result.analysis.scan.body_region}</strong></div>
                <div><span>Slice count</span><strong>{result.analysis.scan.slice_count}</strong></div>
                <div><span>Voxel spacing (mm)</span><strong>{result.analysis.scan.voxel_spacing.join(' × ')}</strong></div>
                <div><span>Scan dimensions</span><strong>{result.analysis.scan.scan_dimensions.join(' × ')}</strong></div>
                <div><span>Orientation</span><strong>{result.analysis.scan.orientation}</strong></div>
                <div><span>Scan quality</span><strong>{result.analysis.scan.scan_quality}</strong></div>
                <div><span>Preprocessing time</span><strong>{result.analysis.scan.processing_time_ms === null ? 'Not measured' : `${result.analysis.scan.processing_time_ms} ms`}</strong></div>
              </div>
            </div>
            <div className="panel fracture-status-panel">
              <div className="panel-header">
                <h3>Fracture readings</h3>
                <span className={`chip ${result.analysis.fracture.status === 'candidates' ? 'warning' : 'neutral'}`}>
                  <AlertTriangle size={13} />
                  {result.analysis.fracture.status === 'candidates'
                    ? 'Experimental candidates'
                    : result.analysis.fracture.status === 'no_candidates'
                      ? 'No candidates returned'
                      : result.analysis.fracture.status === 'not_trained'
                        ? 'Model not trained'
                        : result.analysis.fracture.status === 'scope_unavailable'
                          ? 'Region not trained'
                        : 'Model unavailable'}
                </span>
              </div>
              <div className="segmentation-unavailable">
                <ShieldAlert size={20} />
                <p>{result.analysis.fracture.message}</p>
              </div>
              <ul className="list-stack">
                <li><span>Selected region</span><strong>{result.analysis.fracture.target_region === 'shoulder' ? 'Shoulder girdle' : 'Rib cage'}</strong></li>
                <li><span>Fracture model</span><strong>{result.analysis.fracture.version}</strong></li>
                <li><span>Regions represented in training</span><strong>{result.analysis.fracture.supported_regions.map((region) => region === 'shoulder' ? 'Shoulder girdle' : 'Rib cage').join(', ') || 'None'}</strong></li>
                <li>
                  <span>Predicted candidate voxels</span>
                  <strong>
                    {result.analysis.fracture.voxel_count === null
                      ? 'Not available'
                      : result.analysis.fracture.voxel_count.toLocaleString()}
                  </strong>
                </li>
                <li><span>Fracture type / displacement</span><strong>Not classified</strong></li>
                <li><span>Segmentation model</span><strong>{result.analysis.anatomy.status === 'ready' ? 'MONAI anatomy labels' : 'Unavailable'}</strong></li>
                <li><span>Approx. scan coverage (x × y × z)</span><strong>{scanCoverage?.join(' × ') ?? 'Not available'}</strong></li>
                <li>
                  <span>NIfTI value range (not confirmed HU)</span>
                  <strong>{result.analysis.scan.intensity_range?.map((value) => value.toFixed(1)).join(' to ') ?? 'Not available'}</strong>
                </li>
              </ul>
              <p className="panel-subtitle monai-status-message">Experimental segmentation only; not a diagnosis, a fracture count, or a treatment recommendation.</p>
            </div>
          </div>

          {result.analysis.anatomy.status === 'ready' && result.analysis.anatomy.slice_count ? (
            <CTSliceViewer
              key={result.id}
              caseId={result.id}
              sliceCount={result.analysis.anatomy.slice_count}
              spacingMm={result.analysis.anatomy.spacing_mm ?? 3}
            />
          ) : (
            <div className="panel ct-surface-status">
              <ShieldAlert size={18} />
              <p>Slice segmentation is unavailable because MONAI anatomy inference did not complete. {result.analysis.anatomy.message}</p>
            </div>
          )}

          <div className="imaging-workspaces-intro">
            <div>
              <p className="eyebrow">Scan-derived display</p>
              <h2>{result.analysis.mesh.kind === 'monai_anatomy_surface' ? 'MONAI bone anatomy' : 'Intensity isosurface fallback'}</h2>
            </div>
            <p>Drag to rotate · right-drag to pan · scroll to zoom.</p>
          </div>
          {surface ? (
            <CTSurfaceViewer key={result.id} surface={surface} />
          ) : (
            <div className="panel ct-surface-status" role={surfaceError ? 'alert' : undefined}>
              <ShieldAlert size={18} />
              <p>
                {surfaceLoading
                  ? 'Loading the scan-derived surface…'
                  : surfaceError || result.analysis.mesh.message}
              </p>
            </div>
          )}

          <section className="panel imaging-next-step">
            <div className="imaging-next-step-mark"><FileText size={20} /></div>
            <div className="imaging-next-step-copy">
              <p className="eyebrow">Next step · patient {result.patient_id}</p>
              <h3>Add this patient&rsquo;s reports</h3>
              <p>Ingest clinical documents, then ask the local RAG assistant about medications, allergies, prior surgery, and pre-op risks.</p>
            </div>
            <button
              type="button"
              className="primary-button imaging-next-step-button"
              onClick={() => navigate('/reports', { state: { patientId: result.patient_id } })}
            >
              <FileText size={16} /> Ingest reports <ArrowRight size={16} />
            </button>
          </section>
        </>
      )}

      {error ? <div className="dashboard-error" role="alert">{error}</div> : null}

      <div className="content-grid three-col smaller">
        <div className="panel stat-panel">
          <ScanLine size={18} /><h4>CT upload</h4><strong>{result ? 'Received' : 'Awaiting'}</strong>
        </div>
        <div className="panel stat-panel">
          <ShieldAlert size={18} /><h4>Clinical review</h4><strong>Required</strong>
        </div>
        <div className="panel stat-panel">
          <CheckCircle2 size={18} /><h4>Fracture CNN</h4><strong>{result?.analysis.fracture.status === 'candidates' ? 'Candidates marked' : result?.analysis.fracture.status === 'not_trained' ? 'Needs training' : 'Not assessed'}</strong>
        </div>
      </div>
    </div>
  );
}
