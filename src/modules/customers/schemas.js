import { z } from 'zod';

// GET /api/v1/customers
export const customerListQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['newest', 'name', 'spent', 'orders', 'last_order']).optional(),
});
