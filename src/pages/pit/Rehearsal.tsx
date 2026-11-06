/* Pit rehearsal: the real pit screen running on a fake event with sample
   batteries and a clock you can speed up, pause, or skip ahead. Nothing here
   touches the team's data; it lives in memory and is gone when you leave. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StoreProvider, useStore, type Session } from '../../data/store';
import { createMemoryBackend } from '../../data/local';
import { generateSeed } from '../../data/seed';
import { RehearsalCtx } from '../../components/rehearsal';
import { useNow } from '../../components/ui';
import { jumpSim, setSimPaused, setSimSpeed, simState, startSim, stopSim } from '../../lib/clock';
import { chargeStatus } from '../../lib/domain';
import { planMatches } from '../../lib/plan';
import { MIN, clock, mmss, ms } from '../../lib/format';
import { Pit } from './Pit';

const SPEEDS = [1, 10, 30, 60];
const SESSION: Session = { name: 'Rehearsal', role: 'admin' };

/** A day of quals: realistic gaps (about 50 min) with a couple of tight turnarounds. */
function fakeEvent(t0: number) {
  const gaps = [48, 52, 22, 55, 46, 19, 50, 45];
  let at = t0 + 22 * MIN;
  let n = 6;
  const matches = [{ key: `qm${n}`, label: `Q${n}`, time: new Date(at).toISOString() }];
  for (const g of gaps) {
    at += g * MIN;
    n += Math.max(2, Math.round(g / 7));
    matches.push({ key: `qm${n}`, label: `Q${n}`, time: new Date(at).toISOString() });
  }
  return { mode: 'comp', name: 'Rehearsal Regional', matches, assignments: {} };
}

export function Rehearsal() {
  const [run, setRun] = useState(0); // bump to restart
  const [t0] = useState(() => Math.floor(Date.now() / MIN) * MIN);
  const backend = useMemo(() => {
    const seed = generateSeed(t0);
    // start with an empty robot so the first thing you do is the install
    for (const b of Object.values(seed.batteries ?? {})) if (b.state === 'robot') Object.assign(b, { state: 'ready', stateSince: new Date(t0 - 30 * MIN).toISOString() });
    return createMemoryBackend({ ...seed, config: { event: fakeEvent(t0) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0, run]);
  useEffect(() => {
    startSim(t0, 10);
    return () => stopSim();
  }, [t0, run]);

  return (
    <RehearsalCtx.Provider value>
      <StoreProvider key={run} backend={backend} session={SESSION}>
        <Pit bar={<Bar onRestart={() => setRun((x) => x + 1)} />} />
        <Toast />
      </StoreProvider>
    </RehearsalCtx.Provider>
  );
}

function Toast() {
  const { toastMsg } = useStore();
  return toastMsg ? <div className="toast" role="status" key={toastMsg.id}>{toastMsg.msg}</div> : null;
}

/* ---------------- control bar + coach ---------------- */

function Bar({ onRestart }: { onRestart: () => void }) {
  const now = useNow(250);
  const st = simState();
  const tip = useCoach(now);
  const { active, health, act, toast, data } = useStore();

  const curveball = () => {
    // a ready battery reads high on the Beak: watch the PULL signal and the plan re-route
    const b = active.filter((x) => x.state === 'ready' && health[x.id].health === 'ok').sort((a, c) => (health[a.id].rank ?? 99) - (health[c.id].rank ?? 99))[0];
    if (!b) return toast('No match-ready battery to throw a curveball at yet');
    act.logTest({ batteryId: b.id, kind: 'beak', soc: data.settings.socTarget, ir: data.settings.irMax + 6, v0: 12.6, by: 'Rehearsal', notes: 'Curveball' }, 'keep')
      .then(() => toast(`${b.label} just read ${data.settings.irMax + 6} mΩ on the Beak`));
  };

  return (
    <div className="p-rh">
      <div className="p-rh-ctl">
        <span className="p-rh-tag">Rehearsal</span>
        <div className="p-rh-seg">
          <button className={st?.paused ? 'on' : ''} onClick={() => setSimPaused(!st?.paused)}>{st?.paused ? 'Paused' : 'Pause'}</button>
          {SPEEDS.map((x) => <button key={x} className={!st?.paused && st?.speed === x ? 'on' : ''} onClick={() => setSimSpeed(x)}>{x}×</button>)}
        </div>
        {tip.skip && <button className="p-rh-btn" onClick={() => jumpSim(tip.skip!.ms)}>{tip.skip.label}</button>}
        <button className="p-rh-btn" onClick={curveball} title="Make a ready battery fail its Beak check">Curveball</button>
        <button className="p-rh-btn" onClick={onRestart}>Restart</button>
        <Link className="p-rh-btn" to="/pit">Exit</Link>
      </div>
      <div className="p-rh-tip" key={tip.head}>
        <b>{tip.head}</b><span>{tip.text}</span>
      </div>
    </div>
  );
}

interface Tip { head: string; text: string; skip?: { label: string; ms: number } }

/** Reads the fake pit and says what a pit crew would do next. */
function useCoach(now: number): Tip {
  const { data, health, active, battery } = useStore();
  const s = data.settings;
  const ev = data.event;
  const rows = useMemo(() => planMatches(data.batteries, health, s, ev, now), [data.batteries, health, s, ev, now]);
  const matches = [...ev.matches].sort((a, b) => ms(a.time) - ms(b.time));
  const robot = active.find((b) => b.state === 'robot');
  const field = rows.find((r) => r.status === 'field');
  const next = rows.find((r) => r.status !== 'field');
  const skipTo = (t: number, label: string) => (t - now > 30_000 ? { label, ms: t - now } : undefined);

  if (field) {
    const end = ms(field.match.time) + s.matchMin * MIN;
    return { head: `${field.match.label} is on the field`, text: `The robot is out there with ${robot?.label ?? 'its battery'}. Back in ${mmss((end - now) / 1000)}. Nothing to do in the pit but get the next battery ready.`, skip: skipTo(end + 15_000, 'Skip to match end') };
  }
  // a match finished and the battery that played it is still in the robot
  const played = matches.filter((m) => ms(m.time) + s.matchMin * MIN <= now).pop();
  if (robot && played && ms(robot.stateSince) < ms(played.time)) {
    return { head: `${played.label} is over`, text: `Take ${robot.label} out of the robot: tap the “In robot” box up top, then “Take out → charger”. It starts its ${s.chargeMin}-min charge right away.` };
  }
  const full = active.filter((b) => b.state === 'charging' && chargeStatus(b, s, now).remainingMin <= 0);
  if (!next) {
    return { head: 'That’s the whole schedule', text: 'Every match got a battery. Press Restart to run it again, or Exit to go back to the real pit screen.' };
  }
  const nb = next.batteryId ? battery(next.batteryId) : undefined;
  const queueIn = next.needBy - now;
  if (nb && next.status === 'installed') {
    return { head: `Ready for ${next.match.label}`, text: `${nb.label} is installed. The robot goes to queue at ${clock(next.needBy)} (${mmss(Math.max(0, queueIn) / 1000)} from now).`, skip: skipTo(ms(next.match.time), `Skip to ${next.match.label}`) };
  }
  if (full.length) {
    const b = full[0];
    return { head: `${b.label} is full`, text: `Tap it in the Charging list and press “Beak test it”. A good reading marks it ready; a bad one keeps it out of matches.` };
  }
  if (nb && nb.state === 'ready') {
    const soon = queueIn < 20 * MIN;
    return {
      head: soon ? `Install ${nb.label} for ${next.match.label}` : `Next up: ${next.match.label} at ${clock(next.match.time)}`,
      text: soon
        ? `Tick each item on the checklist, then press “Installed”. The battery coming out goes straight to a charger. Queue by ${clock(next.needBy)}.`
        : `The plan picked ${nb.label} (best capacity that's ready). Crews usually install about 15 min before queue at ${clock(next.needBy)}, so there's time to test what's on the chargers.`,
      skip: soon ? undefined : skipTo(next.needBy - 15 * MIN, 'Skip to install time'),
    };
  }
  if (nb && nb.state === 'charging') {
    const left = chargeStatus(nb, s, now).remainingMin;
    return { head: `${nb.label} is charging for ${next.match.label}`, text: `Full in about ${Math.ceil(left)} min, then test it off the charger.${next.status === 'tight' ? ` It's ${Math.ceil(next.lateMin)} min late for queue, so the plan row is amber: lock a different battery in the plan if one is ready.` : ''}`, skip: skipTo(now + left * MIN + 5_000, 'Skip until it’s full') };
  }
  return { head: `No battery for ${next.match.label}`, text: 'Nothing usable will be charged in time. Pick one in the match plan, or press Restart.' };
}
