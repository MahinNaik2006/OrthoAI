export function ImagingScanner() {
  return (
    <div className="imaging-scanner" aria-hidden="true">
      <div className="imaging-scanner-hud">
        <span className="imaging-scanner-live"><i /> Imaging bay</span>
        <span>Axial · CT</span>
      </div>

      <svg viewBox="0 0 480 340" focusable="false">
        <defs>
          <linearGradient id="imaging-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8dffe0" />
            <stop offset="50%" stopColor="#55c9d8" />
            <stop offset="100%" stopColor="#4b86d6" />
          </linearGradient>
          <radialGradient id="imaging-aura">
            <stop offset="0%" stopColor="#58f2d0" stopOpacity="0.32" />
            <stop offset="55%" stopColor="#3aa6c4" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#3aa6c4" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="imaging-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#9dffe6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#9dffe6" stopOpacity="0" />
          </linearGradient>
          <clipPath id="imaging-body-clip">
            <circle cx="210" cy="168" r="94" />
          </clipPath>
        </defs>

        <ellipse cx="220" cy="168" rx="190" ry="160" fill="url(#imaging-aura)" className="imaging-aura" />

        <g clipPath="url(#imaging-body-clip)">
          <circle cx="210" cy="168" r="94" className="imaging-scan-disc" />
          <g className="imaging-sweep">
            <path d="M210 168 L210 74 A94 94 0 0 1 257 86.6 Z" fill="url(#imaging-beam)" />
            <line x1="210" y1="168" x2="210" y2="74" className="imaging-sweep-edge" />
          </g>

          <g className="imaging-anatomy">
            <ellipse cx="210" cy="168" rx="68" ry="47" className="imaging-body-outline" />
            <ellipse cx="192" cy="160" rx="18" ry="25" className="imaging-lung" />
            <ellipse cx="228" cy="160" rx="18" ry="25" className="imaging-lung" />
            <circle cx="225" cy="177" r="8" className="imaging-heart" />
            <rect x="202" y="196" width="16" height="15" rx="4" className="imaging-spine" />
            <rect x="204" y="123" width="12" height="6" rx="3" className="imaging-sternum" />
            <path d="M168 132 q-10 10-6 22" className="imaging-rib" />
            <path d="M156 148 q-9 10-4 22" className="imaging-rib" />
            <path d="M150 166 q-7 10-1 21" className="imaging-rib" />
            <path d="M149 184 q-5 10 2 20" className="imaging-rib" />
            <path d="M153 201 q-2 9 6 17" className="imaging-rib" />
            <path d="M252 132 q10 10 6 22" className="imaging-rib" />
            <path d="M264 148 q9 10 4 22" className="imaging-rib" />
            <path d="M270 166 q7 10 1 21" className="imaging-rib" />
            <path d="M271 184 q5 10-2 20" className="imaging-rib" />
            <path d="M267 201 q2 9-6 17" className="imaging-rib" />
          </g>
        </g>

        <circle cx="210" cy="168" r="118" className="imaging-ring-outer" />
        <circle cx="210" cy="168" r="118" className="imaging-ring-dashes" />
        <circle cx="210" cy="168" r="132" className="imaging-ring-ticks" />
        <circle cx="210" cy="168" r="96" className="imaging-ring-inner" />

        <g className="imaging-crosshair">
          <line x1="210" y1="80" x2="210" y2="96" />
          <line x1="210" y1="240" x2="210" y2="256" />
          <line x1="122" y1="168" x2="138" y2="168" />
          <line x1="282" y1="168" x2="298" y2="168" />
        </g>

        <g className="imaging-slice-stack">
          <g className="imaging-slice-card is-back">
            <rect x="362" y="82" width="72" height="92" rx="10" />
          </g>
          <g className="imaging-slice-card is-mid">
            <rect x="374" y="96" width="72" height="92" rx="10" />
          </g>
          <g className="imaging-slice-card is-front">
            <rect x="386" y="110" width="72" height="92" rx="10" />
            <ellipse cx="422" cy="156" rx="22" ry="15" />
            <circle cx="422" cy="156" r="4" />
          </g>
        </g>

        <g className="imaging-particles">
          <circle cx="104" cy="92" r="2.2" />
          <circle cx="332" cy="72" r="1.8" />
          <circle cx="84" cy="228" r="1.6" />
          <circle cx="322" cy="262" r="2" />
        </g>
      </svg>

      <div className="imaging-scanner-footer">
        <span>NIfTI volume</span>
        <span>MONAI-ready</span>
        <span>3D surface</span>
      </div>
    </div>
  );
}
