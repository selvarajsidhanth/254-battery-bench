import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, Link } from 'react-router-dom';
import { StoreProvider, useStore, type Session } from './data/store';
import { createLocalBackend } from './data/local';
import { cloudConfigured, createCloudBackend, explainSignInError, signIn, signOutUser, watchAuth, type SessionUser } from './data/firebase';
import { Icon, Modal } from './components/ui';
import { BRAND } from './brand';
import { Overview } from './pages/sheet/Overview';
import { Batteries } from './pages/sheet/Batteries';
import { BatteryDetail } from './pages/sheet/BatteryDetail';
import { LogTest } from './pages/sheet/LogTest';
import { Testing } from './pages/sheet/Testing';
import { MatchDetail, Matches } from './pages/sheet/Matches';
import { SettingsPage } from './pages/sheet/Settings';
import { Pit } from './pages/pit/Pit';
import { Rehearsal } from './pages/pit/Rehearsal';

const DEMO = new URLSearchParams(window.location.search).has('demo') || !cloudConfigured();

export function App() {
  return DEMO ? <DemoApp /> : <CloudApp />;
}

function DemoApp() {
  const backend = useMemo(() => createLocalBackend(), []);
  // ?demo=member previews exactly what a regular member sees
  const asMember = new URLSearchParams(window.location.search).get('demo') === 'member';
  const session: Session = useMemo(() => ({ name: asMember ? 'Demo member' : 'Demo admin', role: asMember ? 'member' : 'admin' }), [asMember]);
  return <StoreProvider backend={backend} session={session}><AppRoutes /></StoreProvider>;
}

function CloudApp() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => watchAuth(setUser), []);
  const backend = useMemo(() => (user?.role ? createCloudBackend() : null), [user?.role]);
  const session: Session | null = useMemo(
    () => (user?.role ? { name: user.name, email: user.email, role: user.role } : null),
    [user?.name, user?.email, user?.role],
  );

  if (user === undefined) return <Gate><span className="loading">Connecting…</span></Gate>;
  if (user === null) return <SignIn />;
  if (!user.role || !backend || !session) return <NotMember email={user.email} />;
  return <StoreProvider backend={backend} session={session}><AppRoutes /></StoreProvider>;
}

function Gate({ children }: { children: React.ReactNode }) {
  return <div className="gate">{children}</div>;
}

function GateCard({ children }: { children: React.ReactNode }) {
  return (
    <Gate>
      <div className="gate-card">
        <div className="gh"><div className="mark">{BRAND.mark}</div>
          <div><div className="product">{BRAND.name}</div><div className="org">{BRAND.org}</div></div></div>
        <div className="gb">{children}</div>
      </div>
    </Gate>
  );
}

function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <GateCard>
      <p>Sign in with the Google account an admin added to the team list.</p>
      <button className="btn primary block" disabled={busy} onClick={() => {
        setErr(null); setBusy(true);
        signIn().catch((e) => setErr(explainSignInError(e))).finally(() => setBusy(false));
      }}>{busy ? 'Waiting for Google…' : 'Sign in with Google'}</button>
      {err && <div className="gate-err">{err}</div>}
      <p className="fine">Just looking? <a href="?demo#/">Open the demo</a> with sample data that stays in your browser.</p>
    </GateCard>
  );
}

function NotMember({ email }: { email: string }) {
  return (
    <GateCard>
      <p>You're signed in as <b>{email}</b>, but that account isn't on the team list yet.</p>
      <p>Ask an admin to add this email in Settings → Members, then reload.</p>
      <button className="btn block" onClick={() => signOutUser()}>Sign out</button>
    </GateCard>
  );
}

function AppRoutes() {
  return (
    <>
      <Routes>
        <Route path="/pit" element={<Pit />} />
        <Route path="/pit/rehearse" element={<Rehearsal />} />
        <Route element={<SheetLayout />}>
          <Route index element={<Overview />} />
          <Route path="batteries" element={<Batteries />} />
          <Route path="b/:id" element={<BatteryDetail />} />
          <Route path="log" element={<LogTest />} />
          <Route path="testing" element={<Testing />} />
          <Route path="matches" element={<Matches />} />
          <Route path="matches/:id" element={<MatchDetail />} />
          <Route path="imports" element={<Navigate to="/settings?tab=import" replace />} />
          <Route path="settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toast />
    </>
  );
}

/** Import and Settings are admin tools; members are sent back to the overview. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useStore();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function Toast() {
  const { toastMsg } = useStore();
  return toastMsg ? <div className="toast" role="status" key={toastMsg.id}>{toastMsg.msg}</div> : null;
}

function SheetLayout() {
  const { mode, session, error, ready, act, isAdmin } = useStore();
  const [acct, setAcct] = useState(false);
  return (
    <div className="sheet">
      <div className="app">
        <header className="top">
          <Link to="/" className="brand">
            <div className="mark">{BRAND.mark}</div>
            <div><div className="product">{BRAND.name}</div><div className="org">{BRAND.org}</div></div>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/batteries">Batteries</NavLink>
            <NavLink to="/testing">Testing</NavLink>
            <NavLink to="/log">Log test</NavLink>
            <NavLink to="/matches">Match logs</NavLink>
            {isAdmin && <NavLink to="/settings">Settings</NavLink>}
          </nav>
          <div className="top-right">
            <span className={`sync${mode === 'local' ? ' local' : ''}`}><i />{mode === 'cloud' ? 'Synced' : 'Demo'}</span>
            <button className="who" onClick={() => setAcct(true)}>{session.name}</button>
            <Link className="btn" to="/pit"><Icon name="monitor" />Pit mode</Link>
            <Link className="btn primary" to="/log"><Icon name="plus" />Log test</Link>
          </div>
        </header>
        {mode === 'local' && (
          <div className="demo-bar">
            <b>Demo mode</b><span>Sample data, saved only in this browser. Nothing here reaches the team.</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => act.resetDemo()}>Reset sample data</button>
            {cloudConfigured() && <a className="btn sm" href={window.location.pathname + '#/'}>Go to the team app</a>}
          </div>
        )}
        {error && <div className="err-bar">Can't reach the database: {error}. Changes are saved on this device and will sync when the connection is back.</div>}
        {ready ? <Outlet /> : <div className="empty"><span className="loading">Loading fleet…</span></div>}
      </div>
      {acct && (
        <Modal title="Account" onClose={() => setAcct(false)}
          footer={mode === 'cloud' ? <button className="btn" onClick={() => signOutUser()}>Sign out</button> : undefined}>
          <p><b>{session.name}</b>{session.email ? ` · ${session.email}` : ''}</p>
          <p>Role: {session.role === 'admin' ? 'Admin. You can change thresholds, members, and retire batteries.' : 'Member. You can log tests, move batteries through the rotation, and flag batteries for retirement.'}</p>
        </Modal>
      )}
    </div>
  );
}
