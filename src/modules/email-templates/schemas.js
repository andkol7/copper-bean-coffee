import { z } from 'zod';
import { atLeastOneField } from '../../lib/validation.js';

const fields = {
  // order.paid, newsletter.welcome: lowercase words joined by dots or hyphens
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/, 'Lowercase words joined by dots or hyphens, like order.paid')
    .max(60),
  description: z.string().trim().max(300),
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(10_000),
  active: z.boolean(),
};

// POST /api/v1/email-templates: a new template of your own (the shop's own exist already).
export const emailTemplateCreate = z.object({
  key: fields.key,
  description: fields.description.optional(),
  subject: fields.subject,
  text: fields.text,
  active: fields.active.optional(),
});

// PATCH /api/v1/email-templates/:key. The key itself does not change: the shop finds emails by it.
export const emailTemplateUpdate = atLeastOneField(
  z.object({ description: fields.description, subject: fields.subject, text: fields.text, active: fields.active }).partial(),
);
