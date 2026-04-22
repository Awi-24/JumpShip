import { motion, type Variants } from 'framer-motion';
import {
  Brain, FileText, Search, BarChart3, Globe, Lock,
  Bookmark, Zap, ChevronRight, Database, Layers,
  Map, Cpu, GitBranch, Mail, Rocket,
} from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';

const LINKS = {
  portfolio: 'https://awi-24.github.io',
  jumpshipRepo: 'https://github.com/Awi-24/JumpShip',
  jobspyRepo: 'https://github.com/Bunsly/JobSpy',
};

interface LandingProps { onEnter: () => void; }

const VIEWPORT = { once: true, amount: 0.15, margin: '0px 0px -6% 0px' };
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
};

const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

const PIPELINE_STEPS = [
  {
    num: '01',
    Icon: FileText,
    title: 'Parse your résumé',
    desc: 'Drop a PDF or DOCX. An LLM extracts your skills, seniority, domains, and generates bilingual search keywords automatically.',
  },
  {
    num: '02',
    Icon: Search,
    title: 'Search 9+ job boards',
    desc: 'LinkedIn, Indeed, Glassdoor, RemoteOK, Gupy, Programathor, Trampos and more, aggregated into one unified, deduplicated feed.',
  },
  {
    num: '03',
    Icon: Brain,
    title: 'AI scores every listing',
    desc: 'Each job gets a calibrated 0-100 match score, gap analysis, salary estimate, company intel, and stack tags, in parallel.',
  },
  {
    num: '04',
    Icon: Zap,
    title: 'Tailored résumé export',
    desc: 'Generate a tailored résumé PDF per job, rewritten by the LLM to highlight what matters for that role, exported as a ready-to-send document.',
  },
];

const FEATURES = [
  {
    Icon: Brain,
    name: 'LLM-Powered Scoring',
    desc: 'Local (Ollama/LM Studio) or cloud (Groq, OpenAI, Anthropic, Gemini). Scores are calibrated, not keyword-stuffed; 90+ means near-perfect fit.',
  },
  {
    Icon: FileText,
    name: 'Résumé-Native Search',
    desc: 'Upload once. Profile is cached locally, bilingual keywords auto-populate filters, and every search session starts pre-configured.',
  },
  {
    Icon: BarChart3,
    name: 'Deep Gap Analysis',
    desc: 'Match score + specific strong points, honest gaps, salary estimate with disclosed/estimated label, and actionable career suggestions.',
  },
  {
    Icon: Globe,
    name: 'Company Intelligence',
    desc: 'Live web enrichment: culture, Glassdoor sentiment, growth stage, and engineering reputation, surfaced alongside the match score.',
  },
  {
    Icon: Bookmark,
    name: 'Kanban Tracker',
    desc: 'Drag cards from Saved → Applied → Interview → Offer. IMAP inbox polling auto-classifies recruiter emails into the right column.',
  },
  {
    Icon: Lock,
    name: 'Privacy by Default',
    desc: 'Your résumé never leaves your machine unless you choose cloud APIs. All inference runs locally via Ollama. Keys are yours, stored locally.',
  },
  {
    Icon: Layers,
    name: 'Parallel Assessment',
    desc: 'Cloud providers run all assessments concurrently. Local providers queue safely with a semaphore, so no GPU contention with résumé generation.',
  },
];

const ROADMAP = [
  {
    Icon: Map,
    title: 'Brazilian Job Aggregator',
    desc: 'A standalone scraper layer, independent of JobSpy, targeting Catho, InfoJobs, Vagas.com, 99jobs, Empregos.com.br, and Trampos directly via headless browsing. No third-party API dependency, no rate limits.',
  },
  {
    Icon: Cpu,
    title: 'Browser-Native Scraper Engine',
    desc: 'Replace JobSpy as the core data layer with a headless browser engine that handles login-walled boards, dynamic pagination, and anti-bot measures natively.',
  },
  {
    Icon: GitBranch,
    title: 'Multi-Profile Support',
    desc: 'Switch between multiple résumé profiles (e.g. backend engineer vs. data engineer) without re-uploading. Each profile gets its own keyword set and saved searches.',
  },
  {
    Icon: Mail,
    title: 'Inbox Intelligence',
    desc: 'Beyond email classification: parse recruiter messages to extract compensation ranges, interview slots, and follow-up deadlines, synced to the tracker.',
  },
  {
    Icon: Rocket,
    title: 'Cover Letter Generator',
    desc: 'LLM-drafted cover letters tailored per job, using your profile, the company context, and your gap analysis, exported as PDF alongside the résumé.',
  },
];

// ── Floating icons (landing only) ────────────────────────────────────────────

const FLOAT_ICONS = [
  { Icon: Brain,    x: '8%',  y: '18%', delay: 0,    size: 20, opacity: 0.1  },
  { Icon: Search,   x: '88%', y: '12%', delay: 1.2,  size: 16, opacity: 0.08 },
  { Icon: FileText, x: '4%',  y: '60%', delay: 2.1,  size: 18, opacity: 0.08 },
  { Icon: Cpu,      x: '92%', y: '55%', delay: 0.7,  size: 22, opacity: 0.09 },
  { Icon: Zap,      x: '50%', y: '8%',  delay: 1.8,  size: 14, opacity: 0.07 },
  { Icon: Globe,    x: '78%', y: '82%', delay: 0.4,  size: 18, opacity: 0.08 },
  { Icon: Database, x: '15%', y: '88%', delay: 1.5,  size: 16, opacity: 0.07 },
  { Icon: BarChart3,x: '65%', y: '92%', delay: 2.6,  size: 14, opacity: 0.06 },
];

export default function Landing({ onEnter }: LandingProps) {
  return (
    <div className="landing">

      {/* Floating decorative icons (landing only) */}
      <div className="floating-icons" aria-hidden>
        {FLOAT_ICONS.map(({ Icon, x, y, delay, size, opacity }, i) => (
          <div key={i} className="floating-icon" style={{ left: x, top: y, animationDelay: `${delay}s`, opacity }}>
            <Icon size={size} strokeWidth={1.5} color="var(--gold)" />
          </div>
        ))}
      </div>

      {/* ── NAV ── */}
      <nav className="nav">
        <div className="nav-logo">
          <img src="/jumpship-logo.png" alt="JumpShip" className="nav-logo-mark" />
        </div>
        <ul className="nav-links">
          <li><a href="#pipeline">Pipeline</a></li>
          <li><a href="#features">Features</a></li>
          <li><a href="#architecture">Architecture</a></li>
          <li><a href="#roadmap">Roadmap</a></li>
          <li><a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer">Author</a></li>
        </ul>
        <div className="nav-actions">
          <ThemeToggle compact />
          <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" className="btn btn-secondary nav-github">
            GitHub
          </a>
          <button type="button" className="btn btn-primary nav-cta-btn" onClick={onEnter}>
            Launch App →
          </button>
        </div>
      </nav>

      {/* ── HERO: full viewport, logo only ── */}
      <section className="hero">
        <motion.div
          className="hero-logo-full"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, ease: EASE_OUT }}
        >
          <img src="/jumpship-logo.png" alt="JumpShip" />
        </motion.div>

        <motion.p
          className="hero-tagline"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18, ease: EASE_OUT }}
        >
          AI-powered job search, built around your résumé.
        </motion.p>

        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.3, ease: EASE_OUT }}
        >
          <button type="button" className="btn btn-primary btn-lg" onClick={onEnter}>
            Start searching ↗
          </button>
          <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer"
            className="btn btn-secondary btn-lg" style={{ textDecoration: 'none' }}>
            View on GitHub
          </a>
        </motion.div>
      </section>

      {/* ── PIPELINE: titles RIGHT ── */}
      <motion.section
        className="landing-section landing-section--how"
        id="pipeline"
        initial="hidden" whileInView="visible" viewport={VIEWPORT} variants={fadeUp}
      >
        <div className="landing-section-inner section-align-right">
          <div className="section-label">How it works</div>
          <h2 className="section-title">
            Four steps.<br />
            <span style={{ color: 'var(--gold)' }}>Zero friction.</span>
          </h2>
          <p className="section-sub">
            From résumé upload to ranked listings and tailored exports: one clean pipeline.
          </p>
          <motion.div className="how-grid" variants={staggerParent} initial="hidden" whileInView="visible" viewport={VIEWPORT}>
            {PIPELINE_STEPS.map((step) => (
              <motion.div key={step.num} className="how-card" variants={staggerItem}>
                <div className="how-card-top">
                  <div className="how-num">{step.num}</div>
                  <div className="how-icon-wrap"><step.Icon size={18} strokeWidth={1.5} /></div>
                </div>
                <div className="how-title">{step.title}</div>
                <div className="how-desc">{step.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* ── FEATURES: titles LEFT ── */}
      <motion.section
        className="landing-section landing-section--alt"
        id="features"
        initial="hidden" whileInView="visible" viewport={VIEWPORT} variants={fadeUp}
      >
        <div className="landing-section-inner section-align-left">
          <div className="section-label">Capabilities</div>
          <h2 className="section-title">
            Everything ships<br />
            <span style={{ color: 'var(--gold)' }}>ready to use.</span>
          </h2>
          <p className="section-sub">
            Parsing, scoring, tracking, and company intel, designed to work together or be extended independently.
          </p>
          <motion.div
            className="features-grid features-grid--centered"
            variants={staggerParent} initial="hidden" whileInView="visible" viewport={VIEWPORT}
          >
            {FEATURES.map((f) => (
              <motion.div key={f.name} className="feature-card" variants={staggerItem}>
                <div className="feature-icon"><f.Icon size={20} strokeWidth={1.5} /></div>
                <div className="feature-name">{f.name}</div>
                <div className="feature-desc">{f.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* ── ARCHITECTURE: centered ── */}
      <motion.section
        className="landing-section landing-section--arch"
        id="architecture"
        initial="hidden" whileInView="visible" viewport={VIEWPORT} variants={fadeUp}
      >
        <div className="landing-section-inner section-align-center">
          <div className="section-label">System architecture</div>
          <h2 className="section-title">
            The full stack,<br />
            <span style={{ color: 'var(--gold)' }}>end to end.</span>
          </h2>
          <p className="section-sub">
            Résumé becomes a local profile. Job boards feed a unified pipeline. The LLM scores each role against you, then helps you export materials tuned to that listing.
          </p>
          <motion.div
            className="arch-diagram arch-diagram--grid"
            variants={fadeUp} initial="hidden" whileInView="visible" viewport={VIEWPORT}
          >
            <div className="arch-node arch-diagram-grid__node" style={{ gridColumn: 1, gridRow: 1 }}>
              <div className="arch-node-icon"><FileText size={22} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Résumé</div>
              <div className="arch-node-sub">PDF / DOCX</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 2, gridRow: 1 }} aria-hidden><ChevronRight size={22} strokeWidth={2} /></div>
            <div className="arch-node arch-node--gold arch-diagram-grid__node" style={{ gridColumn: 3, gridRow: 1 }}>
              <div className="arch-node-icon"><Brain size={22} strokeWidth={1.5} /></div>
              <div className="arch-node-label">LLM parser</div>
              <div className="arch-node-sub">Ollama · Groq · OpenAI</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 4, gridRow: 1 }} aria-hidden><ChevronRight size={22} strokeWidth={2} /></div>
            <div className="arch-node arch-diagram-grid__node" style={{ gridColumn: 5, gridRow: 1 }}>
              <div className="arch-node-icon"><Database size={22} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Profile</div>
              <div className="arch-node-sub">SQLite · local</div>
            </div>
            <div className="arch-diagram-grid__bridge" style={{ gridColumn: 5, gridRow: 2 }}>
              <div className="arch-connector-down" />
            </div>
            <div className="arch-node arch-diagram-grid__node" style={{ gridColumn: 1, gridRow: 3 }}>
              <div className="arch-node-icon"><Search size={22} strokeWidth={1.5} /></div>
              <div className="arch-node-label">9+ Job boards</div>
              <div className="arch-node-sub">LinkedIn · Gupy · Indeed · +</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 2, gridRow: 3 }} aria-hidden><ChevronRight size={22} strokeWidth={2} /></div>
            <div className="arch-node arch-node--gold arch-diagram-grid__node" style={{ gridColumn: 3, gridRow: 3 }}>
              <div className="arch-node-icon"><Globe size={22} strokeWidth={1.5} /></div>
              <div className="arch-node-label">Aggregator</div>
              <div className="arch-node-sub">unified job feed</div>
            </div>
            <div className="arch-arrow arch-diagram-grid__arrow" style={{ gridColumn: 4, gridRow: 3 }} aria-hidden><ChevronRight size={22} strokeWidth={2} /></div>
            <div className="arch-node arch-node--gold arch-diagram-grid__node" style={{ gridColumn: 5, gridRow: 3 }}>
              <div className="arch-node-icon"><BarChart3 size={22} strokeWidth={1.5} /></div>
              <div className="arch-node-label">LLM assessment</div>
              <div className="arch-node-sub">score · gaps · intel</div>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* ── ROADMAP: titles RIGHT ── */}
      <motion.section
        className="landing-section landing-section--alt"
        id="roadmap"
        initial="hidden" whileInView="visible" viewport={VIEWPORT} variants={fadeUp}
      >
        <div className="landing-section-inner section-align-right">
          <div className="section-label">What's coming</div>
          <h2 className="section-title">
            Built to grow<br />
            <span style={{ color: 'var(--gold)' }}>beyond JobSpy.</span>
          </h2>
          <p className="section-sub">
            The goal: a browser-native aggregator targeting Brazilian platforms directly, with no third-party APIs, no rate limits, no restrictions.
          </p>
          <motion.div
            className="roadmap-grid"
            variants={staggerParent} initial="hidden" whileInView="visible" viewport={VIEWPORT}
          >
            {ROADMAP.map((item) => (
              <motion.div key={item.title} className="roadmap-card" variants={staggerItem}>
                <div className="roadmap-card-header">
                  <div className="roadmap-icon"><item.Icon size={18} strokeWidth={1.5} /></div>
                  <span className="roadmap-badge">Planned</span>
                </div>
                <div className="roadmap-title">{item.title}</div>
                <div className="roadmap-desc">{item.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* ── CTA: centered ── */}
      <motion.section
        className="landing-section landing-section--cta"
        initial="hidden" whileInView="visible" viewport={VIEWPORT} variants={fadeUp}
      >
        <div className="landing-cta-box">
          <div className="section-label" style={{ margin: '0 0 16px' }}>Ready?</div>
          <h2 className="section-title" style={{ fontSize: 'clamp(28px, 4vw, 52px)', margin: '0 0 16px' }}>
            Start your search now.
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 36, lineHeight: 1.6 }}>
            No account. No cloud required. Works locally in 30 seconds.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={onEnter}>
              Launch JumpShip ↗
            </button>
            <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer"
              className="btn btn-secondary btn-lg" style={{ textDecoration: 'none' }}>
              View on GitHub
            </a>
          </div>
        </div>
      </motion.section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          Built by{' '}
          <a href={LINKS.portfolio} target="_blank" rel="noopener noreferrer" className="landing-footer-link">Adrian Widmer</a>
          {' '}·{' '}
          <a href={LINKS.jumpshipRepo} target="_blank" rel="noopener noreferrer" className="landing-footer-link">GitHub</a>
          {' '}·{' '}
          <a href={LINKS.jobspyRepo} target="_blank" rel="noopener noreferrer" className="landing-footer-link">JobSpy</a>
        </div>
      </footer>
    </div>
  );
}
