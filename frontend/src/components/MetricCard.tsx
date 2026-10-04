import type { ReactNode } from 'react';

type MetricCardProps = {
  title: string;
  value: string;
  helper?: string;
  icon?: ReactNode;
};

export function MetricCard({ title, value, helper, icon }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <p className="metric-title">{title}</p>
        <h3>{value}</h3>
        {helper ? <span>{helper}</span> : null}
      </div>
    </div>
  );
}
