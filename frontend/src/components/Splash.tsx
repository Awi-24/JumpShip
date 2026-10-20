import { useEffect, useState } from 'react';

const LINES = ['mounting job boards', 'warming up the model', 'charting the course'];
const STEP_MS = 380; // per boot line
const HOLD_MS = 500; // full bar before fading
const FADE_MS = 260; // matches .splash transition

/** Desktop launch screen: the logo over a few boot lines, then it fades into the start view. Click or any key skips. */
export default function Splash({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (leaving) {
      const t = setTimeout(onDone, FADE_MS);
      return () => clearTimeout(t);
    }
    const more = shown < LINES.length;
    const t = setTimeout(() => (more ? setShown(shown + 1) : setLeaving(true)), more ? STEP_MS : HOLD_MS);
    return () => clearTimeout(t);
  }, [shown, leaving, onDone]);

  useEffect(() => {
    const skip = () => setLeaving(true);
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, []);

  return (
    <div className={`splash${leaving ? ' splash--out' : ''}`} onClick={() => setLeaving(true)} role="presentation">
      <img src="/logo-wordmark.png" alt="JumpShip" />
      <pre className="splash-log" aria-hidden>
        {LINES.slice(0, shown).map(l => `> ${l}… ok\n`).join('')}
        <span className="cursor" />
      </pre>
      <div className="splash-bar" aria-hidden>
        <span style={{ width: `${(shown / LINES.length) * 100}%` }} />
      </div>
    </div>
  );
}
