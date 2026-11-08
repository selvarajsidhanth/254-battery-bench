/* Confetti when we win a match. Fires once per win, when TBA posts the score.
   Wins that were already old when the pit opened don't fire (no confetti storm on reload). */
import { useEffect, useRef, useState } from 'react';
import type { Intel } from '../../lib/intel';

const SEEN = 'bb2:celebrated';
const FRESH_MS = 15 * 60000; // a win counts as new for this long after the match started
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '[]'); } catch { return []; } };
const write = (l: string[]) => { try { localStorage.setItem(SEEN, JSON.stringify(l.slice(-200))); } catch { /* private mode */ } };

interface Win { id: string; label: string; us: 'red' | 'blue'; score: string }

export function WinParty({ intel, event, labels, now, test }: {
  intel: Intel | null; event: string; labels: Record<string, string>; now: number; test?: boolean;
}) {
  const [win, setWin] = useState<Win | null>(null);
  const first = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!intel) return;
    const seen = new Set(read());
    const wins: Win[] = [];
    for (const [key, m] of Object.entries(intel.matches)) {
      if (!m.result || !m.us) continue;
      const them = m.us === 'red' ? 'blue' : 'red';
      if (m.result[m.us] <= m.result[them]) continue;
      wins.push({ id: `${event || intel.source}:${key}`, label: labels[key] ?? key.toUpperCase(), us: m.us, score: `${m.result[m.us]}–${m.result[them]}` });
    }
    // what was already there when the pit opened only fires if TBA says it just happened
    if (!first.current) first.current = new Set(wins.map((w) => w.id));
    const fresh = wins.filter((w) => {
      if (seen.has(w.id)) return false;
      const key = w.id.split(':')[1];
      const at = intel.matches[key]?.estAt;
      return first.current!.has(w.id) ? at != null && now - at < FRESH_MS : true;
    });
    if (wins.some((w) => !seen.has(w.id))) write([...new Set([...seen, ...wins.map((w) => w.id)])]);
    if (fresh.length) setWin(fresh[fresh.length - 1]);
  }, [intel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (test) setWin({ id: 'test', label: 'Q42', us: 'blue', score: '128–97' }); }, [test]);

  if (!win) return null;
  return <Party key={win.id} win={win} onDone={() => setWin(null)} />;
}

function Party({ win, onDone }: { win: Win; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const done = window.setTimeout(onDone, 7500);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (reduce || !c || !ctx) return () => window.clearTimeout(done);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
    const k = Math.max(0.7, H / 900);
    const colors = ['#1b3f8b', '#4f7be0', '#ffffff', '#f2c94c', win.us === 'red' ? '#e5484d' : '#3b82f6'];
    type P = { x: number; y: number; vx: number; vy: number; w: number; h: number; r: number; vr: number; t: number; vt: number; c: string; round: boolean };
    const parts: P[] = [];
    const burst = (x: number, y: number, n: number, angle: number, spread: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const s = (speed * (0.55 + Math.random() * 0.6)) * k;
        parts.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          w: (6 + Math.random() * 7) * k, h: (9 + Math.random() * 9) * k,
          r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
          t: Math.random() * Math.PI, vt: 0.08 + Math.random() * 0.12,
          c: colors[(Math.random() * colors.length) | 0], round: Math.random() < 0.18,
        });
      }
    };
    // two cannons from the bottom corners, then a second wave from the top
    burst(0, H * 0.85, 160, -Math.PI / 3.2, 0.75, 24);
    burst(W, H * 0.85, 160, -Math.PI + Math.PI / 3.2, 0.75, 24);
    const wave = window.setTimeout(() => {
      for (let i = 0; i < 5; i++) burst(W * (0.1 + i * 0.2), -20, 36, Math.PI / 2, 1.4, 6);
    }, 650);

    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const fade = Math.min(1, Math.max(0, (7000 - (t - start)) / 1200));
      for (const p of parts) {
        p.vy += 0.32 * k; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx + Math.sin(p.t) * 0.8; p.y += p.vy; p.r += p.vr; p.t += p.vt;
        if (p.y > H + 40) continue;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.t)); // the flutter
        ctx.fillStyle = p.c;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t - start < 7200) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(wave); window.clearTimeout(done); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`wp ${win.us}`} role="status" onClick={onDone}>
      <canvas ref={ref} aria-hidden="true" />
      <div className="wp-card">
        <span>{win.label} · Final</span>
        <b>We won</b>
        <em>{win.score}</em>
      </div>
    </div>
  );
}
