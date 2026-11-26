import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- Address ----------

// A delivery address saved by a customer. An order keeps its own copy of the address it was
// sent to (see Order), so changing or deleting an address here never rewrites a past order.
const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, trim: true, maxlength: 40 }, // "Home", "Work"
    name: { type: String, required: true, trim: true, maxlength: 100 }, // who receives the parcel
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true, maxlength: 120 },
    line2: { type: String, trim: true, maxlength: 120 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    postalCode: { type: String, required: true, trim: true, maxlength: 20 },
    // Two-letter ISO country code: UA, US, DE.
    country: { type: String, required: true, uppercase: true, trim: true, minlength: 2, maxlength: 2 },
  },
  { timestamps: true },
);

// "My addresses", newest first.
addressSchema.index({ user: 1, createdAt: -1 });

addressSchema.plugin(toJSONPlugin);

export const AddressCollection = mongoose.model('Address', addressSchema);
