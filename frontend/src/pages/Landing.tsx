import ParticleCanvas from '../components/ParticleCanvas';
import Briefcase3D from '../components/Briefcase3D';

interface LandingProps {
  onEnter: () => void;
}

const FEATURES = [
  {
    icon: '🧠',
    name: 'LLM-Powered Matching',
    desc: 'Local models via Ollama analyze your resume and score each job against your actual profile — not just keywords.',
  },
  {
    icon: '📄',
    name: 'Smart Resume Parsing',
    desc: 'Upload PDF or DOCX. The system extracts your skills, experience level, and domain focus to auto-populate search filters.',
  },
  {
    icon: '🔍',
    name: 'Multi-Source Search',
    desc: 'Built on a JobSpy fork — aggregates listings from LinkedIn, Indeed, and more into one clean interface.',
  },
  {
    icon: '📊',
    name: 'Gap Analysis',
    desc: 'For every job, get a breakdown of where you match, where you fall short, and exactly what to do about it.',
  },
  {
    icon: '🔒',
    name: '100% Local & Private',
    desc: 'Your resume never leaves your machine. All inference runs locally via Ollama by default. APIs are opt-in.',
  },
  {
    icon: '🔧',
    name: 'Open Source & Extensible',
    desc: 'Fork it. Add scrapers, swap LLMs, integrate your ATS. Designed for developers to build on top of.',
  },
];

export default function Landing({ onEnter }: LandingProps) {
  return (
    <div className="landing">
      <ParticleCanvas />

      <nav className="nav">
        <div className="nav-logo">
          JUMP<span>SHIP</span>
        </div>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a></li>
          <li><a href="#">Docs</a></li>
        </ul>
        <button className="nav-cta" onClick={onEnter}>
          Launch App {'\u2192'}
        </button>
      </nav>

      <section className="hero">
        <div className="hero-badge">Open Source · AI-Powered · Local-First</div>
        <h1 className="hero-title">
          Find jobs that
          <br />
          <span className="accent">actually fit you.</span>
          <span className="line2">Not the other way around.</span>
        </h1>
        <p className="hero-sub">
          Upload your resume. JumpShip parses your profile, auto-extracts search filters,
          and uses local LLMs to score and explain every listing — privately, on your machine.
        </p>
        <div className="hero-actions">
          <button className="btn-primary" onClick={onEnter}>
            Start searching {'\u2197'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => window.open('https://github.com', '_blank')}
          >
            Star on GitHub
          </button>
        </div>

        <Briefcase3D />

        <div className="scroll-hint">
          <span>Scroll</span>
          <div className="scroll-line" />
        </div>
      </section>

      <section className="features" id="features">
        <div className="section-label">Why JumpShip</div>
        <h2 className="section-title">
          Your resume is the
          <br />
          <span style={{ color: 'var(--gold)' }}>algorithm.</span>
        </h2>
        <p className="section-sub">
          No more generic job boards. Let your actual experience drive the search.
        </p>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.name} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-name">{f.name}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '80px 48px',
          textAlign: 'center',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div className="section-label">Open Source</div>
        <h2 className="section-title" style={{ margin: '0 auto 16px', maxWidth: 600 }}>
          Built for developers
          <br />
          to build on top of.
        </h2>
        <p className="section-sub" style={{ margin: '0 auto 36px' }}>
          Fork it. Plug in your scraper. Swap the LLM. Add an ATS integration. JumpShip is
          infrastructure — bring your own features.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn-primary">View on GitHub {'\u2192'}</button>
          <button className="btn-secondary">Read the Docs</button>
        </div>
      </section>
    </div>
  );
}
