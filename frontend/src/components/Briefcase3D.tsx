export default function Briefcase3D() {
  return (
    <div style={{ perspective: '600px', width: '280px', height: '220px', margin: '0 auto' }}>
      <div className="briefcase-3d">
        <svg
          viewBox="0 0 280 220"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 20px 40px rgba(245,166,35,0.3))' }}
        >
          <defs>
            <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4a4a4a" />
              <stop offset="100%" stopColor="#2a2a2a" />
            </linearGradient>
            <linearGradient id="arrowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#B8791A" />
              <stop offset="100%" stopColor="#FFD080" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <ellipse cx="140" cy="210" rx="80" ry="8" fill="rgba(0,0,0,0.5)" />
          <rect x="40" y="80" width="200" height="130" rx="16" fill="url(#bodyGrad)" stroke="#555" strokeWidth="2" />
          <rect x="40" y="80" width="200" height="40" rx="16" fill="rgba(255,255,255,0.04)" />
          <rect x="122" y="138" width="36" height="24" rx="5" fill="#333" stroke="#555" strokeWidth="1.5" />
          <rect x="128" y="144" width="24" height="12" rx="3" fill="#222" stroke="#666" strokeWidth="1" />
          <path d="M 110 80 Q 110 52 140 52 Q 170 52 170 80" fill="none" stroke="#555" strokeWidth="8" strokeLinecap="round" />
          <path d="M 110 80 Q 110 58 140 58 Q 170 58 170 80" fill="none" stroke="#333" strokeWidth="4" strokeLinecap="round" />
          <line x1="44" y1="148" x2="236" y2="148" stroke="#555" strokeWidth="1.5" />
          <path d="M 90 185 L 210 75" stroke="url(#arrowGrad)" strokeWidth="4" strokeLinecap="round" filter="url(#glow)" />
          <polygon points="210,75 192,72 200,88" fill="url(#arrowGrad)" filter="url(#glow)" />
          <circle cx="220" cy="65" r="3" fill="#FFD080" opacity="0.8" style={{ animation: 'pulse 2s 0.3s infinite' }} />
          <circle cx="232" cy="78" r="2" fill="#F5A623" opacity="0.6" style={{ animation: 'pulse 2s 0.7s infinite' }} />
          <circle cx="215" cy="82" r="1.5" fill="#FFD080" opacity="0.5" style={{ animation: 'pulse 2s 1.1s infinite' }} />
        </svg>
      </div>
    </div>
  );
}
