// Make a new site password: node scripts/gate-hash.mjs
// It asks for the password (not echoed into your shell history) and prints SITE_GATE for src/lib/gate.ts.
// Changing it locks every device until people type the new password.
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('New site password: ', (pw) => {
  rl.close();
  if (!pw) { console.error('No password given.'); process.exit(1); }
  const salt = randomBytes(16), iterations = 310000;
  const dk = pbkdf2Sync(pw, salt, iterations, 64, 'sha256');
  console.log(`\nexport const SITE_GATE: GateParams = {
  salt: '${salt.toString('hex')}',
  iterations: ${iterations},
  verifier: '${dk.subarray(0, 32).toString('hex')}',
  tokenCheck: '${createHash('sha256').update(dk.subarray(32)).digest('hex')}',
};`);
});
