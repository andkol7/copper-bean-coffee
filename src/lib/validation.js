import { z } from 'zod';

// ?page=2&limit=10. Query values are strings, so coerce turns them into numbers.
// limit is capped so one request cannot ask for the whole collection.
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Trimmed and lowercased before the format check, the same way the User schema stores it.
export const email = z.string().trim().toLowerCase().pipe(z.email());

export const otpCode = z.string().regex(/^\d{6}$/, 'The code is 6 digits');
