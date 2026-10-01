import { useEffect, useRef } from 'react';

/** Drifting sparks in the temper colours. Static when the viewer prefers reduced motion. */
export function Sparks() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cols = ['#E3C77A', '#C9893A', '#8E4E6B', '#4B4FA6', '#2C6BB0'];
    const P = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), v: 0.0006 + Math.random() * 0.0016, r: 0.6 + Math.random() * 1.8, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * Math.PI * 2 }));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const size = () => { c.width = c.offsetWidth * dpr; c.height = c.offsetHeight * dpr; };
    size();
    const draw = () => {
      if (c.width !== c.offsetWidth * dpr) size();
      ctx.clearRect(0, 0, c.width, c.height);
      const g = ctx.createRadialGradient(c.width * 0.85, c.height * 0.2, 0, c.width * 0.85, c.height * 0.2, c.width * 0.6);
      g.addColorStop(0, 'rgba(201,137,58,.35)'); g.addColorStop(0.5, 'rgba(75,79,166,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
      for (const p of P) {
        if (!still) { p.y -= p.v; p.a += 0.01; p.x += Math.sin(p.a) * 0.0006; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); } }
        ctx.globalAlpha = 0.85; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x * c.width, p.y * c.height, p.r * dpr, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden="true" />;
}
