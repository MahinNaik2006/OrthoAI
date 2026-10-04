import { useEffect, useState } from 'react';
import { createSurgicalPlan } from '../services/api';
import { Viewer3D } from '../components/Viewer3D';

export function SurgicalPlanningPage() {
  const [slider, setSlider] = useState(50);
  const [plan, setPlan] = useState<any>(null);

  useEffect(() => {
    createSurgicalPlan({
      fracture_regions: 3,
      confidence: 0.94,
      primary_location: 'Right posterior rib region',
    }).then((data) => setPlan(data.plan || data));
  }, []);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Surgical Planning</p>
          <h1>Virtual reconstruction</h1>
        </div>
        <button className="primary-button">Compare 3D Reconstruction</button>
      </div>

      <div className="comparison-panel panel">
        <div className="compare-header">
          <span>BEFORE</span>
          <span>PROPOSED AFTER</span>
        </div>
        <div className="before-after-shell">
          <div className="before-view" style={{ width: `${slider}%` }}>
            <Viewer3D mode="before" />
          </div>
          <div className="after-view">
            <Viewer3D mode="after" />
          </div>
          <div className="compare-slider" style={{ left: `${slider}%` }}>
            <span>◀</span>
            <span>▶</span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={slider}
          onChange={(event) => setSlider(Number(event.target.value))}
          className="compare-range"
        />
      </div>

      {plan ? (
        <div className="panel plan-panel">
          <div className="panel-header">
            <h3>AI-generated clinical decision support</h3>
            <span className="chip warning">Requires surgeon review</span>
          </div>
          <h4>{plan.simulation_label}</h4>
          <p><strong>Proposed approach:</strong> {plan.proposed_procedure}</p>
          <p><strong>Reasoning:</strong> {plan.reasoning}</p>
          <div className="procedure-grid">
            {plan.sections?.map((section: string, index: number) => (
              <div key={section} className="procedure-item">
                <span>{index + 1}</span>
                <p>{section}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
