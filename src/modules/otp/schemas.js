import { z } from 'zod';
import { email } from '../../lib/validation.js';

// POST /api/v1/auth/otp
export const otpRequest = z.object({ email });
