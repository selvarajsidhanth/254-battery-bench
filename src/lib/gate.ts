/* Site password. The password itself is never in the code or the repo: only a salted, slow
   PBKDF2-SHA256 hash of it. Typing it derives 64 bytes in the browser:
   - the first 32 must match VERIFIER (that's the password check)
   - the last 32 are a device token kept in localStorage so the device stays unlocked.
     Only SHA-256(token) is published (TOKEN_CHECK), so the token can't be forged from the code
     or by editing storage.
   This keeps the password out of Inspect and the public repo. It is still a front door, not the
   lock: team data is protected by Google sign-in and the Firestore rules. */

export interface GateParams { salt: string; iterations: number; verifier: string; tokenCheck: string }

export const SITE_GATE: GateParams = {
  salt: 'c223352ec023ddead98f18fdf3ca69dc',
  iterations: 310000,
  verifier: 'a70258af520310ca1558a34fe6551070edde03fc3041cc016f578314cfe833e4',
  tokenCheck: '073b3599a766e4564c7cd72d53af63963aef6ae4c30ec950f63e23468efb8c5f',
};

const KEY = 'bb2:gate';
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

/** Same length, every byte compared, so timing doesn't hint at how close a guess was. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function derive(password: string, p: GateParams) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(p.salt), iterations: p.iterations }, key, 512);
  return new Uint8Array(bits);
}

const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', unhex(s)));

/** Checks a typed password. On success returns the device token to keep. */
export async function tryPassword(password: string, p: GateParams = SITE_GATE): Promise<string | null> {
  const dk = await derive(password, p);
  if (!same(hex(dk.slice(0, 32)), p.verifier)) return null;
  return hex(dk.slice(32));
}

/** Is this token the real one? */
export async function validToken(token: string | null, p: GateParams = SITE_GATE): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  return same(await sha256(token), p.tokenCheck);
}

export const savedToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const saveToken = (t: string) => { try { localStorage.setItem(KEY, t); } catch { /* private mode: ask again next time */ } };
export const forgetToken = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };
