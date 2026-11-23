import { z } from 'zod';
import { atLeastOneField, countryCode } from '../../lib/validation.js';

// Money is in cents as a whole number: 499 means $4.99.
const cents = z.number().int().min(0).max(1_000_000);

const fields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  priceCents: cents,
  // null removes the threshold: the method is never free.
  freeOverCents: cents.nullable(),
  // An empty list means everywhere. Repeated codes are folded into one.
  countries: z.array(countryCode).max(250).transform((codes) => [...new Set(codes)]),
  active: z.boolean(),
};

// POST /api/v1/shipping-methods
export const shippingCreate = z.object({
  name: fields.name,
  description: fields.description.optional(),
  priceCents: fields.priceCents,
  freeOverCents: cents.optional(),
  countries: fields.countries.optional(),
  active: fields.active.optional(),
});

// PATCH /api/v1/shipping-methods/:id
export const shippingUpdate = atLeastOneField(z.object(fields).partial());

// GET /api/v1/shipping-methods. `active` is only for staff; for everybody else it is ignored.
export const shippingListQuery = z.object({
  country: countryCode.optional(),
  active: z.enum(['true', 'false', 'all']).optional(),
});
