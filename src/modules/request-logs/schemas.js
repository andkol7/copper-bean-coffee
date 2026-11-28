import { z } from 'zod';
import { objectId } from '../../lib/validation.js';

// GET /api/v1/request-logs
export const requestLogListQuery = z.object({
  status: z
    .string()
    .regex(/^([1-5]xx|[1-5]\d\d)$/, 'A status like 404 or a class like 4xx')
    .optional(),
  errors: z.stringbool().optional(), // true: only answers 400 and up
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'get', 'post', 'put', 'patch', 'delete']).optional(),
  path: z.string().trim().min(1).max(200).optional(),
  user: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
