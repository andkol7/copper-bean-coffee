import { z } from 'zod';
import { email, otpCode } from '../../lib/validation.js';

// POST /api/v1/auth/sessions: one of three ways to log in. A body that fits none of them gets
// one message that lists all three; zod's default "Invalid input" would not say what to send.
export const sessionCreate = z.union(
  [
    z.object({ email, code: otpCode }),
    z.object({ email, password: z.string().min(1).max(200) }),
    z.object({ refreshToken: z.string().min(20).max(200) }),
  ],
  { error: 'Send { email, password }, { email, code } or { refreshToken }' },
);

// DELETE /api/v1/auth/sessions: log out.
export const sessionDelete = z.object({ refreshToken: z.string().min(20).max(200) });
