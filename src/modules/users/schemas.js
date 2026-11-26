import { z } from 'zod';
import { ROLES } from './schema.js';
import { atLeastOneField, email, newPassword, phone } from '../../lib/validation.js';

// Each route gets exactly the fields its caller may set. Fields not listed are dropped,
// so e.g. a registering customer cannot send role: 'admin'.

const name = z.string().trim().min(1).max(100);

// POST /api/v1/users - anyone registers, always as a customer.
export const userRegister = z.object({ email, name, password: newPassword, phone: phone.optional() });

// POST /api/v1/staff - an admin creates a manager or another admin.
export const staffCreate = userRegister.extend({ role: z.enum(['manager', 'admin']) });

// PATCH /api/v1/users/me - your own profile. A new password needs the current one.
export const meUpdate = atLeastOneField(
  z.object({
    name: name.optional(),
    phone: phone.optional(),
    password: newPassword.optional(),
    currentPassword: z.string().max(200).optional(),
  }),
).refine((value) => value.password === undefined || value.currentPassword, {
  message: 'currentPassword is required to set a new password',
  path: ['currentPassword'],
});

// PATCH /api/v1/users/:id - an admin edits someone. No password or email here.
export const userUpdate = atLeastOneField(
  z.object({ name: name.optional(), phone: phone.optional(), role: z.enum(ROLES).optional() }),
);

// GET /api/v1/users?role=manager&q=ann
export const userListQuery = z.object({
  role: z.enum(ROLES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
