import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- OtpCode ----------

// One-time login codes sent by email. At most one active code per email: a new request
// replaces the old one, and a successful login deletes it.
const otpCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // bcrypt hash of the 6-digit code, never the code itself.
    codeHash: { type: String, required: true },
    // Wrong guesses so far; the code is dead after the limit (see modules/otp/model.js).
    attempts: { type: Number, default: 0 },
    // TTL index: MongoDB deletes the document by itself once this time has passed.
    // Its cleanup runs about once a minute, so the code also checks expiresAt on every verify.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

otpCodeSchema.plugin(toJSONPlugin, { hide: ['codeHash'] });

export const OtpCodeCollection = mongoose.model('OtpCode', otpCodeSchema);
