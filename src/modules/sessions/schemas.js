import { z } from 'zod';
import { email, otpCode } from '../../lib/validation.js';

// POST /api/v1/auth/sessions: one of three ways to log in.
export const sessionCreate = z.union([
  z.object({ email, code: otpCode }),
  z.object({ email, password: z.string().min(1).max(200) }),
  z.object({ refreshToken: z.string().min(20).max(200) }),
]);
