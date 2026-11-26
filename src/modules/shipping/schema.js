import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- ShippingMethod ----------

// A way to get an order to the customer, with its price ("Standard", "Express"). Staff manage
// them in the CRM. An order copies the name and price of the one chosen, like it copies product
// prices, so changing a price here never changes past orders.
const shippingMethodSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 }, // "Delivery in 3-5 working days"
    priceCents: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'priceCents must be a whole number' },
    },
    // Delivery is free when the items cost at least this much. Empty means never free.
    freeOverCents: {
      type: Number,
      min: 0,
      validate: { validator: (value) => value == null || Number.isInteger(value), message: 'freeOverCents must be a whole number' },
    },
    // Two-letter country codes it delivers to. Empty means everywhere.
    countries: { type: [{ type: String, uppercase: true, trim: true, minlength: 2, maxlength: 2 }], default: [] },
    // Soft delete, like products: orders that used it keep their copy, the method is just hidden.
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

shippingMethodSchema.index({ active: 1, priceCents: 1 });
shippingMethodSchema.plugin(toJSONPlugin);

export const ShippingMethodCollection = mongoose.model('ShippingMethod', shippingMethodSchema);
