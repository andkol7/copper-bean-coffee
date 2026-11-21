import bcrypt from 'bcryptjs';

// bcrypt is slow on purpose: each extra round doubles the work, so stolen hashes are expensive
// to brute-force. 12 rounds is about a quarter of a second per hash. Tests use 4 to stay fast.
const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

export const hashPassword = (password) => bcrypt.hash(password, ROUNDS);

// Compared against when the email is unknown, so "no such email" and "wrong password" take
// the same time. Otherwise response time would tell an attacker which emails are registered.
let dummyHash;

export async function verifyPassword(password, hash) {
  if (!hash) {
    dummyHash ??= await bcrypt.hash('not-a-real-password', ROUNDS);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
