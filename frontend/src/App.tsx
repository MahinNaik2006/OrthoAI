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
      <div className="background-mesh" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="background-network" aria-hidden="true">
        <svg viewBox="0 0 1440 900" preserveAspectRatio="none">
          <defs>
            <linearGradient id="orbit-mint" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#72e4c6" stopOpacity="0" />
              <stop offset="48%" stopColor="#72e4c6" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#72e4c6" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="orbit-blue" x1="1" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="52%" stopColor="#ffffff" stopOpacity="0.29" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <g className="network-edges">
            <path id="network-route-1" d="M38 164 142 94 248 138 354 70 470 124 581 54 700 105" />
            <path d="m142 94 22 170 128 70 62-196 116 190 111-174 121 101" />
            <path d="m248 138 44 196 144 98 24-308 113 189 132 81 111-146" />
            <path d="m354 70 62 258 166 104 137-176 118 180 132-119" />
            <path id="network-route-2" d="m581 54 1 378 126 140 139-136 132 71 112-125 133 35" />
            <path d="m700 105 130 151 17 180 180 71 144-160 119 98" />
            <path d="m830 256 155-157 104 248 182-42 113 116" />
            <path id="network-route-3" d="m1089 347 71 160-153 78-156 88 138 120 175-116 120 38" />
            <path d="m707 572 144 101 156-88 14 208 168-116" />
            <path d="m470 362 112 70 125 140-187 118 187-118 149 21 139-136" />
            <path d="m164 264 6 273 163 153 187-118-35 211 226-69 140 89" />
            <path d="m38 164 132 373 163 153 225 93 226-69 138 89 176-13" />
            <path d="m985 99 207 0 156 197-83 211 118 116-89 133" />
          </g>
          <g className="network-packets">
            <circle r="3.2" className="network-packet packet-mint">
              <animateMotion dur="19s" repeatCount="indefinite">
                <mpath href="#network-route-1" />
              </animateMotion>
            </circle>
            <circle r="2.8" className="network-packet packet-blue">
              <animateMotion dur="27s" begin="-11s" repeatCount="indefinite">
                <mpath href="#network-route-2" />
              </animateMotion>
            </circle>
            <circle r="3.4" className="network-packet packet-mint">
              <animateMotion dur="23s" begin="-7s" repeatCount="indefinite">
                <mpath href="#network-route-3" />
              </animateMotion>
            </circle>
          </g>
          <g className="network-nodes">
            <circle cx="38" cy="164" r="3" /><circle cx="142" cy="94" r="3.5" />
            <circle cx="248" cy="138" r="3" /><circle cx="354" cy="70" r="3" />
            <circle cx="470" cy="124" r="4" /><circle cx="581" cy="54" r="3" />
            <circle cx="700" cy="105" r="3.5" /><circle cx="164" cy="264" r="3" />
            <circle cx="292" cy="334" r="4" /><circle cx="416" cy="328" r="3" />
            <circle cx="528" cy="518" r="3.5" /><circle cx="582" cy="432" r="3" />
            <circle cx="707" cy="572" r="4" /><circle cx="837" cy="436" r="3" />
            <circle cx="830" cy="256" r="3.5" /><circle cx="985" cy="99" r="3" />
            <circle cx="1089" cy="347" r="4" /><circle cx="1192" cy="99" r="3" />
            <circle cx="1160" cy="507" r="3.5" /><circle cx="1317" cy="296" r="3" />
            <circle cx="1350" cy="708" r="4" /><circle cx="1021" cy="805" r="3" />
            <circle cx="852" cy="673" r="3.5" /><circle cx="330" cy="690" r="3" />
            <circle cx="555" cy="783" r="4" /><circle cx="105" cy="820" r="3.5" />
          </g>
          <g className="network-rings">
            <circle cx="470" cy="124" r="9" />
            <circle cx="837" cy="436" r="9" />
            <circle cx="1089" cy="347" r="10" />
            <circle cx="555" cy="783" r="9" />
          </g>
          <g className="orbit-systems">
            <g transform="translate(285 405)">
              <g className="orbit-system orbit-system-mint">
                <ellipse cx="0" cy="0" rx="142" ry="46" />
                <ellipse cx="0" cy="0" rx="105" ry="70" />
                <ellipse cx="0" cy="0" rx="72" ry="104" />
                <circle className="orbit-core" cx="0" cy="0" r="4" />
                <circle className="orbit-satellite" cx="142" cy="0" r="3" />
                <circle className="orbit-satellite orbit-satellite-small" cx="-105" cy="0" r="2.5" />
              </g>
            </g>
            <g transform="translate(1120 620)">
              <g className="orbit-system orbit-system-blue">
                <ellipse cx="0" cy="0" rx="168" ry="54" />
                <ellipse cx="0" cy="0" rx="124" ry="82" />
                <ellipse cx="0" cy="0" rx="84" ry="122" />
                <circle className="orbit-core" cx="0" cy="0" r="4" />
                <circle className="orbit-satellite" cx="168" cy="0" r="3" />
                <circle className="orbit-satellite orbit-satellite-small" cx="-124" cy="0" r="2.5" />
              </g>
            </g>
          </g>
        </svg>
      </div>
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
