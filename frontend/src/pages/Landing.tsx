import { useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Brain,
  ExternalLink,
  FileText,
  Globe,
  Lock,
  Search,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ParticleCanvas from '../components/ParticleCanvas';
import ArchitectureFlowchart from '../components/ArchitectureFlowchart';

const LINKS = {
  portfolio: 'https://awi-24.github.io',
  jumpshipRepo: 'https://github.com/Awi-24/JumpShip',
  jobspyRepo: 'https://github.com/Bunsly/JobSpy',
  openwork: 'https://github.com/different-ai/openwork',
  openclaw: 'https://github.com/openclaw/openclaw',
};

interface LandingProps {
  onEnter: () => void;
}

const FEATURES: { Icon: LucideIcon; name: string; desc: string }[] = [
  {
    Icon: Brain,
    name: 'LLM-powered matching',
    desc: 'Local or cloud models score every job against your actual profile — not just keywords. Powered by Ollama, Groq, OpenAI, or Anthropic.',
  },
  {
    Icon: FileText,
    name: 'Smart résumé parsing',
    desc: 'Upload PDF or DOCX. The AI extracts your skills, seniority, and domain focus to auto-populate search filters and rank results.',
  },
  {
    Icon: Search,
    name: 'Multi-source search',
    desc: 'Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, RemoteOK, and Arbeitnow into one clean, unified interface.',
  },
  {
    Icon: BarChart3,
    name: 'Deep gap analysis',
    desc: 'For every job: a calibrated match score, specific strong points, honest gaps, and career suggestions tailored to your profile.',
  },
  {
    Icon: Globe,
    name: 'Company intelligence',
    desc: 'Each assessment is enriched with live web data: culture reviews, typical salaries, Glassdoor sentiment, and company reputation.',
  },
  {
    Icon: Lock,
    name: 'Privacy-first',
    desc: 'Your résumé stays on your machine. Inference runs locally via Ollama by default. Cloud APIs are opt-in and key-controlled.',
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

const APP_FLOW = [
  {
    title: 'Profile in the loop',
    desc: 'Structured profile from your CV drives keywords, filters, and how the LLM judges fit — not a generic job-board algorithm.',
  },
  {
    title: 'Search once, many boards',
    desc: 'One query fans out to multiple scrapers; results are deduplicated and normalized so you compare apples to apples.',
  },
  {
    title: 'Assess in parallel',
    desc: 'After fetch, assessments run concurrently (speed tier in Settings). Scores and narratives land as each job finishes.',
  },
  {
    title: 'Track and act',
    desc: 'Save roles to the tracker, export CSV/JSON, or hand off to application agents when you want automation with oversight.',
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

      <nav className="nav">
        <div className="nav-logo">
          <img src="/logo-icon.png" alt="JumpShip" className="nav-logo-icon" />
          <span>
            Jump<span className="logo-accent">Ship</span>
          </span>
        </div>
        <ul className="nav-links">
          <li>
            <a href="#flow">Product flow</a>
          </li>
          <li>
            <a href="#how">How it works</a>
          </li>
          <li>
            <a href="#architecture">Architecture</a>
          </li>
          <li>
            <a href="#philosophy">Philosophy</a>
          </li>
          <li>
            <a href="#features">Features</a>
          </li>
          <li>
            <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer">
              JobSpy
            </a>
          </li>
          <li>
            <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer">
              Portfolio
            </a>
          </li>
        </ul>
        <div className="nav-actions">
          <a
            href={LINKS.jumpshipRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary btn-with-icon"
          >
            <Star size={16} strokeWidth={1.75} aria-hidden />
            GitHub
          </a>
          <button type="button" className="nav-cta btn-with-icon" onClick={onEnter}>
            Launch app
            <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-logo-full">
          <img src="/logo-full.png" alt="JumpShip" />
        </div>
        <div className="hero-badge">Open source · AI-assisted · Privacy-first</div>
        <h1 className="hero-title">
          Find jobs that
          <br />
          <span className="accent">actually fit you.</span>
          <span className="line2">Not the other way around.</span>
        </h1>
        <p className="hero-sub">
          JumpShip is a local-first control surface for your job search: upload a résumé, aggregate listings from many boards,
          and let an LLM explain fit, gaps, and next steps — with optional agents when you want help applying under your own
          review.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn-primary btn-with-icon" onClick={onEnter}>
            Start searching
            <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <a
            href={LINKS.jumpshipRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary btn-with-icon"
          >
            <Star size={18} strokeWidth={1.75} aria-hidden />
            Star on GitHub
          </a>
        </div>
      </section>

      {/* Alternating bands: title left / title right / … */}
      <section className="landing-section landing-section--band" id="flow">
        <div className="landing-split landing-split--title-left">
          <div className="landing-split__title reveal">
            <div className="section-label">Inside the app</div>
            <h2 className="section-title section-title--split">
              What happens after you{' '}
              <span className="text-accent">open JumpShip</span>
            </h2>
            <p className="section-sub section-sub--split">
              The search view is your hub: sidebar filters and LLM status on the left, ranked results on the right. Profile refines
              who you are; Agents and Tracker are separate screens when you need deeper workflows.
            </p>
          </div>
          <div className="landing-split__content reveal">
            <div className="flow-grid flow-grid--in-split">
              {APP_FLOW.map((item, i) => (
                <div key={item.title} className="flow-card" style={{ animationDelay: `${i * 0.06}s` }}>
                  <div className="flow-card-title">{item.title}</div>
                  <p className="flow-card-desc">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--band landing-section--border" id="how">
        <div className="landing-split landing-split--title-right">
          <div className="landing-split__title reveal">
            <div className="section-label">How it works</div>
            <h2 className="section-title section-title--split">
              Three steps to your{' '}
              <span className="text-accent">next opportunity.</span>
            </h2>
            <p className="section-sub section-sub--split">
              Upload, configure sources, then let the stack score and explain every listing in parallel.
            </p>
          </div>
          <div className="landing-split__content reveal">
            <div className="how-grid how-grid--in-split">
              {HOW_STEPS.map((step, i) => (
                <div key={step.num} className="how-card" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="how-num">{step.num}</div>
                  <div className="how-title">{step.title}</div>
                  <div className="how-desc">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--band" id="architecture">
        <div className="landing-split landing-split--title-left">
          <div className="landing-split__title reveal">
            <div className="section-label">System architecture</div>
            <h2 className="section-title section-title--split">
              One browser app,{' '}
              <span className="text-accent">several backend concerns.</span>
            </h2>
            <p className="section-sub section-sub--split">
              The UI talks to a single FastAPI service. That service coordinates scraping and normalization, calls your chosen LLM
              for structured JSON assessments, and streams agent activity over WebSocket when you run automated applications.
            </p>
            <ul className="architecture-legend architecture-legend--split">
              <li>
                <strong>Thin client</strong> — settings and keys stay in your browser.
              </li>
              <li>
                <strong>Pluggable models</strong> — same pipeline for local OpenAI-compatible servers and cloud APIs.
              </li>
              <li>
                <strong>Agents optional</strong> — human-in-the-loop when automation needs approval.
              </li>
            </ul>
          </div>
          <div className="landing-split__content reveal">
            <ArchitectureFlowchart />
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--band landing-section--border" id="philosophy">
        <div className="landing-split landing-split--title-right">
          <div className="landing-split__title reveal">
            <div className="section-label">Why this exists</div>
            <h2 className="section-title section-title--split">
              Same ideas as{' '}
              <span className="text-accent">agent tooling.</span>
            </h2>
            <p className="section-sub section-sub--split">
              Open, local-first control — applied to hiring instead of only to coding.
            </p>
          </div>
          <div className="landing-split__content reveal">
            <div className="philosophy-block philosophy-block--split">
              <p className="philosophy-text">
                I took inspiration from open-source agent and orchestration tools such as{' '}
                <a href={LINKS.openwork} target="_blank" rel="noopener noreferrer" className="inline-link">
                  OpenWork
                  <ExternalLink size={14} strokeWidth={1.75} className="inline-link-icon" aria-hidden />
                </a>{' '}
                and{' '}
                <a href={LINKS.openclaw} target="_blank" rel="noopener noreferrer" className="inline-link">
                  OpenClaw
                  <ExternalLink size={14} strokeWidth={1.75} className="inline-link-icon" aria-hidden />
                </a>
                : local-first control, clear audit trails, and composable automation. Those ideas are often applied to coding
                assistants and personal agents. JumpShip applies the same mindset to{' '}
                <em>finding and evaluating work</em> — so you spend time on roles that match your story, not only on what keyword
                filters happen to surface.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--band" id="features">
        <div className="landing-split landing-split--title-left">
          <div className="landing-split__title reveal">
            <div className="section-label">Why JumpShip</div>
            <h2 className="section-title section-title--split">
              Your résumé is the{' '}
              <span className="text-accent">algorithm.</span>
            </h2>
            <p className="section-sub section-sub--split">No more generic job boards. Let your actual experience drive the search.</p>
          </div>
          <div className="landing-split__content reveal">
            <div className="features-grid features-grid--in-split">
              {FEATURES.map((f, i) => (
                <div key={f.name} className="feature-card" style={{ animationDelay: `${(i % 3) * 0.08}s` }}>
                  <div className="feature-icon" aria-hidden>
                    <f.Icon size={22} strokeWidth={1.75} />
                  </div>
                  <div className="feature-name">{f.name}</div>
                  <div className="feature-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Centered tail */}
      <section className="landing-section landing-section--border landing-section--centered">
        <div className="landing-section-inner landing-section-inner--center">
          <div className="section-label reveal">Open source</div>
          <h2 className="section-title reveal section-title--center">
            Built to be forked,
            <br />
            extended, and owned.
          </h2>
          <p className="section-sub reveal section-sub--center">
            JumpShip is infrastructure for your job search. Fork it, plug in your scraper, swap the LLM, or integrate your ATS. All
            in one codebase.
          </p>
          <div className="reveal landing-link-row">
            <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" className="btn-primary btn-with-icon">
              View on GitHub
              <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden />
            </a>
            <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-with-icon">
              Original JobSpy
              <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
            </a>
            <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-with-icon">
              Author portfolio
              <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
            </a>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--centered">
        <div className="landing-cta-box reveal">
          <div className="section-label landing-cta-label">Ready?</div>
          <h2 className="section-title landing-cta-title">Start your search now.</h2>
          <p className="landing-cta-sub">No account required. Works locally. Takes about a minute to configure.</p>
          <button type="button" className="btn-primary btn-with-icon landing-cta-btn" onClick={onEnter}>
            Launch JumpShip
            <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner landing-footer-inner--center">
          Built by{' '}
          <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer" className="footer-link">
            Adrian Widmer
          </a>{' '}
          · Fork of{' '}
          <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer" className="footer-link">
            JobSpy
          </a>{' '}
          ·{' '}
          <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" className="footer-link">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
