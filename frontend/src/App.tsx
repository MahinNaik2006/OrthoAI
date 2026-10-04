import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  Activity,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  Stethoscope,
  Users,
} from 'lucide-react';
import { DashboardPage } from './pages/Dashboard';
import { ImagingPage } from './pages/Imaging';
import { PatientPage } from './pages/Patient';
import { ReportAnalysisPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SurgicalPlanningPage } from './pages/SurgicalPlanning';

const navItems = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { to: '/patients', label: 'Patients', icon: <Users size={18} /> },
  { to: '/imaging', label: 'Imaging', icon: <Activity size={18} /> },
  { to: '/reports', label: 'Report Analysis', icon: <FileText size={18} /> },
  { to: '/surgery', label: 'Surgical Planning', icon: <ClipboardList size={18} /> },
  { to: '/settings', label: 'Settings', icon: <Settings size={18} /> },
];

function AppShell() {
  return (
    <div className="app-shell">
      <header className="floating-nav">
        <div className="brand-block">
          <div className="brand-mark">ORTHO_AI</div>
        </div>

        <nav className="nav-stack">
          {navItems.map(({ to, label, icon }) => (
            <NavLink key={label} to={to} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
              {icon}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="nav-status">
          <Stethoscope size={16} />
          <span>Clinical prototype</span>
        </div>
      </header>

      <main className="main-panel">
        <header className="topbar">
          <div className="search-box">
            <Search size={16} />
            <input placeholder="Search patients, scans, reports" />
          </div>
          <button className="primary-button">New case</button>
        </header>

        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/patients" element={<PatientPage />} />
          <Route path="/imaging" element={<ImagingPage />} />
          <Route path="/reports" element={<ReportAnalysisPage />} />
          <Route path="/surgery" element={<SurgicalPlanningPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
