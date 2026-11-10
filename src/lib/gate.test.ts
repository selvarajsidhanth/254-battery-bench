import { describe, expect, it } from 'vitest';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { tryPassword, validToken, type GateParams } from './gate';

// a throwaway password, so the real one never appears in the repo
const salt = randomBytes(16);
const dk = pbkdf2Sync('correct horse', salt, 1000, 64, 'sha256');
const P: GateParams = {
  salt: salt.toString('hex'), iterations: 1000,
  verifier: dk.subarray(0, 32).toString('hex'),
  tokenCheck: createHash('sha256').update(dk.subarray(32)).digest('hex'),
};

describe('site password', () => {
  it('opens with the right password and gives a token that checks out', async () => {
    const t = await tryPassword('correct horse', P);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(await validToken(t, P)).toBe(true);
  });
  it('rejects a wrong password and forged tokens', async () => {
    expect(await tryPassword('wrong horse', P)).toBeNull();
    expect(await validToken(P.verifier, P)).toBe(false);
    expect(await validToken(P.tokenCheck, P)).toBe(false);
    expect(await validToken('x', P)).toBe(false);
    expect(await validToken(null, P)).toBe(false);
  });
});
