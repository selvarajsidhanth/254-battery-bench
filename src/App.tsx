import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, Link } from 'react-router-dom';
import { StoreProvider, useStore, type Session } from './data/store';
import { createLocalBackend } from './data/local';
import { cloudConfigured, createCloudBackend, signIn, signOutUser, watchAuth, type SessionUser } from './data/firebase';
import { Icon, Modal } from './components/ui';
import { Overview } from './pages/sheet/Overview';
import { Batteries } from './pages/sheet/Batteries';
import { BatteryDetail } from './pages/sheet/BatteryDetail';
import { LogTest } from './pages/sheet/LogTest';
import { Imports } from './pages/sheet/Imports';
import { SettingsPage } from './pages/sheet/Settings';
import { Pit } from './pages/pit/Pit';

const DEMO = new URLSearchParams(window.location.search).has('demo') || !cloudConfigured();

export function App() {
  return DEMO ? <DemoApp /> : <CloudApp />;
}

function DemoApp() {
  const backend = useMemo(() => createLocalBackend(), []);
  const session: Session = useMemo(() => ({ name: 'Demo user', role: 'admin' }), []);
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
        <div className="gh"><div className="mark" style={{ boxShadow: 'inset 0 0 0 1.5px #141412' }}>254</div>
          <div><div className="product" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', fontStretch: '78%' }}>Battery Bench</div>
            <div style={{ fontSize: 10.5, color: '#8a867c', textTransform: 'uppercase', letterSpacing: '.06em' }}>Team 254 · Assembly &amp; Wiring</div></div></div>
        <div className="gb">{children}</div>
      </div>
    </Gate>
  );
}

function SignIn() {
  const [err, setErr] = useState('');
  return (
    <GateCard>
      <p>Sign in with the Google account an admin added to the team list.</p>
      <button className="btn primary block" onClick={() => signIn().catch((e) => setErr(e.code || e.message))}>Sign in with Google</button>
      {err && <p className="fine">Sign-in failed: {err}</p>}
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
        <Route element={<SheetLayout />}>
          <Route index element={<Overview />} />
          <Route path="batteries" element={<Batteries />} />
          <Route path="b/:id" element={<BatteryDetail />} />
          <Route path="log" element={<LogTest />} />
          <Route path="imports" element={<Imports />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toast />
    </>
  );
}

function Toast() {
  const { toastMsg } = useStore();
  return toastMsg ? <div className="toast" role="status" key={toastMsg.id}>{toastMsg.msg}</div> : null;
}

function SheetLayout() {
  const { mode, session, error, ready, act } = useStore();
  const [acct, setAcct] = useState(false);
  return (
    <div className="sheet">
      <div className="app">
        <header className="top">
          <Link to="/" className="brand">
            <div className="mark">254</div>
            <div><div className="product">Battery Bench</div><div className="org">Team 254 · Assembly &amp; Wiring</div></div>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/batteries">Batteries</NavLink>
            <NavLink to="/log">Log test</NavLink>
            <NavLink to="/imports">Import</NavLink>
            <NavLink to="/settings">Settings</NavLink>
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
