import { useEffect, useState } from 'react';
import { fetchModels, type ModelInfo } from '../services/api';

export function SettingsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    fetchModels()
      .then((data) => setModels(data.models))
      .catch((error: Error) => console.error('Could not load model registry.', error));
  }, []);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Model registry</h1>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>LOCAL MODEL REGISTRY</h3>
          <span className="chip neutral">Local model registry</span>
        </div>
        <div className="model-list">
          {models.map((model) => (
            <div key={model.name} className="model-card">
              <div>
                <h4>{model.name}</h4>
                <p>{model.supported_anatomy}</p>
              </div>
              <div className="model-meta">
                <span>Checkpoint: {model.checkpoint}</span>
                <span>Version: {model.version}</span>
                <span>{model.training_dataset}</span>
                <span>{model.supported_modality}</span>
                <span>{model.license}</span>
                <span>{model.status}</span>
                <a href={model.model_card} target="_blank" rel="noreferrer">Model card</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
