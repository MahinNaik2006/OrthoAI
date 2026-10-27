import { useEffect, useState } from 'react';
import { Activity, Bone, HeartPulse, Moon, Stethoscope, Sun, Sunrise } from 'lucide-react';

const MANTRAS = [
  'Steady hands. Clear imaging. Better mornings.',
  'Every joint tells a story — give yours a better ending.',
  'Precision in every screw, care in every decision.',
  'Restore motion. Restore mornings.',
];

function getGreeting(hour: number) {
  if (hour < 12) return { label: 'Good morning', Icon: Sunrise };
  if (hour < 17) return { label: 'Good afternoon', Icon: Sun };
  return { label: 'Good evening', Icon: Moon };
}

function JointFixationScene() {
  return (
    <svg viewBox="0 0 440 380" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="morning-bone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#eaf8ff" />
          <stop offset="55%" stopColor="#bcd9e7" />
          <stop offset="100%" stopColor="#7898ac" />
        </linearGradient>
        <linearGradient id="morning-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a6ffe6" />
          <stop offset="100%" stopColor="#43b6c8" />
        </linearGradient>
        <radialGradient id="morning-aura">
          <stop offset="0%" stopColor="#8bffe0" stopOpacity="0.8" />
          <stop offset="55%" stopColor="#4fdcc3" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#4fdcc3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="morning-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9bffe4" stopOpacity="0" />
          <stop offset="50%" stopColor="#9bffe4" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#9bffe4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="morning-fracture" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffb27a" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#ffd98a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ff9d6b" stopOpacity="0.15" />
        </linearGradient>
        <clipPath id="morning-scene-clip">
          <rect x="8" y="8" width="424" height="364" rx="26" />
        </clipPath>
      </defs>

      <g clipPath="url(#morning-scene-clip)">
        <ellipse cx="218" cy="188" rx="152" ry="152" fill="url(#morning-aura)" className="morning-joint-aura" />

        <path d="M158 202 A 66 66 0 0 1 244 128" className="morning-rom-arc" />

        <g className="morning-surgical-arm">
          <path d="M412 22 L382 68 L400 112 L364 148 L330 178" />
          <circle cx="330" cy="178" r="6.5" className="morning-instrument-tip" />
          <line x1="330" y1="178" x2="306" y2="202" className="morning-laser" />
        </g>

        <g className="morning-femur">
          <path d="M214 30 L214 142" stroke="url(#morning-bone)" strokeWidth="34" strokeLinecap="round" />
          <circle cx="197" cy="152" r="25" fill="url(#morning-bone)" />
          <circle cx="231" cy="152" r="25" fill="url(#morning-bone)" />
        </g>

        <g className="morning-lower-leg">
          <ellipse cx="214" cy="182" rx="45" ry="16" fill="url(#morning-bone)" />
          <path d="M213 186 L210 330" stroke="url(#morning-bone)" strokeWidth="30" strokeLinecap="round" />
          <path d="M247 208 L252 314" stroke="url(#morning-bone)" strokeWidth="10" strokeLinecap="round" opacity="0.7" />

          <path d="M222 238 l 13 9 -9 12 15 9 -11 13 14 9 -8 11" className="morning-fracture" />

          <g className="morning-plate">
            <rect x="170" y="212" width="22" height="110" rx="11" fill="url(#morning-plate)" opacity="0.92" />
            <line x1="164" y1="228" x2="232" y2="228" className="morning-screw" />
            <line x1="164" y1="252" x2="232" y2="252" className="morning-screw" />
            <line x1="164" y1="276" x2="232" y2="276" className="morning-screw" />
            <line x1="164" y1="301" x2="232" y2="301" className="morning-screw" />
          </g>

          <circle cx="214" cy="180" r="22" className="morning-joint-ring" />
        </g>

        <g className="morning-sparks">
          <circle cx="258" cy="262" r="2.4" />
          <circle cx="166" cy="300" r="2" />
          <circle cx="276" cy="220" r="1.7" />
          <circle cx="148" cy="224" r="1.8" />
        </g>

        <rect x="0" y="-70" width="440" height="70" fill="url(#morning-scan)" className="morning-scan" />
      </g>
    </svg>
  );
}

export function MorningHero() {
  const [mantraIndex, setMantraIndex] = useState(0);
  const [greeting] = useState(() => getGreeting(new Date().getHours()));
  const { label, Icon } = greeting;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMantraIndex((index) => (index + 1) % MANTRAS.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="morning-hero">
      <div className="morning-hero-copy">
        <span className="morning-hero-pill">
          <Icon size={14} /> {label} rounds
        </span>
        <h2 className="morning-hero-title">
          {label}, <span>Doctor.</span>
        </h2>
        <p className="morning-hero-lead">Let&rsquo;s put today&rsquo;s joints back in motion.</p>
        <p className="morning-hero-quote" key={mantraIndex}>{MANTRAS[mantraIndex]}</p>
        <div className="morning-hero-chips">
          <span><Activity size={14} /> Steady hands</span>
          <span><Stethoscope size={14} /> Clear plan</span>
          <span><HeartPulse size={14} /> Restore motion</span>
          <span><Bone size={14} /> Joint by joint</span>
        </div>
      </div>

      <div className="morning-hero-visual">
        <div className="morning-hero-hud">
          <span className="morning-hero-live"><i /> Simulated procedure</span>
          <span>Knee · ORIF</span>
        </div>
        <JointFixationScene />
        <p className="morning-hero-caption">Animated joint-fixation concept — illustrative only.</p>
      </div>
    </section>
  );
}
