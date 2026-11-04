/* Firestore backend + Google sign-in. */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection, doc, getDoc, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, writeBatch, type Firestore,
} from 'firebase/firestore';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { COLS, clean, type Backend, type Doc, type Op } from './backend';
import { BOOTSTRAP_ADMIN_UIDS, FIREBASE_CONFIG } from '../firebase-config';
import type { Role } from '../lib/types';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export const cloudConfigured = () =>
  !!FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('YOUR_') && !!FIREBASE_CONFIG.projectId;

function init() {
  if (app) return;
  app = initializeApp(FIREBASE_CONFIG);
  // Offline cache: the pit Wi-Fi drops constantly; writes queue and sync when it's back.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
}

export interface SessionUser { uid: string; email: string; name: string; role: Role | null }

export function watchAuth(cb: (u: SessionUser | null) => void): () => void {
  init();
  const auth = getAuth(app!);
  return onAuthStateChanged(auth, async (u: User | null) => {
    if (!u) return cb(null);
    const email = (u.email ?? '').toLowerCase();
    let role: Role | null = BOOTSTRAP_ADMIN_UIDS.includes(u.uid) ? 'admin' : null;
    let name = u.displayName ?? email.split('@')[0];
    try {
      const m = await getDoc(doc(db!, 'members', email));
      if (m.exists()) {
        const d = m.data();
        role = role ?? (d.role === 'admin' ? 'admin' : 'member');
        if (typeof d.name === 'string' && d.name) name = d.name;
      }
    } catch (e) {
      console.warn('Membership lookup failed', e);
    }
    cb({ uid: u.uid, email, name, role });
  });
}

export async function signIn() {
  init();
  const auth = getAuth(app!);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Some browsers (and the pit monitor's kiosk mode) block popups: fall back to a full-page redirect.
    if ((e as { code?: string }).code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
    throw e;
  }
}

/** Plain-English version of a Firebase sign-in error. */
export function explainSignInError(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? '';
  const host = window.location.hostname;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null; // the person closed the window; nothing to explain
    case 'auth/unauthorized-domain':
      return `Firebase doesn't allow sign-in from ${host} yet. In the Firebase console go to Authentication → Settings → Authorized domains and add “${host}”, then try again.`;
    case 'auth/operation-not-allowed':
      return 'Google sign-in is turned off for this project. In the Firebase console go to Authentication → Sign-in method and enable Google.';
    case 'auth/network-request-failed':
      return 'No connection to Google. Check the Wi-Fi and try again.';
    default:
      return `Sign-in failed (${code || (e instanceof Error ? e.message : String(e))}).`;
  }
}
export async function signOutUser() {
  init();
  await signOut(getAuth(app!));
}

export function createCloudBackend(): Backend {
  init();
  const fs = db!;
  return {
    mode: 'cloud',
    subscribe(cb, onError) {
      const unsubs = COLS.map((c) =>
        onSnapshot(
          collection(fs, c),
          (snap) => {
            const docs: Record<string, Doc> = {};
            snap.forEach((d) => { docs[d.id] = d.data(); });
            cb(c, docs);
          },
          (err) => onError?.(err),
        ),
      );
      return () => unsubs.forEach((u) => u());
    },
    async write(ops: Op[]) {
      // Firestore batches cap at 500 writes.
      for (let i = 0; i < ops.length; i += 450) {
        const batch = writeBatch(fs);
        for (const op of ops.slice(i, i + 450)) {
          const ref = doc(fs, op.col, op.id);
          if (op.kind === 'delete') batch.delete(ref);
          else if (op.kind === 'set') batch.set(ref, clean(op.data));
          else batch.update(ref, clean(op.data) as Record<string, never>);
        }
        await batch.commit();
      }
    },
  };
}
