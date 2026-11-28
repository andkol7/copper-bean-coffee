import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- EmailTemplate ----------

// One email text: subject and body with {placeholders}, found by its key ("order.paid").
// An admin edits them through /api/v1/email-templates; the shop reads them each time it sends.
const emailTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    text: { type: String, required: true, maxlength: 10_000 },
    // Switched off: the shop simply does not send this email.
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

emailTemplateSchema.plugin(toJSONPlugin);

export const EmailTemplateCollection = mongoose.model('EmailTemplate', emailTemplateSchema);
