import { useEffect, useRef, useState } from 'react';

type ThemeMode = 'dark' | 'light';

function readThemeFromDoc(): ThemeMode {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export default function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' ? readThemeFromDoc() : 'dark'
  );

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(readThemeFromDoc()));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    setTheme(readThemeFromDoc());
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;
    let W: number, H: number;

    const isLight = theme === 'light';
    const particleRgb = isLight ? '180, 140, 60' : '245, 166, 35';
    const gridAlpha = isLight ? 0.06 : 0.03;

    const particles = Array.from({ length: isLight ? 45 : 60 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0003,
      vy: (Math.random() - 0.5) * 0.0003,
      r: Math.random() * 1.5 + 0.3,
      a: Math.random() * (isLight ? 0.22 : 0.4) + (isLight ? 0.06 : 0.1),
    }));

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      particles.forEach((p) => {
        p.x = (p.x + p.vx + 1) % 1;
        p.y = (p.y + p.vy + 1) % 1;
        ctx!.beginPath();
        ctx!.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${particleRgb},${p.a})`;
        ctx!.fill();
      });

      ctx!.strokeStyle = `rgba(${particleRgb},${gridAlpha})`;
      ctx!.lineWidth = 1;
      for (let x = 0; x < W; x += 80) {
        ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke();
      }
      for (let y = 0; y < H; y += 80) {
        ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(W, y); ctx!.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="particle-canvas"
      aria-hidden={true}
    />
  );
}
