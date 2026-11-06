import { useEffect, useState, type ReactNode } from 'react';
import type { Health } from '../lib/domain';
import { appNow, onClockChange } from '../lib/clock';
import type { RotationState } from '../lib/types';

/* ---------------- icons (hand-drawn set, 24px grid, stroke) ---------------- */
const PATHS = {
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  therm: <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  tick: <path d="m5 12.5 4.5 4.5L19 7" />,
  play: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></>,
  trend: <><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  monitor: <><rect x="2" y="4" width="20" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" /></>,
  flag: <><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h3v4h-3" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  box: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="m3 7.5 9 4.5 9-4.5M12 12v9" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
};
export type IconName = keyof typeof PATHS;
export function Icon({ name, className = 'ico' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

export const STATE_META: Record<RotationState, { label: string; icon: IconName }> = {
  shelf: { label: 'Shelf', icon: 'box' },
  charging: { label: 'Charging', icon: 'bolt' },
  ready: { label: 'Ready', icon: 'check' },
  robot: { label: 'In robot', icon: 'play' },
};

export const HEALTH_LABEL: Record<Health, string> = {
  ok: 'Competition', watch: 'Practice', pull: 'Not suitable', untested: 'Needs tests', retired: 'Retired',
};

export function Mk({ level, lg }: { level: Health | 'na'; lg?: boolean }) {
  return <i className={`mk ${level}${lg ? ' lg' : ''}`} aria-hidden />;
}

export function StatusTag({ health }: { health: Health }) {
  if (health === 'pull') return <span className="status pull">Not suitable</span>;
  return <span className={`status ${health}`}><Mk level={health} />{HEALTH_LABEL[health]}</span>;
}

export function StateLabel({ state, extra }: { state: RotationState; extra?: ReactNode }) {
  const m = STATE_META[state];
  return <span className="state"><Icon name={m.icon} />{m.label}{extra}</span>;
}

/* ---------------- modal ---------------- */
export function Modal({ title, onClose, children, footer, dark }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; dark?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${dark ? ' dark' : ''}`} role="dialog" aria-modal aria-label={title}>
        <div className="mh"><h3>{title}</h3><button className="x-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- time ---------------- */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(appNow());
  useEffect(() => {
    const t = setInterval(() => setNow(appNow()), intervalMs);
    const off = onClockChange(() => setNow(appNow()));
    return () => { clearInterval(t); off(); };
  }, [intervalMs]);
  return now;
}

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
