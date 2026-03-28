import { useEffect, useRef } from 'react';
import ParticleCanvas from '../components/ParticleCanvas';

// ── Links — update these to your real URLs ────────────────────────────────
const LINKS = {
  portfolio:    'https://awi-24.github.io',
  jumpshipRepo: 'https://github.com/Awi-24/JumpShip',
  jobspyRepo:   'https://github.com/Bunsly/JobSpy',
};

interface LandingProps {
  onEnter: () => void;
}

const FEATURES = [
  {
    icon: '🧠',
    name: 'LLM-Powered Matching',
    desc: 'Local or cloud models score every job against your actual profile — not just keywords. Powered by Ollama, Groq, OpenAI, or Anthropic.',
  },
  {
    icon: '📄',
    name: 'Smart Resume Parsing',
    desc: 'Upload PDF or DOCX. The AI extracts your skills, seniority, and domain focus to auto-populate search filters and rank results.',
  },
  {
    icon: '🔍',
    name: 'Multi-Source Search',
    desc: 'Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, RemoteOK, and Arbeitnow into one clean, unified interface.',
  },
  {
    icon: '📊',
    name: 'Deep Gap Analysis',
    desc: 'For every job: a calibrated match score, specific strong points, honest gaps, and career suggestions tailored to your profile.',
  },
  {
    icon: '🌐',
    name: 'Company Intelligence',
    desc: 'Each assessment is enriched with live web data: culture reviews, typical salaries, Glassdoor sentiment, and company reputation.',
  },
  {
    icon: '🔒',
    name: '100% Private',
    desc: 'Your resume stays on your machine. Inference runs locally via Ollama by default. Cloud APIs are opt-in and key-controlled.',
  },
];

const HOW_STEPS = [
  {
    num: '01',
    title: 'Upload your résumé',
    desc: 'Drop your PDF or DOCX. The LLM parses your profile, extracts skills and domains, and auto-fills search keywords.',
  },
  {
    num: '02',
    title: 'Pick your boards',
    desc: 'Choose which job boards to scrape — LinkedIn, Indeed, RemoteOK, Arbeitnow, and more — all in one click.',
  },
  {
    num: '03',
    title: 'Get scored results',
    desc: 'Every job gets an AI match score (0–100), gap analysis, and company intelligence — automatically, in parallel.',
  },
];

function useScrollReveal() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => e.isIntersecting && e.target.classList.add('revealed')),
      { threshold: 0.12 }
    );
    el.querySelectorAll('.reveal').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return ref;
}

export default function Landing({ onEnter }: LandingProps) {
  const bodyRef = useScrollReveal();

  return (
    <div className="landing" ref={bodyRef as React.RefObject<HTMLDivElement>}>
      <ParticleCanvas />

      {/* ── NAV ── */}
      <nav className="nav">
        <div className="nav-logo">
          <img src="/logo-icon.png" alt="JumpShip" className="nav-logo-icon" />
          <span>Jump<span className="logo-accent">Ship</span></span>
        </div>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="#how">How it works</a></li>
          <li><a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer">JobSpy</a></li>
          <li><a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer">Portfolio</a></li>
        </ul>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a
            href={LINKS.jumpshipRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{ padding: '8px 18px', fontSize: 13, textDecoration: 'none' }}
          >
            ★ GitHub
          </a>
          <button className="nav-cta" onClick={onEnter}>Launch App →</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-logo-full">
          <img src="/logo-full.png" alt="JumpShip" />
        </div>
        <div className="hero-badge">Open Source · AI-Powered · Privacy-First</div>
        <h1 className="hero-title">
          Find jobs that
          <br />
          <span className="accent">actually fit you.</span>
          <span className="line2">Not the other way around.</span>
        </h1>
        <p className="hero-sub">
          Upload your résumé. JumpShip parses your profile, auto-fills search filters,
          and uses LLMs to score, explain, and rank every listing — with live company intelligence.
        </p>
        <div className="hero-actions">
          <button className="btn-primary" onClick={onEnter}>Start searching ↗</button>
          <a
            href={LINKS.jumpshipRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            ★ Star on GitHub
          </a>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="landing-section" id="how">
        <div className="landing-section-inner">
          <div className="section-label reveal">How it works</div>
          <h2 className="section-title reveal">Three steps to your<br /><span style={{ color: 'var(--gold)' }}>next opportunity.</span></h2>
          <div className="how-grid">
            {HOW_STEPS.map((step, i) => (
              <div key={step.num} className="how-card reveal" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="how-num">{step.num}</div>
                <div className="how-title">{step.title}</div>
                <div className="how-desc">{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="features" id="features">
        <div className="section-label reveal">Why JumpShip</div>
        <h2 className="section-title reveal">
          Your résumé is the<br />
          <span style={{ color: 'var(--gold)' }}>algorithm.</span>
        </h2>
        <p className="section-sub reveal">No more generic job boards. Let your actual experience drive the search.</p>
        <div className="features-grid">
          {FEATURES.map((f, i) => (
            <div key={f.name} className="feature-card reveal" style={{ animationDelay: `${(i % 3) * 0.08}s` }}>
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-name">{f.name}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── OPEN SOURCE ── */}
      <section className="landing-section landing-section--border">
        <div className="landing-section-inner" style={{ textAlign: 'center' }}>
          <div className="section-label reveal">Open Source</div>
          <h2 className="section-title reveal" style={{ margin: '0 auto 16px', maxWidth: 640 }}>
            Built to be forked,<br />extended, and owned.
          </h2>
          <p className="section-sub reveal" style={{ margin: '0 auto 36px', textAlign: 'center' }}>
            JumpShip is infrastructure for your job search. Fork it, plug in your scraper,
            swap the LLM, or integrate your ATS. All in one clean codebase.
          </p>
          <div className="reveal" style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ textDecoration: 'none' }}>
              View JumpShip on GitHub →
            </a>
            <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ textDecoration: 'none' }}>
              Original JobSpy →
            </a>
            <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ textDecoration: 'none' }}>
              Author's Portfolio →
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="landing-section">
        <div className="landing-cta-box reveal">
          <div className="section-label" style={{ margin: '0 0 12px' }}>Ready?</div>
          <h2 className="section-title" style={{ fontSize: 'clamp(28px, 4vw, 48px)', margin: '0 0 16px' }}>
            Start your search now.
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 28 }}>
            No account needed. Works locally. Takes 30 seconds.
          </p>
          <button className="btn-primary" onClick={onEnter} style={{ fontSize: 16, padding: '14px 40px', margin: '0 auto' }}>
            Launch JumpShip ↗
          </button>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="landing-footer">
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Built by{' '}
          <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            Adrian Widmer
          </a>{' '}
          · Fork of{' '}
          <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            JobSpy
          </a>{' '}
          ·{' '}
          <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
