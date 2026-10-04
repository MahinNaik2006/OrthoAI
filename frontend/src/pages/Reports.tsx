import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  BrainCircuit,
  Database,
  FileText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import {
  ingestPatientReport,
  listReports,
  runPatientPreoperativeReview,
  type IngestedReport,
  type PatientPreoperativeReview,
} from '../services/api';

export function ReportAnalysisPage() {
  const [patientId, setPatientId] = useState('DEMO-042');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reports, setReports] = useState<IngestedReport[]>([]);
  const [review, setReview] = useState<PatientPreoperativeReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const patientHasSearchableReports = reports.some(
    (report) => report.patient_id === patientId.trim() && report.embedding_status === 'ready',
  );

  const refreshReports = useCallback(async () => {
    const result = await listReports();
    setReports(result.reports);
  }, []);

  const changePatientId = (value: string) => {
    setPatientId(value);
    setReview(null);
  };

  useEffect(() => {
    refreshReports()
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [refreshReports]);

  const onUpload = async () => {
    if (!selectedFile || !patientId.trim()) return;
    setError('');
    setNotice('');
    setReview(null);
    setUploading(true);
    try {
      const result = await ingestPatientReport(patientId.trim(), selectedFile);
      setNotice(
        result.report.embedding_status === 'ready'
          ? `${result.report.filename} stored in MySQL with searchable vectors.`
          : `${result.report.filename} stored in MySQL. Vector indexing is currently unavailable.`,
      );
      setSelectedFile(null);
      await refreshReports();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Report could not be stored.');
    } finally {
      setUploading(false);
    }
  };

  const analyzeBeforeSurgery = async () => {
    if (!patientId.trim()) return;
    setError('');
    setNotice('');
    setAnalyzing(true);
    try {
      setReview(await runPatientPreoperativeReview(patientId.trim()));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Preoperative analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
      setSelectedFile(null);
      setError('Use a searchable PDF, DOCX, or TXT report. Image OCR is not enabled.');
    } else if (file.size > 15 * 1024 * 1024) {
      setSelectedFile(null);
      setError('Report must be smaller than 15 MB.');
    } else {
      setSelectedFile(file);
    }
  };

  return (
    <div className="page-shell reports-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Clinical documents · local MySQL</p>
          <h1>Report analysis</h1>
          <p className="dashboard-subtitle">Upload and store patient reports, then retrieve relevant evidence for a local Llama pre-op review.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setLoading(true);
            setError('');
            setReview(null);
            refreshReports().catch((requestError: Error) => setError(requestError.message)).finally(() => setLoading(false));
          }}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh reports
        </button>
      </div>

      <section className="panel report-ingest-card">
        <div className="report-ingest-copy">
          <div className="ingestion-mark"><Database size={20} /></div>
          <div>
            <p className="eyebrow">Saved to the local database</p>
            <h2>Ingest a medical report</h2>
            <p>Original file, extracted text, patient ID, and vector embeddings are stored in MySQL at localhost:3307.</p>
          </div>
        </div>

        <div className="report-ingest-controls">
          <label className="report-patient-field">
            <span>Patient / case ID</span>
            <input value={patientId} onChange={(event) => changePatientId(event.target.value)} maxLength={64} placeholder="e.g. DEMO-042" />
          </label>
          <label className="report-file-select">
            <input type="file" accept=".pdf,.docx,.txt" onChange={onFileChange} />
            <UploadCloud size={17} />
            <span>{selectedFile?.name ?? 'Choose a searchable report (PDF, DOCX, TXT)'}</span>
          </label>
          <button type="button" className="primary-button ingest-button" onClick={onUpload} disabled={!selectedFile || uploading || !patientId.trim()}>
            {uploading ? <><LoaderCircle className="spin" size={16} /> Saving report…</> : <><Database size={16} /> Save to MySQL</>}
          </button>
          <button type="button" className="secondary-button" onClick={analyzeBeforeSurgery} disabled={analyzing || !patientHasSearchableReports}>
            {analyzing ? <><LoaderCircle className="spin" size={16} /> Reviewing…</> : <><Sparkles size={16} /> Analyze before surgery</>}
          </button>
        </div>

        {error ? <div className="ingestion-alert error" role="alert"><AlertCircle size={16} />{error}</div> : null}
        {notice ? <div className="ingestion-alert success" role="status"><BadgeCheck size={16} />{notice}</div> : null}
        <div className="reports-local-note"><LockKeyhole size={14} /> Files and report content remain in local MySQL. Embeddings and Llama inference use local Ollama.</div>
      </section>

      <section className="panel stored-reports-panel">
        <div className="panel-header">
          <div>
            <h3>Stored patient reports</h3>
            <p className="panel-subtitle">Reports ingested into the local MySQL database</p>
          </div>
          <span className="chip neutral">{reports.length} stored</span>
        </div>

        {loading ? (
          <div className="report-list-empty"><LoaderCircle className="spin" size={18} /> Loading stored reports…</div>
        ) : reports.length ? (
          <div className="report-table-wrap">
            <table className="case-table report-table">
              <thead>
                <tr><th>Report</th><th>Patient / case</th><th>Type</th><th>Added</th><th>Search index</th></tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <div className="report-name-cell"><span className="stored-report-icon"><FileText size={15} /></span><strong>{report.filename}</strong></div>
                      <span className="report-size-cell">{Math.max(1, Math.ceil(report.file_size / 1024))} KB · {(report.char_count / 1000).toFixed(1)}k text characters</span>
                    </td>
                    <td className="case-id">{report.patient_id}</td>
                    <td>{report.filename.split('.').pop()?.toUpperCase()}</td>
                    <td>{new Date(report.created_at).toLocaleString()}</td>
                    <td>
                      <span className={`case-status ${report.embedding_status === 'ready' ? 'complete' : 'review'}`}>
                        {report.embedding_status === 'ready' ? `${report.chunk_count} chunks indexed` : report.embedding_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="report-list-empty">
            <div className="empty-vault-icon"><FileText size={20} /></div>
            <strong>No reports stored yet</strong>
            <span>Reports saved from this page or the Patient workspace will appear here.</span>
          </div>
        )}
      </section>

      {review ? (
        <section className="panel preop-result-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow"><BrainCircuit size={14} /> Local Llama 3.2 · evidence retrieval</p>
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
            <FindingList title="Findings to review" items={review.analysis.preoperative_findings} />
            <FindingList title="Potential risks" items={review.analysis.potential_risks} />
            <FindingList title="Medications to review" items={review.analysis.medications_to_review} />
            <FindingList title="Allergies" items={review.analysis.allergies} />
            <FindingList title="Missing information" items={review.analysis.missing_information} />
            <FindingList title="Questions for clinician" items={review.analysis.questions_for_clinician} />
          </div>
          <p className="dashboard-disclaimer">{review.disclaimer}</p>
        </section>
      ) : null}

      <div className="reports-clinical-note">
        <LockKeyhole size={15} />
        <span>Local prototype only. Summaries support—not replace—review of the original report by a qualified clinician. They do not provide surgical clearance.</span>
      </div>
    </div>
  );
}

function FindingList({ title, items }: { title: string; items: string[] }) {
  const visibleItems = items.filter((item) => item.trim());
  return (
    <div className="preop-finding-card">
      <h3>{title}</h3>
      {visibleItems.length ? (
        <ul>{visibleItems.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul>
      ) : (
        <p className="no-finding">No specific item identified in retrieved excerpts.</p>
      )}
    </div>
  );
}
