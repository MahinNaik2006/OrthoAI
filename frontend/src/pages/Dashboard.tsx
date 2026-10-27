import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Layers3,
  RefreshCw,
  ScanLine,
  Server,
  Stethoscope,
} from 'lucide-react';
import { MetricCard } from '../components/MetricCard';
import { MorningHero } from '../components/MorningHero';
import { fetchDashboard, type DashboardData } from '../services/api';

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time not recorded'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(value: number | null) {
  if (value === null) return 'Not available';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} sec`;
}

function StatusBreakdown({
  title,
  items,
  total,
}: {
  title: string;
  items: { name: string; count: number }[];
  total: number;
}) {
  return (
    <section className="dashboard-breakdown">
      <h4>{title}</h4>
      {items.length ? (
        <div className="dashboard-breakdown-list">
          {items.map((item) => (
            <div className="dashboard-breakdown-item" key={item.name}>
              <div className="dashboard-breakdown-label">
                <span>{formatStatus(item.name)}</span>
                <strong>{item.count}</strong>
              </div>
              <div className="dashboard-breakdown-track">
                <span style={{ width: `${total ? (item.count / total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="dashboard-empty-inline">No saved records yet.</p>
      )}
    </section>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Dashboard data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchDashboard()
      .then((result) => {
        if (mounted) setData(result);
      })
      .catch((loadError: unknown) => {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Dashboard data could not be loaded.');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page-shell dashboard-page">
      <MorningHero />

      <div className="page-header">
        <div>
          <p className="eyebrow">ORTHO_AI · LOCAL WORKSPACE</p>
          <h1>Clinical dashboard</h1>
          <p className="dashboard-subtitle">
            A live summary of the CT studies, report index, processing metadata, and model readiness saved here.
          </p>
        </div>
        <div className="dashboard-actions">
          <span className="chip neutral"><Database size={14} /> Workspace data</span>
          <button className="secondary-button dashboard-refresh" onClick={() => void loadDashboard()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'dashboard-spinning' : ''} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="dashboard-error" role="alert">
          <strong>Dashboard could not load.</strong> {error}
          <button className="text-button" onClick={() => void loadDashboard()}>Try again</button>
        </div>
      ) : null}
      {loading && !data ? <div className="panel dashboard-loading">Reading local workspace information…</div> : null}

      {data ? (
        <>
          <div className="dashboard-snapshot">
            <span><Activity size={15} /> Live workspace snapshot</span>
            <span>Updated {formatDate(data.generated_at)}</span>
          </div>

          <div className="metric-grid dashboard-metrics">
            <MetricCard title="Saved CT cases" value={String(data.cases.total)} helper="Records in the local case index" icon={<ScanLine size={18} />} />
            <MetricCard title="Anatomy segmentation ready" value={String(data.cases.anatomy_ready)} helper="Saved studies with anatomy output" icon={<Layers3 size={18} />} />
            <MetricCard title="Fracture candidate outputs" value={String(data.cases.fracture_candidates)} helper="Experimental outputs, not diagnoses" icon={<AlertTriangle size={18} />} />
            <MetricCard
              title="Indexed reports"
              value={data.reports.available ? String(data.reports.count) : 'Unavailable'}
              helper={data.reports.available ? 'Local report database' : 'Report database could not be queried'}
              icon={<FileText size={18} />}
            />
          </div>

          <section className="panel dashboard-section">
            <div className="panel-header">
              <div>
                <h3>Case processing overview</h3>
                <p className="panel-subtitle">Status totals are calculated from saved case analysis records.</p>
              </div>
              <span className="chip neutral">{data.cases.total} saved {data.cases.total === 1 ? 'case' : 'cases'}</span>
            </div>
            {data.cases.total ? (
              <div className="dashboard-overview-grid">
                <StatusBreakdown title="Fracture pipeline status" items={data.cases.fracture_statuses} total={data.cases.total} />
                <StatusBreakdown title="Anatomy segmentation status" items={data.cases.anatomy_statuses} total={data.cases.total} />
                <StatusBreakdown title="3D surface status" items={data.cases.mesh_statuses} total={data.cases.total} />
              </div>
            ) : (
              <div className="dashboard-empty">
                <ScanLine size={22} />
                <strong>No CT cases in this workspace</strong>
                <span>Upload a NIfTI scan to populate these summaries with saved scan information.</span>
              </div>
            )}
          </section>

          <section className="panel dashboard-section">
            <div className="panel-header">
              <div>
                <h3>Recent CT studies</h3>
                <p className="panel-subtitle">Identifiers and technical scan metadata only; patient identifiers and file names are not shown here.</p>
              </div>
              <span className="chip neutral">{data.cases.recent.length} shown</span>
            </div>
            {data.cases.recent.length ? (
              <div className="case-table-wrap">
                <table className="case-table dashboard-case-table">
                  <thead>
                    <tr>
                      <th>Case</th><th>Region</th><th>Scan geometry</th><th>Pipeline</th><th>Stored time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cases.recent.map((item) => (
                      <tr key={item.id}>
                        <td className="case-id">{item.id}</td>
                        <td><strong>{formatStatus(item.region)}</strong><span>{item.slice_count === null ? 'Slice count not recorded' : `${item.slice_count} slices`}</span></td>
                        <td>
                          <strong>{item.scan_dimensions.length ? item.scan_dimensions.join(' × ') : 'Dimensions not recorded'}</strong>
                          <span>{item.voxel_spacing.length ? `${item.voxel_spacing.map((spacing) => spacing.toFixed(2)).join(' × ')} mm spacing` : 'Voxel spacing not recorded'}</span>
                        </td>
                        <td>
                          <strong>{formatStatus(item.fracture_status)}</strong>
                          <span>Anatomy: {formatStatus(item.anatomy_status)} · Surface: {formatStatus(item.mesh_status)}</span>
                        </td>
                        <td>{formatDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="dashboard-empty-inline">No recent case records to display.</div>
            )}
            {data.cases.metadata.without_upload_time > 0 ? (
              <p className="dashboard-footnote">
                Upload timestamps were not stored for {data.cases.metadata.without_upload_time} existing {data.cases.metadata.without_upload_time === 1 ? 'record' : 'records'}; those records are retained and shown without an estimated date.
              </p>
            ) : null}
          </section>

          <div className="content-grid dashboard-detail-grid">
            <section className="panel dashboard-section">
              <div className="panel-header">
                <div>
                  <h3>Scan coverage & processing</h3>
                  <p className="panel-subtitle">Measured from available scan metadata; missing fields stay explicitly unreported.</p>
                </div>
                <ScanLine size={18} className="dashboard-section-icon" />
              </div>
              <StatusBreakdown title="Recorded target/body regions" items={data.cases.regions} total={data.cases.total} />
              <div className="dashboard-facts">
                <div><span>Processing time samples</span><strong>{data.cases.processing_time_ms.sample_count}</strong></div>
                <div><span>Average processing time</span><strong>{formatDuration(data.cases.processing_time_ms.average)}</strong></div>
                <div><span>Fastest recorded</span><strong>{formatDuration(data.cases.processing_time_ms.minimum)}</strong></div>
                <div><span>Longest recorded</span><strong>{formatDuration(data.cases.processing_time_ms.maximum)}</strong></div>
              </div>
            </section>

            <section className="panel dashboard-section">
              <div className="panel-header">
                <div>
                  <h3>Case data completeness</h3>
                  <p className="panel-subtitle">Counts indicate metadata availability, not clinical quality.</p>
                </div>
                <CheckCircle2 size={18} className="dashboard-section-icon" />
              </div>
              <div className="dashboard-facts">
                <div><span>With scan dimensions</span><strong>{data.cases.metadata.with_scan_dimensions} / {data.cases.total}</strong></div>
                <div><span>With voxel spacing</span><strong>{data.cases.metadata.with_voxel_spacing} / {data.cases.total}</strong></div>
                <div><span>With upload timestamp</span><strong>{data.cases.metadata.with_upload_time} / {data.cases.total}</strong></div>
                <div><span>Patient ID unassigned</span><strong>{data.cases.metadata.unassigned_patient} / {data.cases.total}</strong></div>
              </div>
            </section>
          </div>

          <section className="panel dashboard-section">
            <div className="panel-header">
              <div>
                <h3>Reports & local services</h3>
                <p className="panel-subtitle">Connection status is checked when this dashboard is refreshed.</p>
              </div>
              <Server size={18} className="dashboard-section-icon" />
            </div>
            <div className="dashboard-service-grid">
              <div className="dashboard-service-card">
                <div className="dashboard-service-heading"><FileText size={17} /><strong>Report index</strong></div>
                {data.reports.available ? (
                  <>
                    <strong className="dashboard-service-value">{data.reports.count} reports</strong>
                    <span>{data.reports.embedding_ready} embeddings ready · {data.reports.embedding_pending} pending · {data.reports.embedding_failed} failed</span>
                    <span>Latest report: {formatDate(data.reports.latest_created_at)}</span>
                  </>
                ) : (
                  <span className="dashboard-service-error">{data.reports.error || 'Report database status could not be determined.'}</span>
                )}
              </div>
              <div className="dashboard-service-card">
                <div className="dashboard-service-heading"><Server size={17} /><strong>Ollama endpoint</strong></div>
                <strong className={`dashboard-service-value ${data.services.ollama_available ? 'is-ready' : 'is-unavailable'}`}>
                  {data.services.ollama_available ? 'Reachable' : 'Not reachable'}
                </strong>
                <span>Endpoint availability only; installed model availability is not verified here.</span>
              </div>
              <div className="dashboard-service-card">
                <div className="dashboard-service-heading"><Database size={17} /><strong>Case index</strong></div>
                <strong className="dashboard-service-value is-ready">Readable</strong>
                <span>{data.cases.total} saved CT case records loaded for this snapshot.</span>
              </div>
            </div>
          </section>

          <section className="panel dashboard-section">
            <div className="panel-header">
              <div>
                <h3>Model readiness & scope</h3>
                <p className="panel-subtitle">Readiness is based on the installed checkpoint state in this local environment.</p>
              </div>
              <Stethoscope size={18} className="dashboard-section-icon" />
            </div>
            <div className="dashboard-model-grid">
              {data.models.map((model) => (
                <article className="dashboard-model-card" key={model.name}>
                  <div className="dashboard-model-heading">
                    <div><Layers3 size={17} /><h4>{model.name}</h4></div>
                    <span className={`case-status ${model.checkpoint === 'Installed' ? 'complete' : 'review'}`}>{model.checkpoint}</span>
                  </div>
                  <p>{model.status}</p>
                  <dl>
                    <div><dt>Version</dt><dd>{model.version}</dd></div>
                    <div><dt>Modality</dt><dd>{model.supported_modality}</dd></div>
                    <div><dt>Anatomy scope</dt><dd>{model.supported_anatomy}</dd></div>
                    <div><dt>Training source</dt><dd>{model.training_dataset}</dd></div>
                    <div><dt>License</dt><dd>{model.license}</dd></div>
                  </dl>
                  <a href={model.model_card} target="_blank" rel="noreferrer">Model / dataset information</a>
                </article>
              ))}
            </div>
          </section>

          <aside className="dashboard-clinical-notice">
            <AlertTriangle size={18} />
            <p>{data.clinical_notice}</p>
            <span>Legacy or demonstration-labelled records remain included in the saved-record totals.</span>
          </aside>
        </>
      ) : null}
    </div>
  );
}
