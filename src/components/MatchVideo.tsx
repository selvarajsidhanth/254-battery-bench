/* Match video, synced to the log. The video comes from The Blue Alliance (found
   automatically when the log says which match it was), a pasted YouTube link,
   or a file on this computer. Once synced, the graph and live numbers follow
   the video, and clicking the graph jumps the video there. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui';
import { TraceChart, running, sampleAt } from './MatchReportView';
import type { MatchReport } from '../lib/matchReport';
import type { MatchVideo } from '../lib/types';
import { fmt, mmss } from '../lib/format';
import { guessEventKey, parseYoutube, pickMatch, saveTbaCreds, tbaCreds, tbaLabel, teamMatches, type TbaMatch } from '../lib/tba';

/** Picked video files can't be saved to the database, so they're kept for this visit only. */
const fileUrls = new Map<string, { url: string; name: string }>();
const reportKey = (r: MatchReport) => `${r.fileName}|${r.logStart ?? ''}`;

export function MatchVideoPanel({ r, video, onChange }: {
  r: MatchReport;
  video: MatchVideo | null | undefined;
  onChange: (v: MatchVideo | null) => unknown;
}) {
  const [file, setFile] = useState(() => fileUrls.get(reportKey(r)) ?? null);
  const useFile = (f: File, keepOffset?: number | null) => {
    const old = fileUrls.get(reportKey(r));
    if (old) URL.revokeObjectURL(old.url);
    const v = { url: URL.createObjectURL(f), name: f.name };
    fileUrls.set(reportKey(r), v);
    setFile(v);
    onChange({ kind: 'file', id: f.name, offset: keepOffset ?? null, from: 'file' });
  };

  if (r.trace.t.length < 2) return null;
  if (!video) return <FindVideo r={r} onPick={onChange} onFile={(f) => useFile(f)} />;

  if (video.kind === 'file' && !file) {
    return (
      <section className="panel mv">
        <div className="ph"><h2>Match video</h2><span className="note">{video.id}</span></div>
        <div className="pb row-acts" style={{ alignItems: 'center' }}>
          <span style={{ flex: '1 1 260px' }}>This match was paired with <b>{video.id}</b>. Video files stay on the computer they were picked on, so choose it again to watch.{video.offset != null ? ' The sync is saved.' : ''}</span>
          <label className="btn primary"><input type="file" accept="video/*" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) useFile(f, video.offset); e.target.value = ''; }} /><Icon name="upload" />Choose the video</label>
          <button className="btn" onClick={() => onChange(null)}>Use a different video</button>
        </div>
      </section>
    );
  }
  return <Playback r={r} video={video} src={video.kind === 'file' ? file!.url : null} onChange={onChange} />;
}

/* ---------------- finding a video ---------------- */

function FindVideo({ r, onPick, onFile }: { r: MatchReport; onPick: (v: MatchVideo) => void; onFile: (f: File) => void }) {
  const saved = tbaCreds();
  const [team, setTeam] = useState(saved.team);
  const [key, setKey] = useState(saved.key);
  const [event, setEvent] = useState(() => guessEventKey(r));
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [list, setList] = useState<TbaMatch[] | null>(null);
  const tried = useRef(false);
  const withVideo = (list ?? []).filter((m) => m.videos?.some((v) => v.type === 'youtube'));
  const attach = (m: TbaMatch) => {
    const yt = m.videos!.find((v) => v.type === 'youtube')!;
    const p = parseYoutube(yt.key) ?? { id: yt.key, start: 0 };
    onPick({ kind: 'youtube', id: p.id, start: p.start || undefined, offset: null, from: 'tba', tbaMatch: m.key });
  };

  const find = async () => {
    setBusy(true); setMsg('');
    try {
      saveTbaCreds(key, team);
      const l = await teamMatches(event, team);
      setList(l);
      const m = pickMatch(l, r);
      if (m?.videos?.some((v) => v.type === 'youtube')) { attach(m); return; }
      const n = l.filter((x) => x.videos?.some((v) => v.type === 'youtube')).length;
      setMsg(m ? `TBA has ${tbaLabel(m)} but no video for it yet. Videos usually go up within a few hours of the match.`
        : r.match.type === 'qual' || r.match.type === 'elim' ? `Couldn’t find ${r.match.label} for team ${team} at ${event}.${n ? ' Pick the match below.' : ''}`
        : `This log isn’t from an FMS match, so pick the match yourself${n ? ' below' : ''}.`);
    } catch (e) {
      setMsg(`Couldn’t search TBA: ${e instanceof Error ? e.message : e}`);
    }
    setBusy(false);
  };

  // FMS matches: look it up as soon as the report opens
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    if (saved.key && saved.team && event && (r.match.type === 'qual' || r.match.type === 'elim')) find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="panel mv">
      <div className="ph"><h2>Match video</h2><span className="note">Pair a video to watch the match with the graph playing along</span></div>
      <div className="mv-find">
        <div className="mv-opt">
          <div className="k-lab">From The Blue Alliance</div>
          <div className="mv-row">
            <input className="in" style={{ width: 92 }} inputMode="numeric" placeholder="Team #" value={team} onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))} />
            <input className="in" placeholder="Event key, e.g. 2027casj" value={event} onChange={(e) => setEvent(e.target.value)} />
          </div>
          {!saved.key && <input className="in" type="password" placeholder="TBA read API key" value={key} onChange={(e) => setKey(e.target.value)} />}
          <button className="btn primary" disabled={busy || !team || !event || !key} onClick={find}>{busy ? 'Searching…' : `Find ${r.match.type === 'qual' || r.match.type === 'elim' ? r.match.label : 'our matches'}`}</button>
          {withVideo.length > 0 && (
            <select className="in" value="" onChange={(e) => { const m = withVideo.find((x) => x.key === e.target.value); if (m) attach(m); }}>
              <option value="">Pick a match ({withVideo.length} with video)…</option>
              {withVideo.map((m) => <option key={m.key} value={m.key}>{tbaLabel(m)}</option>)}
            </select>
          )}
          {msg && <p className="mv-msg">{msg}</p>}
          {!saved.key && <span className="mute" style={{ fontSize: 11.5 }}>Read key from thebluealliance.com/account. It stays on this device.</span>}
        </div>
        <div className="mv-opt">
          <div className="k-lab">YouTube link</div>
          <input className="in" placeholder="https://youtu.be/…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn" disabled={!parseYoutube(link)} onClick={() => { const p = parseYoutube(link)!; onPick({ kind: 'youtube', id: p.id, start: p.start || undefined, offset: null, from: 'link' }); }}>Use this link</button>
          <span className="mute" style={{ fontSize: 11.5 }}>A stream VOD or a video someone filmed from the stands.</span>
        </div>
        <div className="mv-opt">
          <div className="k-lab">Video file</div>
          <label className="drop" style={{ padding: 14 }}>
            <input type="file" accept="video/*" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
            <Icon name="upload" className="ico" /> <b>Choose a video</b>
          </label>
          <span className="mute" style={{ fontSize: 11.5 }}>Played from this computer, never uploaded. The sync is saved with the report.</span>
        </div>
      </div>
    </section>
  );
}

/* ---------------- players ---------------- */

interface Ctl { time(): number; seek(s: number): void; playing(): boolean; play(): void; pause(): void }

interface YTPlayer {
  getCurrentTime(): number; seekTo(s: number, allow: boolean): void; getPlayerState(): number;
  playVideo(): void; pauseVideo(): void; destroy(): void;
}
let ytApi: Promise<{ Player: new (el: HTMLElement, o: object) => YTPlayer }> | null = null;
function loadYouTube() {
  if (!ytApi) {
    ytApi = new Promise((res) => {
      const w = window as unknown as { YT?: { Player: never }; onYouTubeIframeAPIReady?: () => void };
      if (w.YT?.Player) return res(w.YT as never);
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); res(w.YT as never); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

function YouTube({ id, start, onCtl }: { id: string; start?: number; onCtl: (c: Ctl | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let p: YTPlayer | null = null;
    let dead = false;
    const host = document.createElement('div'); // YouTube replaces this node, so keep React away from it
    box.current?.appendChild(host);
    loadYouTube().then((YT) => {
      if (dead) return;
      p = new YT.Player(host, {
        videoId: id, width: '100%', height: '100%',
        playerVars: { start: start ?? 0, rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => !dead && onCtl({
            time: () => p!.getCurrentTime() ?? 0,
            seek: (s) => p!.seekTo(Math.max(0, s), true),
            playing: () => p!.getPlayerState() === 1,
            play: () => p!.playVideo(),
            pause: () => p!.pauseVideo(),
          }),
        },
      });
    });
    return () => { dead = true; onCtl(null); try { p?.destroy(); } catch { /* already gone */ } host.remove(); };
  }, [id, start, onCtl]);
  return <div ref={box} className="mv-yt" />;
}

function FileVideo({ src, onCtl }: { src: string; onCtl: (c: Ctl | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    onCtl({
      time: () => v.currentTime,
      seek: (s) => { v.currentTime = Math.max(0, s); },
      playing: () => !v.paused && !v.ended,
      play: () => { v.play().catch(() => {}); },
      pause: () => v.pause(),
    });
    return () => onCtl(null);
  }, [src, onCtl]);
  return <video ref={ref} src={src} controls playsInline preload="metadata" />;
}

/* ---------------- playback ---------------- */

const vclock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function Playback({ r, video, src, onChange }: { r: MatchReport; video: MatchVideo; src: string | null; onChange: (v: MatchVideo | null) => unknown }) {
  const [ctl, setCtl] = useState<Ctl | null>(null);
  const [vt, setVt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const offset = video.offset;
  const { t, v, i } = r.trace;
  const ah = useMemo(() => running(r, 'ah'), [r]);
  const auto = r.phases.find((p) => p.mode === 'auto');
  const tele = r.phases.find((p) => p.mode === 'teleop');
  const minT = r.battery.marks?.minT ?? null;
  const browns = r.events.filter((e) => e.kind === 'brownout');

  // follow the video ~20 times a second
  useEffect(() => {
    if (!ctl) return;
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        const x = ctl.time();
        setVt((p) => (Math.abs(p - x) > 0.02 ? x : p));
        setPlaying(ctl.playing());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctl]);

  const logT = offset != null ? vt - offset : null;
  const inLog = logT != null && logT >= t[0] && logT <= t[t.length - 1];
  const k = inLog ? sampleAt(t, logT!) : -1;
  const phase = logT != null ? r.phases.find((p) => logT >= p.start && logT < p.end) : undefined;
  // time within the current period, like the field timer counting up
  const elapsed = logT == null ? '—' : phase ? mmss(logT - phase.start) : `${logT < 0 ? '−' : '+'}${mmss(Math.abs(logT))}`;
  const setOffset = (o: number | null) => onChange({ ...video, offset: o == null ? null : Math.round(o * 10) / 10 });
  const seekLog = (x: number) => { if (ctl && offset != null) ctl.seek(offset + x); };
  const status = logT == null ? 'Not synced'
    : !inLog ? (logT < t[0] ? 'Before the log' : 'After the log')
    : phase ? (phase.mode === 'auto' ? 'Auto' : phase.mode === 'teleop' ? 'Teleop' : 'Test')
    : logT < 0 ? 'Pre-match' : 'Disabled';

  return (
    <section className="panel mv">
      <div className="ph"><h2>Match playback</h2>
        <span className="note">{video.from === 'tba' ? `The Blue Alliance${video.tbaMatch ? ` · ${video.tbaMatch.split('_')[1]?.toUpperCase()}` : ''}` : video.kind === 'file' ? video.id : 'YouTube'}</span></div>
      <div className="mv-stage">
        <div className="mv-screen">
          {video.kind === 'youtube' ? <YouTube id={video.id} start={video.start} onCtl={setCtl} /> : <FileVideo src={src!} onCtl={setCtl} />}
          {inLog && (
            <div className="mv-hud" aria-hidden>
              <span>{status} {elapsed}</span>
              <b>{v[k].toFixed(1)}<small>V</small></b>
              <b>{fmt(i[k], 0)}<small>A</small></b>
            </div>
          )}
        </div>
        <div className="mv-live">
          <div className="mv-cell"><div className="k-lab">Match time</div><div className="v">{elapsed}</div><div className="s">{status}</div></div>
          <div className={`mv-cell${inLog && v[k] < 8 ? ' bad' : ''}`}><div className="k-lab">Battery</div><div className="v">{inLog ? v[k].toFixed(2) : '—'}<small>V</small></div><Meter x={inLog ? (v[k] - 6) / 7 : 0} /></div>
          <div className="mv-cell"><div className="k-lab">Current</div><div className="v">{inLog ? fmt(i[k], 0) : '—'}<small>A</small></div><Meter x={inLog ? i[k] / Math.max(1, r.battery.peakA ?? 1) : 0} /></div>
          <div className="mv-cell"><div className="k-lab">Used so far</div><div className="v">{inLog ? ah[k].toFixed(2) : '—'}<small>Ah</small></div><Meter x={inLog ? ah[k] / Math.max(0.01, ah[ah.length - 1]) : 0} /></div>
        </div>
      </div>

      <div className={`mv-sync${offset == null ? ' need' : ''}`}>
        {offset == null ? (
          <>
            <span><b>Sync the video once.</b> Play it to the moment auto starts (the field timer starts counting and the robots move), then press the button. Everything lines up from there.</span>
            <button className="btn primary" disabled={!ctl} onClick={() => setOffset(ctl!.time())}><Icon name="play" />Auto starts now</button>
          </>
        ) : (
          <>
            <span>Auto starts at <b>{vclock(offset)}</b> in the video. If the graph runs ahead of or behind the robots, nudge it:</span>
            <div className="mv-nudge">
              {[-1, -0.1, 0.1, 1].map((d) => <button key={d} className="btn sm" title={d < 0 ? 'Graph is behind the video' : 'Graph is ahead of the video'} onClick={() => setOffset(Math.max(0, offset + d))}>{d > 0 ? '+' : '−'}{Math.abs(d)} s</button>)}
              <button className="btn sm" disabled={!ctl} onClick={() => setOffset(ctl!.time())}>Re-sync here</button>
            </div>
          </>
        )}
      </div>

      {offset != null && (
        <div className="mv-jump">
          <span className="k-lab">Jump to</span>
          <button className="btn sm" onClick={() => { seekLog(-2); ctl?.play(); }}><Icon name="play" />Auto</button>
          {tele && <button className="btn sm" onClick={() => seekLog(tele.start - 1)}>Teleop</button>}
          {minT != null && <button className="btn sm" onClick={() => seekLog(minT - 3)}>Lowest voltage</button>}
          {browns.map((e, n) => <button key={n} className="btn sm" onClick={() => seekLog(e.t - 3)}>Brownout {n + 1}</button>)}
          <span style={{ flex: 1 }} />
          {ctl && <button className="btn sm" onClick={() => (playing ? ctl.pause() : ctl.play())}>{playing ? 'Pause' : 'Play'}</button>}
        </div>
      )}

      <TraceChart r={r} playhead={inLog ? logT : null} onSeek={offset != null ? (x) => seekLog(x) : undefined} />
      <p className="mr-cap" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span>{offset != null ? 'Click anywhere on the graph to jump the video there. The faded part hasn’t happened yet.' : 'Once synced, the graph follows the video.'}{auto ? '' : ' This log has no auto period, so sync to when the robot first enabled.'}</span>
        <button className="btn sm" onClick={() => { if (confirm('Remove this video from the report?')) onChange(null); }}>Remove video</button>
      </p>
    </section>
  );
}

function Meter({ x }: { x: number }) {
  return <div className="mv-meter"><i style={{ width: `${Math.max(0, Math.min(1, x)) * 100}%` }} /></div>;
}
