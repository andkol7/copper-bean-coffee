import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- Order ----------

export const ORDER_STATUSES = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled', 'refunded'];

const { ObjectId } = mongoose.Schema.Types;

const wholeCents = () => ({
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isInteger, message: 'must be a whole number of cents' },
});

// The name and price are COPIED from the product when the order is made, so changing or hiding
// a product later never rewrites an order that was already placed. `product` stays as a link.
const orderItemSchema = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    unitPriceCents: wholeCents(),
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'quantity must be a whole number' },
    },
  },
  { _id: false },
);

// Who changed the status, to what, and when. `by` is empty when the system did it (an expired order).
const statusChangeSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

// The chosen shipping method and its price at that moment (a copy, like the items).
const orderShippingSchema = new mongoose.Schema(
  {
    method: { type: ObjectId, ref: 'ShippingMethod', required: true },
    name: { type: String, required: true },
    priceCents: wholeCents(),
  },
  { _id: false },
);

// Where it goes: a copy of the chosen Address, so editing or deleting that address later
// does not change where a past order was sent.
const orderAddressSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    // CB-1042: the number people say aloud (see modules/counters).
    number: { type: String, required: true, unique: true },
    customer: { type: ObjectId, ref: 'User', required: true },
    items: {
      type: [orderItemSchema],
      validate: { validator: (items) => items.length > 0, message: 'An order needs at least one item' },
    },
    subtotalCents: wholeCents(), // the items
    shipping: { type: orderShippingSchema, required: true },
    shippingAddress: { type: orderAddressSchema, required: true },
    totalCents: wholeCents(), // subtotal + shipping, worked out by the server
    currency: { type: String, default: 'usd' },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_payment' },
    statusHistory: { type: [statusChangeSchema], default: [] },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

// "My orders" and the CRM list by status, newest first.
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

orderSchema.plugin(toJSONPlugin);

export const OrderCollection = mongoose.model('Order', orderSchema);
