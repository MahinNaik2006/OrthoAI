import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Database,
  FileText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  ingestPatientReport,
  listPatientReports,
  runPatientPreoperativeReview,
  type IngestedReport,
  type PatientPreoperativeReview,
  type FractureRegion,
  uploadCT,
  type CTStudy,
} from '../services/api';

const INITIAL_PATIENT_ID = 'DEMO-042';

export function PatientPage() {
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState(INITIAL_PATIENT_ID);
  const [reports, setReports] = useState<IngestedReport[]>([]);
  const [loadedPatientId, setLoadedPatientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loadingReports, setLoadingReports] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState<PatientPreoperativeReview | null>(null);
  const [ctFile, setCtFile] = useState<File | null>(null);
  const [ctRegion, setCtRegion] = useState<FractureRegion>('shoulder');
  const [uploadingCT, setUploadingCT] = useState(false);
  const [ctError, setCtError] = useState('');

  const refreshReports = async (id: string) => {
    const result = await listPatientReports(id.trim());
    setReports(result.reports);
    setLoadedPatientId(id.trim());
  };

  const currentReports = loadedPatientId === patientId.trim() ? reports : [];

  const changePatientId = (value: string) => {
    setPatientId(value);
    setReview(null);
  };

  useEffect(() => {
    listPatientReports(INITIAL_PATIENT_ID)
      .then((result) => {
        setReports(result.reports);
        setLoadedPatientId(INITIAL_PATIENT_ID);
      })
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setLoadingReports(false));
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setError('');
    setMessage('');
    setReview(null);
    setIngesting(true);
    try {
      const result = await ingestPatientReport(patientId, file);
      setMessage(
        result.report.embedding_status === 'ready'
          ? `${result.report.filename} and its searchable vectors were saved in MySQL.`
          : `${result.report.filename} was saved in MySQL. Vector indexing is unavailable; local Llama review needs working Ollama embeddings.`,
      );
      setFile(null);
      await refreshReports(patientId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Report ingestion failed.');
    } finally {
      setIngesting(false);
    }
  };

  const handleReview = async () => {
    setError('');
    setMessage('');
    setAnalyzing(true);
    try {
      setReview(await runPatientPreoperativeReview(patientId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Preoperative review failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCTUpload = async () => {
    if (!ctFile) return;
    setCtError('');
    setUploadingCT(true);
    try {
      const result = await uploadCT(ctFile, patientId.trim(), ctRegion);
      const study: CTStudy = result.case;
      navigate('/imaging', {
        state: {
          ctStudy: study,
          notice: study.disclaimer,
        },
      });
    } catch (requestError) {
      setCtError(requestError instanceof Error ? requestError.message : 'CT scan upload failed.');
    } finally {
      setUploadingCT(false);
    }
  };

  const acceptCTFile = (selected: File | undefined) => {
    if (!selected) return;
    setCtError('');
    if (!/\.nii(\.gz)?$/i.test(selected.name)) {
      setCtFile(null);
      setCtError('Upload one NIfTI volume (.nii or .nii.gz). DICOM series ingestion is not enabled yet.');
      return;
    }
    if (selected.size > 512 * 1024 * 1024) {
      setCtFile(null);
      setCtError('CT scan must be smaller than 512 MB.');
      return;
    }
    setCtFile(selected);
  };

  const acceptFile = (selected: File | undefined) => {
    if (!selected) return;
    setError('');
    setMessage('');
    if (!/\.(pdf|docx|txt)$/i.test(selected.name)) {
      setFile(null);
      setError('Choose a searchable PDF, DOCX, or TXT report. Image OCR is not enabled.');
      return;
    }
    if (selected.size > 15 * 1024 * 1024) {
      setFile(null);
      setError('Report must be smaller than 15 MB.');
      return;
    }
    setFile(selected);
  };

  const openExistingReports = async () => {
    setError('');
    setMessage('');
    setLoadingReports(true);
    try {
      await refreshReports(patientId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load this patient’s reports.');
    } finally {
      setLoadingReports(false);
    }
  };

  return (
    <div className="page-shell patient-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Patient workspace</p>
          <h1>Unified patient overview</h1>
          <p className="dashboard-subtitle">Bring imaging and clinical reports together for a clinician-reviewed pre-op summary.</p>
        </div>
        <span className="chip neutral patient-id-chip"><ShieldCheck size={14} /> Local, patient-scoped workspace</span>
      </div>

      <div className="content-grid three-col patient-summary-grid">
        <div className="panel patient-summary-card">
          <div className="patient-summary-icon"><ScanLine size={18} /></div>
          <div className="panel-header"><h3>CT analysis</h3><span className="chip warning">No fracture model</span></div>
          <ul className="list-stack">
            <li><span>Fractures detected</span><strong>Not assessed</strong></li>
            <li><span>Scan-derived surface</span><strong>Intensity only</strong></li>
            <li><span>AI confidence</span><strong>Not available</strong></li>
          </ul>
        </div>

        <div className="panel patient-summary-card">
          <div className="patient-summary-icon"><FileText size={18} /></div>
          <div className="panel-header"><h3>Report analysis</h3><span className="chip neutral">{currentReports.length} stored</span></div>
          <ul className="list-stack">
            <li><span>Ingested reports</span><strong>{currentReports.length}</strong></li>
            <li><span>Storage</span><strong>MySQL report vault</strong></li>
            <li><span>Review status</span><strong>{review ? 'Review required' : 'Not run'}</strong></li>
          </ul>
        </div>

        <div className="panel patient-summary-card">
          <div className="patient-summary-icon"><ClipboardCheck size={18} /></div>
          <div className="panel-header"><h3>Pre-op review</h3><span className="chip warning">Clinician review</span></div>
          <ul className="list-stack">
            <li><span>Medication review</span><strong>Required</strong></li>
            <li><span>Missing information</span><strong>Check report</strong></li>
            <li><span>Surgical clearance</span><strong>Not provided</strong></li>
          </ul>
        </div>
      </div>

      <section className="panel patient-ct-ingest">
        <div className="ct-ingest-heading">
          <div className="patient-summary-icon"><ScanLine size={18} /></div>
          <div>
            <p className="eyebrow">Imaging workspace</p>
            <h2>Ingest a CT scan</h2>
            <p>Choose the fracture region you want the experimental, locally trained model to evaluate.</p>
          </div>
        </div>
        <div className="patient-ct-controls">
          <label className="ct-region-select">
            <span>Fracture region</span>
            <select value={ctRegion} onChange={(event) => setCtRegion(event.target.value === 'rib' ? 'rib' : 'shoulder')}>
              <option value="shoulder">Shoulder girdle (humerus, scapula, clavicle)</option>
              <option value="rib">Rib cage</option>
            </select>
          </label>
          <label className="report-file-select">
            <input type="file" accept=".nii,.nii.gz" onChange={(event) => acceptCTFile(event.target.files?.[0])} />
            <UploadCloud size={17} />
            <span>{ctFile?.name ?? 'Choose a NIfTI CT volume (.nii or .nii.gz)'}</span>
          </label>
          <button type="button" className="primary-button ingest-button" disabled={!ctFile || uploadingCT || !patientId.trim()} onClick={handleCTUpload}>
            {uploadingCT ? <><LoaderCircle className="spin" size={16} /> Processing scan…</> : <><ScanLine size={16} /> Upload & open 3D workspaces</>}
          </button>
        </div>
        {ctError ? <div className="ingestion-alert error" role="alert"><AlertCircle size={16} />{ctError}</div> : null}
        <p className="ct-demo-note"><AlertTriangle size={14} /> The fracture CNN is experimental and requires matching, voxel-labeled CT training data. Predictions are candidates only, not a diagnosis or treatment plan.</p>
      </section>

      <section className="panel ingestion-panel">
        <div className="ingestion-heading">
          <div className="ingestion-title">
            <div className="ingestion-mark"><Database size={20} /></div>
            <div>
              <p className="eyebrow">Local report ingestion</p>
              <h2>Patient report vault</h2>
              <p className="ingestion-intro">Store report files, extracted text, and searchable vectors in MySQL, then ask local Llama to prepare a focused preoperative review.</p>
            </div>
          </div>
          <div className="local-badge"><span /> Runs locally</div>
        </div>

        <div className="ingestion-pipeline" aria-label="Report analysis workflow">
          <div className="pipeline-step"><span className="pipeline-icon"><UploadCloud size={16} /></span><div><strong>Ingest</strong><small>Extract report text</small></div></div>
          <ChevronRight className="pipeline-chevron" size={17} />
          <div className="pipeline-step"><span className="pipeline-icon"><Database size={16} /></span><div><strong>Index</strong><small>Embed + store in MySQL</small></div></div>
          <ChevronRight className="pipeline-chevron" size={17} />
          <div className="pipeline-step"><span className="pipeline-icon"><BrainCircuit size={16} /></span><div><strong>Review</strong><small>Retrieve + analyze</small></div></div>
        </div>

        <div className="ingestion-content">
          <div className="ingestion-form-column">
            <div className="patient-id-field">
              <label htmlFor="patient-report-id">Patient / case ID</label>
              <div className="patient-id-input-wrap">
                <LockKeyhole size={16} />
                <input
                  id="patient-report-id"
                  value={patientId}
                  onChange={(event) => changePatientId(event.target.value)}
                  maxLength={64}
                  placeholder="e.g. DEMO-042"
                />
                <button type="button" className="text-button" onClick={openExistingReports}>Load</button>
              </div>
              <small>Reports, extracted text, and searchable vectors are stored in local MySQL under this ID.</small>
            </div>

            <label
              className={`report-dropzone ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                acceptFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={(event) => acceptFile(event.target.files?.[0])}
              />
              <span className="dropzone-icon"><UploadCloud size={22} /></span>
              <strong>{file ? file.name : 'Drop a report here or browse files'}</strong>
              <span>{file ? `${(file.size / 1024).toFixed(0)} KB · ready to ingest` : 'Searchable PDF, DOCX, or TXT · up to 15 MB'}</span>
              {file ? (
                <button
                  type="button"
                  className="remove-file"
                  aria-label="Remove selected report"
                  onClick={(event) => { event.preventDefault(); setFile(null); }}
                >
                  <X size={15} />
                </button>
              ) : null}
            </label>

            <div className="ingestion-actions">
              <button type="button" className="primary-button ingest-button" disabled={!file || ingesting || !patientId.trim()} onClick={handleUpload}>
                {ingesting ? <><LoaderCircle className="spin" size={16} /> Indexing report…</> : <><Database size={16} /> Store in patient vault</>}
              </button>
              <button type="button" className="secondary-button" disabled={!currentReports.length || analyzing || !patientId.trim()} onClick={handleReview}>
                {analyzing ? <><LoaderCircle className="spin" size={16} /> Reviewing…</> : <><Sparkles size={16} /> Analyze before surgery</>}
              </button>
            </div>

            {error ? <div className="ingestion-alert error" role="alert"><AlertCircle size={16} />{error}</div> : null}
            {message ? <div className="ingestion-alert success" role="status"><Check size={16} />{message}</div> : null}

            <div className="privacy-note">
              <LockKeyhole size={15} />
              <span>Original file, extracted text, and embeddings are saved in local MySQL. Llama analysis uses local Ollama—no external LLM API.</span>
            </div>
          </div>

          <aside className="vault-column">
            <div className="vault-header">
              <div><h3>Stored reports</h3><p>Patient ID: <strong>{patientId || '—'}</strong></p></div>
              <button type="button" className="icon-button" title="Refresh reports" onClick={openExistingReports} disabled={loadingReports}>
                <RefreshCw size={15} className={loadingReports ? 'spin' : ''} />
              </button>
            </div>

            {loadingReports ? (
              <div className="vault-empty"><LoaderCircle className="spin" size={20} /><span>Loading patient reports…</span></div>
            ) : loadedPatientId !== patientId.trim() ? (
              <div className="vault-empty">
                <div className="empty-vault-icon"><RefreshCw size={19} /></div>
                <strong>Load this patient’s reports</strong>
                <span>Use Load to view records associated with this patient ID.</span>
              </div>
            ) : currentReports.length ? (
              <div className="stored-report-list">
                {currentReports.map((report) => (
                  <div className="stored-report" key={report.id}>
                    <div className="stored-report-icon"><FileText size={16} /></div>
                    <div className="stored-report-meta">
                      <strong title={report.filename}>{report.filename}</strong>
                      <span>
                        {report.embedding_status === 'ready'
                          ? `${report.chunk_count} searchable sections`
                          : 'Saved · vector indexing unavailable'}
                        {' · '}{new Date(report.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <BadgeCheck size={17} className="stored-report-check" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="vault-empty">
                <div className="empty-vault-icon"><FileText size={20} /></div>
                <strong>No reports indexed yet</strong>
                <span>Add a medical report to build this patient’s review context.</span>
              </div>
            )}

            <div className="vault-footer">
              <span><Database size={13} /> MySQL report vault</span>
              <span><LockKeyhole size={13} /> Patient scoped</span>
            </div>
          </aside>
        </div>
      </section>

      {review ? (
        <section className="panel preop-result-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Local Llama 3.2 · evidence retrieval</p>
              <h2>Preoperative review summary</h2>
            </div>
            <span className="chip warning"><AlertTriangle size={13} /> Review required</span>
          </div>
          <p className="preop-summary">{review.analysis.summary}</p>

          <div className="preop-evidence">
            <div><Database size={15} /> Retrieved from {review.reports_included} stored report{review.reports_included === 1 ? '' : 's'}</div>
            {review.retrieved_chunks.map((chunk, index) => (
              <span key={`${chunk.filename}-${index}`}>{chunk.filename} · relevance {(chunk.similarity * 100).toFixed(0)}%</span>
            ))}
          </div>

          <div className="preop-findings-grid">
            <FindingList title="Findings to review" icon={<ClipboardCheck size={16} />} items={review.analysis.preoperative_findings} />
            <FindingList title="Potential risks" icon={<AlertTriangle size={16} />} items={review.analysis.potential_risks} />
            <FindingList title="Medications & allergies" icon={<FileText size={16} />} items={[...review.analysis.medications_to_review, ...review.analysis.allergies]} />
            <FindingList title="Missing information" icon={<CircleHelp size={16} />} items={review.analysis.missing_information} />
            <FindingList title="Questions for clinician" icon={<ArrowRight size={16} />} items={review.analysis.questions_for_clinician} />
          </div>
          <p className="dashboard-disclaimer">{review.disclaimer}</p>
        </section>
      ) : null}

      <div className="content-grid three-col">
        <div className="panel">
          <h3>Clinical data</h3>
          <ul className="list-stack">
            <li><span>Review pathway</span><strong>Clinician-led</strong></li>
            <li><span>Report source</span><strong>Local ingestion</strong></li>
            <li><span>AI output</span><strong>Decision support only</strong></li>
          </ul>
        </div>
        <div className="panel">
          <h3>Case timeline</h3>
          <ul className="list-stack">
            <li><span>CT analysis</span><strong>Available</strong></li>
            <li><span>Report ingestion</span><strong>{currentReports.length ? 'Indexed' : 'Awaiting report'}</strong></li>
            <li><span>Pre-op review</span><strong>{review ? 'Generated' : 'Not run'}</strong></li>
          </ul>
        </div>
        <div className="panel">
          <h3>Data handling</h3>
          <ul className="list-stack">
            <li><span>Report database</span><strong>MySQL · local</strong></li>
            <li><span>Text embeddings</span><strong>Stored in MySQL</strong></li>
            <li><span>Image OCR</span><strong>Unavailable</strong></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function FindingList({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  const visibleItems = items.filter((item) => item.trim());
  return (
    <div className="preop-finding-card">
      <h3>{icon}{title}</h3>
      {visibleItems.length ? (
        <ul>{visibleItems.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul>
      ) : (
        <p className="no-finding">No specific item identified in retrieved excerpts.</p>
      )}
    </div>
  );
}
