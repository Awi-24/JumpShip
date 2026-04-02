import { useId } from 'react';

/**
 * Architecture diagram — dark theme with gold accents and distinct service hues.
 */
export default function ArchitectureFlowchart() {
  const uid = useId().replace(/:/g, '');

  const gold = '#F5A623';
  const goldDim = 'rgba(245, 166, 35, 0.35)';
  const text = '#E8E4DC';
  const muted = '#9A958C';
  const nodeBg = '#141414';
  const aggStroke = 'rgba(96, 165, 250, 0.55)';
  const llmStroke = 'rgba(245, 166, 35, 0.65)';
  const agentStroke = 'rgba(167, 139, 250, 0.55)';

  return (
    <figure className="architecture-flowchart" aria-label="JumpShip system architecture">
      <svg viewBox="0 0 880 480" className="architecture-flowchart-svg" role="img">
        <title>JumpShip data flow: browser, API, and backend services</title>
        <defs>
          <linearGradient id={`${uid}-g-client`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1A1814" />
            <stop offset="100%" stopColor="#252018" />
          </linearGradient>
          <linearGradient id={`${uid}-g-api`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(245,166,35,0.12)" />
            <stop offset="100%" stopColor="rgba(245,166,35,0.04)" />
          </linearGradient>
          <linearGradient id={`${uid}-g-agg`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(96,165,250,0.14)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0.04)" />
          </linearGradient>
          <linearGradient id={`${uid}-g-llm`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(245,166,35,0.18)" />
            <stop offset="100%" stopColor="rgba(245,166,35,0.05)" />
          </linearGradient>
          <linearGradient id={`${uid}-g-agent`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(167,139,250,0.16)" />
            <stop offset="100%" stopColor="rgba(167,139,250,0.05)" />
          </linearGradient>
          <filter id={`${uid}-soft-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id={`${uid}-arrow`} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill={goldDim} />
          </marker>
        </defs>

        {/* Swimlane labels */}
        <text x="24" y="28" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif" letterSpacing="2">
          CLIENT
        </text>
        <text x="24" y="128" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif" letterSpacing="2">
          GATEWAY
        </text>
        <text x="24" y="228" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif" letterSpacing="2">
          SERVICES
        </text>

        {/* Row 1: Browser */}
        <g filter={`url(#${uid}-soft-glow)`}>
          <rect x="200" y="40" width="480" height="72" rx="12" fill={`url(#${uid}-g-client)`} stroke={gold} strokeWidth="1.5" opacity="0.95" />
          <text x="440" y="72" textAnchor="middle" fill={text} fontSize="15" fontFamily="Roboto, sans-serif" fontWeight="700">
            React SPA (Vite)
          </text>
          <text x="440" y="92" textAnchor="middle" fill={muted} fontSize="12" fontFamily="DM Sans, sans-serif">
            Search · Profile · Agents · Tracker
          </text>
        </g>

        {/* Arrow down */}
        <line x1="440" y1="112" x2="440" y2="142" stroke={goldDim} strokeWidth="2" markerEnd={`url(#${uid}-arrow)`} />

        {/* Row 2: API */}
        <rect x="160" y="148" width="560" height="64" rx="12" fill={`url(#${uid}-g-api)`} stroke={gold} strokeWidth="1.5" />
        <text x="440" y="186" textAnchor="middle" fill={text} fontSize="14" fontFamily="Roboto, sans-serif" fontWeight="700">
          FastAPI — REST + WebSocket
        </text>

        {/* Fork: trunk + bar + three drops */}
        <line x1="440" y1="212" x2="440" y2="232" stroke={goldDim} strokeWidth="2" markerEnd={`url(#${uid}-arrow)`} />
        <line x1="140" y1="232" x2="740" y2="232" stroke={goldDim} strokeWidth="1.75" />
        <line x1="140" y1="232" x2="140" y2="284" stroke={goldDim} strokeWidth="1.75" markerEnd={`url(#${uid}-arrow)`} />
        <line x1="440" y1="232" x2="440" y2="284" stroke={goldDim} strokeWidth="1.75" markerEnd={`url(#${uid}-arrow)`} />
        <line x1="740" y1="232" x2="740" y2="284" stroke={goldDim} strokeWidth="1.75" markerEnd={`url(#${uid}-arrow)`} />

        {/* Three service nodes */}
        <g>
          <rect x="40" y="284" width="200" height="140" rx="12" fill={nodeBg} stroke={aggStroke} strokeWidth="1.5" fillOpacity="1" />
          <rect x="40" y="284" width="200" height="140" rx="12" fill={`url(#${uid}-g-agg)`} />
          <text x="140" y="312" textAnchor="middle" fill="#93C5FD" fontSize="13" fontFamily="Roboto, sans-serif" fontWeight="700">
            Aggregation
          </text>
          <text x="140" y="338" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif">
            JobSpy + adapters
          </text>
          <text x="140" y="358" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif">
            Dedup · cache
          </text>
          <text x="140" y="390" textAnchor="middle" fill={muted} fontSize="10" fontFamily="DM Sans, sans-serif" opacity="0.85">
            → normalized listings
          </text>
        </g>

        <g>
          <rect x="340" y="284" width="200" height="140" rx="12" fill={nodeBg} stroke={llmStroke} strokeWidth="1.5" />
          <rect x="340" y="284" width="200" height="140" rx="12" fill={`url(#${uid}-g-llm)`} />
          <text x="440" y="312" textAnchor="middle" fill={gold} fontSize="13" fontFamily="Roboto, sans-serif" fontWeight="700">
            LLM pipeline
          </text>
          <text x="440" y="338" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif">
            Résumé · assess · keywords
          </text>
          <text x="440" y="358" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif">
            Ollama / cloud APIs
          </text>
          <text x="440" y="390" textAnchor="middle" fill={muted} fontSize="10" fontFamily="DM Sans, sans-serif" opacity="0.85">
            → structured JSON
          </text>
        </g>

        <g>
          <rect x="640" y="284" width="200" height="140" rx="12" fill={nodeBg} stroke={agentStroke} strokeWidth="1.5" />
          <rect x="640" y="284" width="200" height="140" rx="12" fill={`url(#${uid}-g-agent)`} />
          <text x="740" y="312" textAnchor="middle" fill="#C4B5FD" fontSize="13" fontFamily="Roboto, sans-serif" fontWeight="700">
            Agents + data
          </text>
          <text x="740" y="338" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif">
            Browser automation
          </text>
          <text x="740" y="358" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif">
            SQLite · live logs
          </text>
          <text x="740" y="390" textAnchor="middle" fill={muted} fontSize="10" fontFamily="DM Sans, sans-serif" opacity="0.85">
            → HITL prompts
          </text>
        </g>

        {/* Bottom note */}
        <text x="440" y="455" textAnchor="middle" fill={muted} fontSize="11" fontFamily="DM Sans, sans-serif" opacity="0.75">
          All traffic stays under your stack · Keys in browser for cloud providers
        </text>
      </svg>
    </figure>
  );
}
