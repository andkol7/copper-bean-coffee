import { z } from 'zod';
import { atLeastOneField, phone } from '../../lib/validation.js';

// The owner is never in these: it is the logged-in user, set by the model.
const text = (max) => z.string().trim().min(1).max(max);

const fields = {
  label: z.string().trim().max(40),
  name: text(100),
  phone,
  line1: text(120),
  line2: z.string().trim().max(120),
  city: text(80),
  postalCode: text(20),
  // Two letters, any case: "ua" is stored as "UA".
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'A two-letter country code, like UA')
    .transform((code) => code.toUpperCase()),
};

// POST /api/v1/addresses
export const addressCreate = z.object({
  label: fields.label.optional(),
  name: fields.name,
  phone: fields.phone,
  line1: fields.line1,
  line2: fields.line2.optional(),
  city: fields.city,
  postalCode: fields.postalCode,
  country: fields.country,
});

// PATCH /api/v1/addresses/:id
export const addressUpdate = atLeastOneField(z.object(fields).partial());
