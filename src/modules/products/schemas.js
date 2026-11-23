import { z } from 'zod';
import { CATEGORIES } from '../../db.js';
import { atLeastOneField } from '../../lib/validation.js';

// What a manager may send. Money is in cents as a whole number: 1450 means $14.50.
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens, like ethiopia-yirgacheffe');

const fields = {
  name: z.string().trim().min(1).max(120),
  slug,
  description: z.string().trim().max(2000),
  category: z.enum(CATEGORIES),
  priceCents: z.number().int().min(0).max(1_000_000), // up to $10,000
  stock: z.number().int().min(0).max(1_000_000),
  // https only: the image is shown on our pages, and a javascript: or http: link must not get in.
  imageUrl: z.url({ protocol: /^https$/ }).max(500),
  active: z.boolean(),
};

// POST /api/v1/products. The slug is made from the name if it is not sent.
export const productCreate = z.object({
  name: fields.name,
  slug: fields.slug.optional(),
  description: fields.description.optional(),
  category: fields.category,
  priceCents: fields.priceCents,
  stock: fields.stock.optional(),
  imageUrl: fields.imageUrl.optional(),
  active: fields.active.optional(),
});

// PATCH /api/v1/products/:id: any of the fields, at least one.
export const productUpdate = atLeastOneField(z.object(fields).partial());

// GET /api/v1/products. Query values arrive as text, hence coerce and stringbool.
// `active` is only for staff; for everybody else it is ignored (see Product.listFilter).
export const productListQuery = z
  .object({
    category: fields.category.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    minPriceCents: z.coerce.number().int().min(0).optional(),
    maxPriceCents: z.coerce.number().int().min(0).optional(),
    inStock: z.stringbool().optional(),
    sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'name']).optional(),
    active: z.enum(['true', 'false', 'all']).optional(),
  })
  .refine((query) => query.sort !== 'relevance' || query.q, {
    message: 'sort=relevance needs a search text (q)',
    path: ['sort'],
  })
  .refine((query) => query.minPriceCents === undefined || query.maxPriceCents === undefined || query.minPriceCents <= query.maxPriceCents, {
    message: 'minPriceCents is higher than maxPriceCents',
    path: ['minPriceCents'],
  });
