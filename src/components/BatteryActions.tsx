/* One modal for moving a battery through the rotation, used everywhere. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store';
import { SYSCHECK, chargeStatus } from '../lib/domain';
import { dur, ms } from '../lib/format';
import type { Battery, RotationState } from '../lib/types';
import { Icon, Modal, STATE_META } from './ui';

export function BatteryActions({ battery: b, onClose, dark, tap }: { battery: Battery; onClose: () => void; dark?: boolean; tap?: boolean }) {
  const { act, data, now, toast, health } = useStore();
  const nav = useNavigate();
  const [soc, setSoc] = useState('');
  const [busy, setBusy] = useState(false);
  const s = data.settings;
  const h = health[b.id]?.health;

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  const move = (to: RotationState, match: string | null = null) =>
    run(() => act.move(b, to, match), `${b.label} → ${STATE_META[to].label}${match ? ` for ${match}` : ''}`);
  // one robot: putting this one in takes the current one out to a charger (like the pit's install button)
  const inRobot = data.batteries.find((x) => x.state === 'robot' && x.id !== b.id && !x.retired);
  const [keepBoth, setKeepBoth] = useState(false);
  const install = (match: string | null = null) => run(async () => {
    if (inRobot && !keepBoth) await act.move(inRobot, 'charging');
    await act.move(b, 'robot', match);
  }, `${b.label} → in the robot${match && match !== SYSCHECK ? ` for ${match}` : ''}${inRobot && !keepBoth ? `, ${inRobot.label} → charger` : ''}`);
  const swapNote = inRobot && (
    <label className="swap-note">
      <span>{keepBoth ? <>{inRobot.label} stays in its robot.</> : <><b>{inRobot.label}</b> is in the robot now. Putting {b.label} in moves {inRobot.label} to a charger.</>}</span>
      <span className="swap-keep"><input type="checkbox" checked={keepBoth} onChange={(e) => setKeepBoth(e.target.checked)} /> Second robot, keep both in</span>
    </label>
  );

  const nextMatch = data.event.mode === 'comp'
    ? [...data.event.matches].sort((x, y) => ms(x.time) - ms(y.time)).find((m) => ms(m.time) > now)
    : undefined;

  let body;
  const shelfBtn = <button className="btn block" disabled={busy} onClick={() => move('shelf')}><Icon name="box" />Put on the shelf</button>;
  if (b.state === 'shelf') {
    body = (
      <>
        <p>On the shelf, outside the charge rotation.{h === 'pull' ? ' It isn’t suitable for use.' : h === 'untested' ? ' It still needs bench tests.' : ''}</p>
        <div className="opts">
          <button className="btn primary block" disabled={busy} onClick={() => move('charging')}><Icon name="bolt" />Start charging</button>
          <button className="btn block" disabled={busy} onClick={() => move('ready')}>Mark ready (charged and tested)</button>
        </div>
      </>
    );
  } else if (b.state === 'charging') {
    const c = chargeStatus(b, s, now);
    body = (
      <>
        <p>On the charger. Estimated {Math.round(c.soc)}%, about {dur(c.remainingMin)} to {s.socTarget}%{c.checked ? ' (from a Beak check)' : ''}.</p>
        <div className="lab">
          <span className="k-lab">What does the Beak read right now?</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="in" inputMode="decimal" placeholder={`${s.socTarget}`} value={soc} onChange={(e) => setSoc(e.target.value)} />
            <button className="btn" disabled={busy || !soc} onClick={() => {
              const v = parseFloat(soc);
              if (Number.isNaN(v)) return;
              run(() => act.checkCharge(b, v), v >= s.socTarget ? `${b.label} is full: marked ready` : `${b.label} at ${v}%: estimate updated`);
            }}>Save %</button>
          </div>
        </div>
        <div className="opts">
          <button className="btn primary block" onClick={() => { onClose(); nav(`/log?b=${b.id}`); }}><Icon name="plus" />Test it now</button>
          <button className="btn block" disabled={busy} onClick={() => move('ready')}>Mark ready without a test</button>
          {tap && swapNote}
          {tap && <button className="btn block" disabled={busy} onClick={() => install(nextMatch?.label ?? null)}><Icon name="play" />Straight into the robot{nextMatch ? ` for ${nextMatch.label}` : ''}</button>}
          {shelfBtn}
        </div>
      </>
    );
  } else if (b.state === 'ready') {
    body = (
      <>
        <p>Charged and tested. {h === 'watch' ? 'Practice and prototype only, not for matches.' : h === 'pull' ? 'Not suitable. Do not use it.' : h === 'untested' ? 'Still needs bench tests before it can be rated.' : ''}</p>
        <div className="opts">
          {swapNote}
          {nextMatch && <button className="btn primary block" disabled={busy} onClick={() => install(nextMatch.label)}><Icon name="play" />Install for {nextMatch.label}</button>}
          <button className={`btn block${nextMatch ? '' : ' primary'}`} disabled={busy} onClick={() => install()}><Icon name="play" />Install in robot</button>
          <button className="btn block" disabled={busy} onClick={() => install(SYSCHECK)}>In for a systems check</button>
          <button className="btn block" disabled={busy} onClick={() => move('charging')}>Put back on a charger</button>
          {shelfBtn}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p>In the robot{b.robotFor ? ` for ${b.robotFor === SYSCHECK ? 'a systems check' : b.robotFor}` : ''}. Taking it out counts one cycle.{b.robotFor === SYSCHECK ? ' It barely used any charge, so its charger countdown starts near full.' : ''}</p>
        {h === 'pull' && <p><b>This battery isn’t suitable for use.</b> Shelve it, then retest or decommission it.</p>}
        <div className="opts">
          <button className={`btn block${h === 'pull' ? '' : ' primary'}`} disabled={busy} onClick={() => move('charging')}><Icon name="bolt" />Take out → charger</button>
          {shelfBtn}
        </div>
      </>
    );
  }

  return (
    <Modal title={`${b.label} · ${STATE_META[b.state].label}`} onClose={onClose} dark={dark}
      footer={<button className="btn sm" onClick={() => { onClose(); nav(`/b/${b.id}`); }}>{tap ? 'See the full battery page' : 'Open battery page'}</button>}>
      <div className={tap ? 'tap-sheet' : undefined}>
        {tap && <div className="tap-from"><Icon name="nfc" />Tapped from the tag</div>}
        {body}
      </div>
    </Modal>
  );
}
