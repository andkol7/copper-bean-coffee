import { z } from 'zod';
import { ORDER_STATUSES } from './schema.js';
import { objectId } from '../../lib/validation.js';

const note = z.string().trim().max(500);

// POST /api/v1/orders. There is no price and no total here on purpose: the server works them
// out from the database. Each product may appear once; send a bigger quantity instead.
export const orderCreate = z.object({
  items: z
    .array(z.object({ product: objectId, quantity: z.number().int().min(1).max(100) }))
    .min(1)
    .max(50)
    .refine((items) => new Set(items.map((item) => item.product)).size === items.length, {
      message: 'Each product may appear only once, send a bigger quantity instead',
    }),
  addressId: objectId,
  shippingMethodId: objectId,
  note: note.optional(),
});

// PATCH /api/v1/orders/:id. What the caller may actually do depends on their role and on the
// current status: see the state machine in the model.
export const orderStatusChange = z.object({ status: z.enum(ORDER_STATUSES), note: note.optional() });

// GET /api/v1/orders. `customer` is only for staff; for a customer it is ignored.
export const orderListQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  number: z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'An order number like CB-1042').optional(),
  customer: objectId.optional(),
});
