import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- User ----------

// customer: buys in the shop. manager: works in the CRM. admin: everything, incl. managing staff.
export const ROLES = ['admin', 'manager', 'customer'];
// Roles that work in the CRM: they see and change what customers cannot.
export const STAFF_ROLES = ['manager', 'admin'];

const userSchema = new mongoose.Schema(
  {
    // The login. Stored lowercased, so Ann@Mail.com and ann@mail.com are the same account.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    // Only a bcrypt hash, never the password itself. select: false keeps it out of every
    // query unless asked for explicitly (.select('+passwordHash')), which only login does.
    passwordHash: { type: String, required: true, select: false },
    // Indexed: the CRM lists customers by role.
    role: { type: String, enum: ROLES, default: 'customer', index: true },
    // Set when an account with history (orders) was deleted: the record stays so its orders keep
    // their customer, but the personal data is wiped and nobody can log in to it (see User.delete).
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Second safety net: even if a query does load the hash, it never gets into a response.
userSchema.plugin(toJSONPlugin, { hide: ['passwordHash'] });

export const UserCollection = mongoose.model('User', userSchema);
