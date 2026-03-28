import { useState, useEffect } from 'react';

const QUOTES = [
  {
    quote: "You died.",
    source: "— Dark Souls",
    subtext: "Your résumé, after applying to a 'Junior' role requiring 8 years of experience.",
  },
  {
    quote: "One does not simply walk into a job offer.",
    source: "— Boromir, but make it LinkedIn",
    subtext: "Four rounds of interviews, a take-home project, and a culture fit call with the CEO later…",
  },
  {
    quote: "The cake is a lie.",
    source: "— Portal",
    subtext: "And so is the 'competitive salary', the 'flat hierarchy', and the 'unlimited PTO'.",
  },
  {
    quote: "I used to be an adventurer like you. Then I took a stock option package in the knee.",
    source: "— Skyrim Guard, Series C startup",
    subtext: "The options vested right before the company pivoted. To a bakery.",
  },
  {
    quote: "You are not prepared.",
    source: "— Illidan Stormrage, every job description ever",
    subtext: "Requires: 5+ yrs React, 5+ yrs TypeScript (released 2012), 5+ yrs AI experience. Entry level.",
  },
  {
    quote: "Stay a while and listen.",
    source: "— Deckard Cain (on hold with HR for 45 minutes)",
    subtext: "\"Your application is important to us. Expected wait time: 6-8 business weeks.\"",
  },
  {
    quote: "I am the one who knocks… on LinkedIn InMail.",
    source: "— Walter White, open to work",
    subtext: "I didn't get into tech to be managed. I AM the manager. (Still waiting to hear back.)",
  },
  {
    quote: "Toss a coin to your recruiter,\no Valley of plenty,\no Valley of plenty, oh.",
    source: "— The Witcher, but make it job hunting",
    subtext: "They ghosted you after three rounds anyway.",
  },
  {
    quote: "It's dangerous to go alone. Take this résumé template.",
    source: "— Legend of Zelda, Career Centre",
    subtext: "It's in Comic Sans. It was last updated in 2009. Good luck out there.",
  },
  {
    quote: "War. War never changes.\nNeither does 'we'll be in touch'.",
    source: "— Fallout",
    subtext: "Sixty years of corporate HR and they still can't send a rejection email.",
  },
  {
    quote: "Do you have the high ground?",
    source: "— Obi-Wan Kenobi, Glassdoor review",
    subtext: "Spoiler: The senior dev has been there 11 years and controls everything. You don't.",
  },
  {
    quote: "It's not about the money.\nIt's about sending a message.",
    source: "— The Joker, negotiating salary",
    subtext: "The message: your counter-offer is 'not aligned with the approved band'. The band is secret.",
  },
  {
    quote: "We do not sow.\nWe synergize.",
    source: "— House Reaper, Q3 OKR planning",
    subtext: "This quarter's key result: reduce headcount by 15% and call it a 'strategic restructuring'.",
  },
  {
    quote: "I volunteer as tribute.",
    source: "— Every employee during 'does anyone want to own this project?' in standup",
    subtext: "The project had no budget, no deadline, and no definition of done. Classic.",
  },
  {
    quote: "With great power comes great responsibility.\nWith great responsibility comes no extra pay.",
    source: "— Spider-Man's Uncle Ben, after the reorg",
    subtext: "You've been promoted to 'Senior Individual Contributor'. The title changed. Nothing else did.",
  },
];

interface Props {
  total: number;
  assessed: number;
}

export default function AssessmentLoader({ total, assessed }: Props) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [visible, setVisible] = useState(true);

  // Cycle quote every 5 seconds with a fade
  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % QUOTES.length);
        setVisible(true);
      }, 500);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const q = QUOTES[idx];
  const pct = total > 0 ? Math.round((assessed / total) * 100) : 0;

  return (
    <div className="assessment-loader">
      {/* Progress bar */}
      <div className="al-progress-bar">
        <div className="al-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="al-progress-label">
        <div className="al-spinner" />
        AI analysing {total} jobs… {assessed > 0 ? `(${assessed} done)` : ''}
      </div>

      {/* Quote card */}
      <div className={`al-quote-card${visible ? ' visible' : ''}`}>
        <div className="al-quote-mark">"</div>
        <blockquote className="al-quote-text">{q.quote}</blockquote>
        <div className="al-quote-source">{q.source}</div>
        <div className="al-quote-sub">{q.subtext}</div>
      </div>

      {/* Floating orbs (ambient) */}
      <div className="al-orb al-orb-1" />
      <div className="al-orb al-orb-2" />
      <div className="al-orb al-orb-3" />
    </div>
  );
}
