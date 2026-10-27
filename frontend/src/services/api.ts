const API_BASE = 'http://localhost:8000';

export type DashboardData = {
  generated_at: string;
  cases: {
    total: number;
    fracture_candidates: number;
    anatomy_ready: number;
    fracture_statuses: { name: string; count: number }[];
    anatomy_statuses: { name: string; count: number }[];
    mesh_statuses: { name: string; count: number }[];
    regions: { name: string; count: number }[];
    processing_time_ms: {
      sample_count: number;
      average: number | null;
      minimum: number | null;
      maximum: number | null;
    };
    metadata: {
      with_scan_dimensions: number;
      with_voxel_spacing: number;
      with_upload_time: number;
      without_upload_time: number;
      unassigned_patient: number;
    };
    recent: {
      id: string;
      created_at: string | null;
      region: string;
      slice_count: number | null;
      scan_dimensions: number[];
      voxel_spacing: number[];
      processing_time_ms: number | null;
      fracture_status: string;
      anatomy_status: string;
      mesh_status: string;
    }[];
  };
  reports: {
    available: boolean;
    count: number | null;
    embedding_ready: number | null;
    embedding_failed: number | null;
    embedding_pending: number | null;
    latest_created_at: string | null;
    error: string | null;
  };
  services: {
    ollama_available: boolean;
    report_database_available: boolean;
  };
  models: {
    name: string;
    version: string;
    supported_anatomy: string;
    supported_modality: string;
    training_dataset: string;
    checkpoint: string;
    model_card: string;
    license: string;
    status: string;
  }[];
  counts_include_legacy_records: boolean;
  clinical_notice: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!isRecord(value) || !isRecord(value.cases) || !isRecord(value.reports) || !isRecord(value.services)) {
    return false;
  }
  const cases = value.cases;
  return (
    typeof value.generated_at === 'string' &&
    typeof cases.total === 'number' &&
    typeof cases.fracture_candidates === 'number' &&
    typeof cases.anatomy_ready === 'number' &&
    Array.isArray(cases.fracture_statuses) &&
    Array.isArray(cases.anatomy_statuses) &&
    Array.isArray(cases.mesh_statuses) &&
    Array.isArray(cases.regions) &&
    Array.isArray(cases.recent) &&
    isRecord(cases.processing_time_ms) &&
    isRecord(cases.metadata) &&
    typeof value.reports.available === 'boolean' &&
    typeof value.services.ollama_available === 'boolean' &&
    Array.isArray(value.models) &&
    typeof value.clinical_notice === 'string'
  );
}

export type FractureRegion = 'rib' | 'shoulder';

export async function fetchHealth() {
  return fetch(`${API_BASE}/health`).then((res) => res.json());
}

export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch(`${API_BASE}/api/dashboard`);
  if (!response.ok) {
    throw new Error(`Dashboard request failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!isDashboardData(data)) {
    throw new Error('Dashboard API returned an incompatible response. Restart the local backend to load live workspace data.');
  }
  return data;
}

export type CTStudy = {
  id: string;
  patient_id: string;
  filename: string;
  analysis: {
    scan: {
      modality: string;
      body_region: string;
      slice_count: number;
      voxel_spacing: number[];
      scan_dimensions: number[];
      orientation: string;
      scan_quality: string;
      processing_time_ms: number | null;
      intensity_range: [number, number] | null;
    };
    preprocessing: {
      volume_shape: number[];
      mean_intensity: number;
      std_intensity: number;
      step: number;
      orientation: string;
    };
    fracture: {
      status: 'not_trained' | 'candidates' | 'no_candidates' | 'scope_unavailable' | 'unavailable' | 'failed';
      message: string;
      model: string;
      version: string;
      target_region: FractureRegion;
      supported_regions: FractureRegion[];
      voxel_count: number | null;
      threshold: number;
    };
    anatomy: {
      status: 'ready' | 'unavailable';
      model: string;
      message: string;
      labels: string[];
      processing_time_ms: number | null;
      slice_count: number | null;
      spacing_mm: number | null;
    };
    model: {
      repository: string;
      revision: string;
      source: string;
      license: string;
    };
    mesh: {
      status: 'ready' | 'unavailable';
      kind: 'monai_anatomy_surface' | 'intensity_isosurface';
      message: string;
      vertex_count: number;
      face_count: number;
      threshold_percentile: number | null;
      threshold_intensity: number | null;
    };
  };
  disclaimer: string;
  visualization: {
    mode: 'monai_anatomy_and_optional_fracture_candidates';
    anatomy_segmentation_available: boolean;
    fracture_segmentation_available: boolean;
    fracture_segmentation_is_experimental: boolean;
    postoperative_simulation: true;
  };
};

export type CTSurfacePart = {
  name: string;
  color: string;
  voxel_count: number;
  vertices: number[];
  faces: number[];
};

export type CTSurface =
  | {
  source: 'intensity_isosurface';
  fracture_part?: CTSurfacePart | null;
  vertices: number[];
  faces: number[];
  threshold_percentile: number;
  threshold_intensity: number;
  vertex_count: number;
  face_count: number;
  mesh_scale: number | null;
  mesh_center_mm?: number[] | null;
  }
  | {
  source: 'monai_anatomy_segmentation';
  parts: CTSurfacePart[];
  fracture_part?: CTSurfacePart | null;
  spacing_mm: number;
  mesh_scale: number | null;
  mesh_center_mm?: number[] | null;
  vertex_count: number;
  face_count: number;
  };

export async function uploadCT(
  file: File,
  patientId = 'UNASSIGNED',
  targetRegion: FractureRegion = 'shoulder',
) {
  const formData = new FormData();
  formData.append('patient_id', patientId);
  formData.append('target_region', targetRegion);
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/api/upload-ct`, {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? `CT upload failed with status ${response.status}`);
  }
  return payload as { status: string; case: CTStudy };
}

export async function fetchCTSurface(caseId: string): Promise<CTSurface> {
  const response = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(caseId)}/surface`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? `CT surface request failed with status ${response.status}`);
  }
  return payload as CTSurface;
}

export function getCTSliceUrl(caseId: string, sliceIndex: number, overlay: boolean) {
  const params = new URLSearchParams({ overlay: String(overlay) });
  return `${API_BASE}/api/cases/${encodeURIComponent(caseId)}/slices/${sliceIndex}?${params}`;
}

export async function analyzeReport(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  return fetch(`${API_BASE}/api/analyze-report`, {
    method: 'POST',
    body: formData,
  }).then((res) => res.json());
}

async function reportRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? `Request failed with status ${response.status}`);
  }
  return payload as T;
}

export type IngestedReport = {
  id: string;
  patient_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  chunk_count: number;
  char_count: number;
  embedding_status: 'pending' | 'ready' | 'unavailable' | 'failed';
  embedding_model: string | null;
};

export type PatientPreoperativeReview = {
  status: string;
  patient_id: string;
  model: string;
  embedding_model: string;
  reports_included: number;
  retrieved_chunks: { filename: string; similarity: number }[];
  analysis: {
    summary: string;
    preoperative_findings: string[];
    potential_risks: string[];
    medications_to_review: string[];
    allergies: string[];
    missing_information: string[];
    questions_for_clinician: string[];
    urgency: string;
  };
  disclaimer: string;
};

export type ModelInfo = {
  name: string;
  version: string;
  supported_anatomy: string;
  supported_modality: string;
  training_dataset: string;
  checkpoint: string;
  model_card: string;
  license: string;
  status: string;
};

export async function ingestPatientReport(patientId: string, file: File) {
  const formData = new FormData();
  formData.append('patient_id', patientId);
  formData.append('file', file);

  return reportRequest<{
    status: string;
    storage: string;
    embedding_model: string;
    report: IngestedReport;
    message: string;
  }>(`${API_BASE}/api/reports/ingest`, { method: 'POST', body: formData });
}

export async function listPatientReports(patientId: string) {
  return reportRequest<{ patient_id: string; reports: IngestedReport[] }>(
    `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/reports`,
  );
}

export async function listReports(patientId?: string) {
  const query = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : '';
  return reportRequest<{ reports: IngestedReport[]; count: number }>(
    `${API_BASE}/api/reports${query}`,
  );
}

export async function runPatientPreoperativeReview(patientId: string) {
  return reportRequest<PatientPreoperativeReview>(
    `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/preoperative-review`,
    { method: 'POST' },
  );
}

export type ReportChatSource = {
  filename: string;
  similarity: number;
  excerpt: string;
};

export type ReportChatResponse = {
  status: string;
  patient_id: string;
  model: string;
  embedding_model: string;
  question: string;
  answer: string;
  reports_included: number;
  sources: ReportChatSource[];
  disclaimer: string;
};

export async function chatWithPatientReports(patientId: string, question: string) {
  return reportRequest<ReportChatResponse>(
    `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/report-chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    },
  );
}

export async function createSurgicalPlan(fractureSummary: Record<string, unknown>) {
  return fetch(`${API_BASE}/api/surgical-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fracture_summary: fractureSummary }),
  }).then((res) => res.json());
}

export async function fetchModels(): Promise<{ models: ModelInfo[] }> {
  const response = await fetch(`${API_BASE}/api/models`);
  if (!response.ok) {
    throw new Error(`Model registry request failed with status ${response.status}`);
  }
  return response.json() as Promise<{ models: ModelInfo[] }>;
}
