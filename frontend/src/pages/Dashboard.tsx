import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
  Stethoscope,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MetricCard } from '../components/MetricCard';
import { fetchDashboard, type DashboardData } from '../services/api';

const distributionColors = ['#4cc9f0', '#5271ff', '#9b8afb'];

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch(() => setError('Dashboard data is unavailable. Check that the local API is running.'));
  }, []);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">ORTHO_AI · OVERVIEW</p>
          <h1>Clinical dashboard</h1>
          <p className="dashboard-subtitle">Case activity, review workload, and local model readiness.</p>
        </div>
        <div className="dashboard-actions">
          <span className="chip warning">Demo data</span>
          <button className="primary-button">New case</button>
        </div>
      </div>

      {error ? <div className="dashboard-error" role="alert">{error}</div> : null}
      {!data && !error ? <div className="panel dashboard-loading">Loading dashboard information…</div> : null}

      {data ? (
        <>
          <div className="metric-grid">
            <MetricCard title="Total cases" value={String(data.total_cases)} helper="Demo workspace" icon={<Activity size={18} />} />
            <MetricCard title="Cases analyzed" value={String(data.cases_analyzed)} helper="Analysis completed" icon={<Stethoscope size={18} />} />
            <MetricCard title="Fractures detected" value={String(data.fractures_detected)} helper="Requires clinician review" icon={<AlertTriangle size={18} />} />
            <MetricCard title="Reports analyzed" value={String(data.reports_analyzed)} helper="Local report workflow" icon={<FileText size={18} />} />
            <MetricCard title="Pending reviews" value={String(data.pending_reviews)} helper="Awaiting clinician review" icon={<Clock3 size={18} />} />
            <MetricCard title="Avg. processing time" value={data.average_processing_time} helper="Demo pipeline estimate" icon={<CheckCircle2 size={18} />} />
          </div>

          <div className="content-grid dashboard-top-grid">
            <div className="panel large-panel">
              <div className="panel-header">
                <div>
                  <h3>Case activity</h3>
                  <p className="panel-subtitle">Cases created by month · sample values</p>
                </div>
                <span className="chip neutral">Last 6 months</span>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.cases_over_time}>
                    <defs>
                      <linearGradient id="fillCases" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#4cc9f0" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#4cc9f0" stopOpacity={0.08} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#24364d" />
                    <XAxis dataKey="month" stroke="#9eb5c8" />
                    <YAxis allowDecimals={false} stroke="#9eb5c8" />
                    <Tooltip />
                    <Area type="monotone" dataKey="cases" stroke="#4cc9f0" fill="url(#fillCases)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>Fracture distribution</h3>
                  <p className="panel-subtitle">Demo cases by region</p>
                </div>
              </div>
              <div className="distribution-chart">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={data.fracture_distribution} dataKey="count" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={4}>
                      {data.fracture_distribution.map((entry, index) => (
                        <Cell key={entry.name} fill={distributionColors[index % distributionColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="distribution-legend">
                {data.fracture_distribution.map((item, index) => (
                  <div key={item.name}>
                    <span className="legend-dot" style={{ backgroundColor: distributionColors[index % distributionColors.length] }} />
                    <span>{item.name}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="content-grid dashboard-bottom-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>Recent cases</h3>
                  <p className="panel-subtitle">Example records · no real patient data</p>
                </div>
                <button className="text-button">View all <ArrowUpRight size={14} /></button>
              </div>
              <div className="case-table-wrap">
                <table className="case-table">
                  <thead>
                    <tr><th>Case</th><th>Study / region</th><th>Updated</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.recent_cases.map((item) => (
                      <tr key={item.id}>
                        <td className="case-id">{item.id}</td>
                        <td><strong>{item.study}</strong><span>{item.region}</span></td>
                        <td>{item.updated}</td>
                        <td><span className={`case-status ${item.status === 'Complete' ? 'complete' : item.status === 'Processing' ? 'processing' : 'review'}`}>{item.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>Review queue</h3>
                  <p className="panel-subtitle">Items needing professional review</p>
                </div>
                <span className="chip warning">{data.high_priority_findings} high priority</span>
              </div>
              <div className="review-bars">
                {data.review_queue.map((item) => (
                  <div className="review-bar-item" key={item.label}>
                    <div><span>{item.label}</span><strong>{item.count}</strong></div>
                    <div className="review-track"><span className={`review-fill ${item.level.toLowerCase().replace(' ', '-')}`} style={{ width: `${Math.min(item.count * 12, 100)}%` }} /></div>
                    <small>{item.level}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel model-status-panel">
            <div className="panel-header">
              <div>
                <h3>Local services & model status</h3>
                <p className="panel-subtitle">Readiness information for this prototype workspace</p>
              </div>
              <span className="chip neutral">Local environment</span>
            </div>
            <div className="model-status-grid">
              {data.model_status.map((service) => (
                <div className="service-status" key={service.name}>
                  <span className={`service-indicator ${service.status === 'Configured' ? 'configured' : 'demo'}`} />
                  <div><strong>{service.name}</strong><span>{service.detail}</span></div>
                  <span className="service-state">{service.status}</span>
                </div>
              ))}
            </div>
            <p className="dashboard-disclaimer">Demonstration values and model states are illustrative, not clinical predictions. All findings require qualified clinician review.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
