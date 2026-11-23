import { z } from 'zod';

// ?page=2&limit=10. Query values are strings, so coerce turns them into numbers.
// limit is capped so one request cannot ask for the whole collection.
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// A MongoDB id as text: 24 hex characters.
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// Trimmed and lowercased before the format check, the same way the User schema stores it.
export const email = z.string().trim().toLowerCase().pipe(z.email());

export const otpCode = z.string().regex(/^\d{6}$/, 'The code is 6 digits');

// bcrypt only looks at the first 72 bytes of a password: two longer passwords with the same
// start would both work. So new passwords are capped at 72 bytes (not characters: Cyrillic
// letters take 2 bytes each).
export const newPassword = z
  .string()
  .min(8, 'At least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Too long: at most 72 bytes');

// A two-letter ISO country code in any case ("ua"), stored upper case ("UA").
export const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'A two-letter country code, like UA')
  .transform((code) => code.toUpperCase());

// A phone number as people write it: +380 67 123 45 67, (067) 123-45-67.
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'A phone number like +380 67 123 45 67');

// For PATCH bodies: every field is optional, but an empty body changes nothing, so it is refused.
export const atLeastOneField = (schema) =>
  schema.refine((value) => Object.keys(value).length > 0, 'Send at least one field to change');

// For user input that goes into a RegExp (search): "a.b" must mean the text "a.b", not "a" + any + "b".
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
