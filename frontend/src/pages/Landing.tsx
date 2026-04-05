import { motion, type Variants } from 'framer-motion';
import {
  Brain, FileText, Search, BarChart3, Globe, Lock, Star,
  Bot, Bookmark, Zap, ChevronRight, Database,
} from 'lucide-react';
import ParticleCanvas from '../components/ParticleCanvas';
import ThemeToggle from '../components/ThemeToggle';

const LINKS = {
  portfolio: 'https://awi-24.github.io',
  jumpshipRepo: 'https://github.com/Awi-24/JumpShip',
  jobspyRepo: 'https://github.com/Bunsly/JobSpy',
};

interface LandingProps {
  onEnter: () => void;
}

const VIEWPORT = { once: true, amount: 0.22, margin: '0px 0px -10% 0px' };

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 36 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE_OUT },
  },
};

const staggerParent: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.06 },
  },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE_OUT },
  },
};

const FEATURES = [
  {
    Icon: Brain,
    name: 'LLM-Powered Matching',
    desc: 'Local or cloud models score every job against your actual profile — not just keywords. Powered by Ollama, Groq, OpenAI, or Anthropic.',
  },
  {
    Icon: FileText,
    name: 'Smart Resume Parsing',
    desc: 'Upload PDF or DOCX. The AI extracts your skills, seniority, and domain focus to auto-populate search filters and rank results.',
  },
  {
    Icon: Search,
    name: 'Multi-Source Search',
    desc: 'Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, RemoteOK, and Arbeitnow into one clean, unified interface.',
  },
  {
    Icon: BarChart3,
    name: 'Deep Gap Analysis',
    desc: 'For every job: a calibrated match score, specific strong points, honest gaps, and career suggestions tailored to your profile.',
  },
  {
    Icon: Bot,
    name: 'Auto-Apply Agents',
    desc: 'Autonomous Playwright agents fill and submit applications on Greenhouse, Lever, LinkedIn, and more — running locally, in parallel, based on your profile.',
  },
  {
    Icon: Globe,
    name: 'Company Intelligence',
    desc: 'Each assessment is enriched with live web data: culture reviews, typical salaries, Glassdoor sentiment, and company reputation.',
  },
  {
    Icon: Bookmark,
    name: 'Application Tracker',
    desc: 'Kanban-style board tracks every application from Saved → Applied → Interview → Offer. Export to CSV anytime.',
  },
  {
    Icon: Lock,
    name: '100% Private',
    desc: 'Your resume stays on your machine. Inference runs locally via Ollama by default. Cloud APIs are opt-in and key-controlled.',
  },
];

const WHY_JUMPSHIP_BOXES = [
  {
    title: 'Résumé-native ranking',
    desc: 'Scores reflect your real experience — not keyword stuffing or generic filters.',
  },
  {
    title: 'Privacy by default',
    desc: 'Keep data on your machine; use Ollama locally or opt into cloud APIs with your keys.',
  },
  {
    title: 'Yours to extend',
    desc: 'Open source: swap scrapers, models, and agent strategies without vendor lock-in.',
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
    title: 'Get scored results',
    desc: 'Every job gets an AI match score (0–100), gap analysis, and company intelligence — automatically, in parallel.',
  },
  {
    num: '03',
    title: 'Apply autonomously',
    desc: 'Queue jobs for auto-apply. Agents fill forms on Greenhouse, Lever, LinkedIn and more — review in dry-run before going live.',
  },
];

export default function Landing({ onEnter }: LandingProps) {
  return (
    <div className="landing">
      <ParticleCanvas />

      <nav className="nav">
        <div className="nav-logo">
          <img src="/logo-icon.png" alt="JumpShip" className="nav-logo-icon" />
          <span>
            Jump<span className="logo-accent">Ship</span>
          </span>
        </div>
        <ul className="nav-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#why-jumpship">Why JumpShip</a></li>
          <li><a href="#inside-app">Inside the app</a></li>
          <li><a href="#architecture">Architecture</a></li>
          <li><a href="#why-exists">Open source</a></li>
          <li><a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer">JobSpy</a></li>
          <li><a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer">Portfolio</a></li>
        </ul>
        <div className="nav-actions">
          <ThemeToggle compact />
          <a
            href={LINKS.jumpshipRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary nav-github"
          >
            <Star size={13} strokeWidth={2} /> GitHub
          </a>
          <button type="button" className="nav-cta" onClick={onEnter}>Launch App →</button>
        </div>
      </nav>

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
          <button type="button" className="btn-primary" onClick={onEnter}>Start searching ↗</button>
          <a
            href={LINKS.jumpshipRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            <Star size={13} strokeWidth={2} /> Star on GitHub
          </a>
        </div>
      </section>

      {/* How it works — first narrative beat */}
      <motion.section
        className="landing-section landing-section--how"
        id="how"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        variants={fadeUp}
      >
        <div className="landing-section-inner landing-section-inner--how">
          <div className="section-label landing-how-label">How it works</div>
          <h2 className="section-title landing-how-title">
            Three steps to your<br />
            <span style={{ color: 'var(--gold)' }}>next opportunity.</span>
          </h2>
          <p className="section-sub landing-section-sub--how">
            From a single résumé upload to ranked listings and optional autonomous applications — one linear path.
          </p>
          <motion.div
            className="how-grid"
            variants={staggerParent}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
          >
            {HOW_STEPS.map((step) => (
              <motion.div key={step.num} className="how-card" variants={staggerItem}>
                <div className="how-num">{step.num}</div>
                <div className="how-title">{step.title}</div>
                <div className="how-desc">{step.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* Why JumpShip — differentiators */}
      <motion.section
        className="landing-section landing-section--why-jumpship landing-section--alt"
        id="why-jumpship"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        variants={fadeUp}
      >
        <div className="landing-section-inner landing-section-inner--why-jumpship">
          <div className="section-label landing-why-jumpship-label">Why JumpShip</div>
          <h2 className="section-title landing-why-jumpship-title">
            Your résumé is the<br />
            <span style={{ color: 'var(--gold)' }}>algorithm.</span>
          </h2>
          <p className="section-sub landing-why-jumpship-sub">
            No more generic job boards. Let your actual experience drive the search.
          </p>
          <motion.div
            className="why-jumpship-grid"
            variants={staggerParent}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
          >
            {WHY_JUMPSHIP_BOXES.map((box) => (
              <motion.div key={box.title} className="why-jumpship-card" variants={staggerItem}>
                <div className="why-jumpship-card-title">{box.title}</div>
                <div className="why-jumpship-card-desc">{box.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* Capabilities grid */}
      <motion.section
        className="landing-section landing-section--inside-app"
        id="inside-app"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        variants={fadeUp}
      >
        <div className="landing-section-inner landing-section-inner--inside-app">
          <div className="section-label">Inside the app</div>
          <h2 className="section-title">
            Capabilities that ship<br />
            <span style={{ color: 'var(--gold)' }}>with JumpShip.</span>
          </h2>
          <p className="section-sub landing-section-sub--inside-app">
            Parsing, search, scoring, company context, tracking, and optional agents — designed to work together or be swapped out.
          </p>
          <motion.div
            className="features-grid features-grid--centered"
            variants={staggerParent}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
          >
            {FEATURES.map((f) => (
              <motion.div key={f.name} className="feature-card" variants={staggerItem}>
                <div className="feature-icon"><f.Icon size={22} strokeWidth={1.5} /></div>
                <div className="feature-name">{f.name}</div>
                <div className="feature-desc">{f.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* Architecture */}
      <motion.section
        className="landing-section landing-section--arch landing-section--alt"
        id="architecture"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        variants={fadeUp}
      >
        <div className="landing-section-inner landing-section-inner--arch">
          <div className="section-label landing-arch-label">System architecture</div>
          <h2 className="section-title landing-arch-title">
            The full stack,<br />
            <span style={{ color: 'var(--gold)' }}>end to end.</span>
          </h2>
          <p className="section-sub landing-arch-sub">
            Résumé becomes a local profile; JobSpy plus extra adapters aggregate listings; the LLM scores each role against you; optional agents apply in the browser.
          </p>
          <motion.div
            className="arch-diagram arch-diagram--grid"
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
          >
            {/* Row 1 — candidate data (parallel path; joins assessment below) */}
            <div className="arch-node arch-diagram-grid__node" style={{ gridColumn: 1, gridRow: 1 }}>
              <div className="arch-node-icon"><FileText size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Résumé</div>
              <div className="arch-node-sub">PDF / DOCX</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 2, gridRow: 1 }} aria-hidden><ChevronRight size={24} strokeWidth={2} /></div>
            <div className="arch-node arch-node--gold arch-diagram-grid__node" style={{ gridColumn: 3, gridRow: 1 }}>
              <div className="arch-node-icon"><Brain size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">LLM parser</div>
              <div className="arch-node-sub">Ollama · OpenAI · Groq · …</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 4, gridRow: 1 }} aria-hidden><ChevronRight size={24} strokeWidth={2} /></div>
            <div className="arch-node arch-diagram-grid__node" style={{ gridColumn: 5, gridRow: 1 }}>
              <div className="arch-node-icon"><Database size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Profile</div>
              <div className="arch-node-sub">SQLite · local</div>
            </div>
            <div className="arch-diagram-grid__empty" style={{ gridColumn: 6, gridRow: 1 }} aria-hidden />
            <div className="arch-diagram-grid__empty" style={{ gridColumn: 7, gridRow: 1 }} aria-hidden />

            {/* Profile → LLM assessment (not parser → scraper) */}
            <div className="arch-diagram-grid__bridge" style={{ gridColumn: 5, gridRow: 2 }}>
              <div className="arch-connector-down" />
            </div>

            {/* Row 3 — listings → score → optional apply */}
            <div className="arch-node arch-diagram-grid__node" style={{ gridColumn: 1, gridRow: 3 }}>
              <div className="arch-node-icon"><Search size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Job sources</div>
              <div className="arch-node-sub">LinkedIn · Indeed · RemoteOK · +</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 2, gridRow: 3 }} aria-hidden><ChevronRight size={24} strokeWidth={2} /></div>
            <div className="arch-node arch-node--gold arch-diagram-grid__node" style={{ gridColumn: 3, gridRow: 3 }}>
              <div className="arch-node-icon"><Globe size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">JobSpy + adapters</div>
              <div className="arch-node-sub">unified job feed</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 4, gridRow: 3 }} aria-hidden><ChevronRight size={24} strokeWidth={2} /></div>
            <div className="arch-node arch-node--gold arch-diagram-grid__node" style={{ gridColumn: 5, gridRow: 3 }}>
              <div className="arch-node-icon"><BarChart3 size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">LLM assessment</div>
              <div className="arch-node-sub">match · gaps · company intel</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 6, gridRow: 3 }} aria-hidden><ChevronRight size={24} strokeWidth={2} /></div>
            <div className="arch-node arch-node--blue arch-diagram-grid__node" style={{ gridColumn: 7, gridRow: 3 }}>
              <div className="arch-node-icon"><Zap size={24} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Playwright agent</div>
              <div className="arch-node-sub">optional auto-apply</div>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* Open source / why exists */}
      <motion.section
        className="landing-section landing-section--why-exists landing-section--border"
        id="why-exists"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        variants={fadeUp}
      >
        <div className="landing-section-inner landing-section-inner--why-exists">
          <div className="section-label">Why this exists</div>
          <h2 className="section-title landing-why-exists-title">
            Built to be forked,<br />extended, and owned.
          </h2>
          <p className="section-sub landing-why-exists-sub">
            JumpShip is infrastructure for your job search. Fork it, plug in your scraper,
            swap the LLM, or integrate your ATS. All in one clean codebase.
          </p>
          <div className="landing-why-exists-cta">
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
      </motion.section>

      <motion.section
        className="landing-section landing-section--cta landing-section--alt"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        variants={fadeUp}
      >
        <div className="landing-cta-box">
          <div className="section-label" style={{ margin: '0 0 12px' }}>Ready?</div>
          <h2 className="section-title" style={{ fontSize: 'clamp(28px, 4vw, 48px)', margin: '0 0 16px' }}>
            Start your search now.
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 28 }}>
            No account needed. Works locally. Takes 30 seconds.
          </p>
          <button type="button" className="btn-primary" onClick={onEnter} style={{ fontSize: 16, padding: '14px 40px', margin: '0 auto' }}>
            Launch JumpShip ↗
          </button>
        </div>
      </motion.section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          Built by{' '}
          <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer" className="landing-footer-link">
            Adrian Widmer
          </a>
          {' '}· Fork of{' '}
          <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer" className="landing-footer-link">
            JobSpy
          </a>
          {' '}·{' '}
          <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" className="landing-footer-link">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
