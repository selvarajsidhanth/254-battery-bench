/* Firestore backend + Google sign-in. */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection, doc, getDoc, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, writeBatch, type Firestore,
} from 'firebase/firestore';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { COLS, clean, type Backend, type Doc, type Op } from './backend';
import { BOOTSTRAP_ADMIN_UIDS, FIREBASE_CONFIG, GUEST_EMAIL } from '../firebase-config';
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
    // the shared guest login is a full admin (firestore.rules agrees: guestAdmin())
    if (email === GUEST_EMAIL && u.providerData.some((p) => p.providerId === 'password')) return cb({ uid: u.uid, email, name: 'Guest', role: 'admin' });
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

/** Signs in with the shared guest password (checked by Firebase, never stored in the app). */
export async function signInGuest(password: string) {
  init();
  await signInWithEmailAndPassword(getAuth(app!), GUEST_EMAIL, password);
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
      return 'That sign-in method is turned off for this project. In the Firebase console go to Authentication → Sign-in method and enable it (Google, or Email/Password for the guest login).';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/invalid-login-credentials':
      return 'That’s not the guest password. Check it and try again.';
    case 'auth/user-not-found':
      return 'The guest login hasn’t been set up yet. An admin needs to add it in the Firebase console (see the README).';
    case 'auth/user-disabled':
      return 'The guest login is turned off right now. Ask an admin.';
    case 'auth/too-many-requests':
      return 'Too many wrong tries. Wait a few minutes and try again.';
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

/* ---------- match videos (Cloud Storage) ---------- */

/** Uploads a match video for the whole team. Needs Storage turned on (Blaze plan) and storage.rules published. */
export async function uploadVideoFile(blob: Blob, onProgress: (p: number) => void): Promise<{ url: string; path: string }> {
  init();
  const { getStorage, ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
  const path = `videos/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const r = ref(getStorage(app!), path);
  const task = uploadBytesResumable(r, blob, {
    contentType: blob.type || 'video/mp4',
    customMetadata: { by: getAuth(app!).currentUser?.email?.toLowerCase() ?? '' },
  });
  await new Promise<void>((res, rej) => task.on('state_changed', (s) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), rej, () => res()));
  return { url: await getDownloadURL(r), path };
}

export async function deleteVideoFile(path: string) {
  init();
  const { getStorage, ref, deleteObject } = await import('firebase/storage');
  await deleteObject(ref(getStorage(app!), path));
}

/** Plain-language reason an upload failed. */
export function explainUploadError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'storage/unauthorized') return 'Storage said no. Publish storage.rules in the Firebase console (Storage → Rules), and make sure you’re on the member list.';
  if (code === 'storage/unknown' || code === 'storage/project-not-found' || code === 'storage/bucket-not-found') return 'Storage isn’t turned on for this project yet (Firebase console → Storage → Get started, on the Blaze plan).';
  if (code === 'storage/retry-limit-exceeded') return 'The connection dropped. Try again on better Wi-Fi.';
  if (code === 'storage/quota-exceeded') return 'The storage quota is used up.';
  return e instanceof Error ? e.message : String(e);
}
