import mongoose from 'mongoose';

// Everything about the database lives here: connecting, disconnecting and the schemas.

// ---------- Connection ----------

export async function connectDb(uri) {
  // Fail after 10 s instead of hanging if the database cannot be reached.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

// ---------- Shared settings ----------

// API responses show `id` instead of `_id` and leave out Mongoose's internal `__v`.
// `hide` lists fields that must never leave the server, e.g. a password hash.
function toJSONPlugin(schema, { hide = [] } = {}) {
  schema.set('toJSON', {
    versionKey: false,
    transform(doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const field of hide) delete ret[field];
      return ret;
    },
  });
}

// ---------- Product ----------

export const CATEGORIES = ['coffee', 'tea', 'equipment'];

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Part of the product URL (/products/ethiopia-yirgacheffe), so it must be unique.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: CATEGORIES, required: true },
    // Money is stored in cents as an integer (1250 = $12.50), never as a float:
    // 0.1 + 0.2 !== 0.3 in JavaScript, and Stripe also works in cents.
    priceCents: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'priceCents must be a whole number' },
    },
    currency: { type: String, default: 'usd' },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: { validator: Number.isInteger, message: 'stock must be a whole number' },
    },
    imageUrl: { type: String },
    // Soft delete: a product that was ever ordered must stay readable in old orders,
    // so instead of deleting it we hide it from the shop.
    active: { type: Boolean, default: true },
  },
  { timestamps: true }, // adds createdAt and updatedAt
);

// Covers the shop listing: active products, optionally by category, sorted by price.
productSchema.index({ active: 1, category: 1, priceCents: 1 });
// Full-text search over name and description; a match in the name counts five times more.
productSchema.index({ name: 'text', description: 'text' }, { weights: { name: 5, description: 1 } });

// `score` is the search relevance MongoDB adds to text search results; it is not a product field.
productSchema.plugin(toJSONPlugin, { hide: ['score'] });

export const Product = mongoose.model('Product', productSchema);

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
  },
  { timestamps: true },
);

// Second safety net: even if a query does load the hash, it never gets into a response.
userSchema.plugin(toJSONPlugin, { hide: ['passwordHash'] });

export const User = mongoose.model('User', userSchema);

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

export const OtpCode = mongoose.model('OtpCode', otpCodeSchema);

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

export const Address = mongoose.model('Address', addressSchema);

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

export const Order = mongoose.model('Order', orderSchema);

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

export const ShippingMethod = mongoose.model('ShippingMethod', shippingMethodSchema);

// ---------- Counter ----------

// Numbers that count up: one document per sequence, `_id` is its name ('order') and `seq` the
// last number given out. See modules/counters.
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

export const Counter = mongoose.model('Counter', counterSchema);

// ---------- Session ----------

// One document per issued refresh token. The token itself (random 256 bits) is given to the
// client once; only its sha256 is stored, so a database leak gives no working tokens.
// sha256 rather than bcrypt: the token cannot be brute-forced anyway, and an unsalted hash can
// be looked up directly (findOne({ tokenHash })).
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // Shared by all tokens of one login, through every refresh. If a used token comes back,
    // someone has a copy, and the whole family is revoked.
    family: { type: String, required: true, index: true },
    // When this token was exchanged for a new pair; a token works only once.
    usedAt: { type: Date, default: null },
    // TTL index: MongoDB deletes the document after this time.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

sessionSchema.plugin(toJSONPlugin, { hide: ['tokenHash'] });

export const Session = mongoose.model('Session', sessionSchema);

// ---------- PasswordFailure ----------

// Wrong-password counter per email (see settings.passwordLock). Kept for unknown emails too,
// so a lock never tells whether an account exists. Every failure pushes expiresAt forward;
// the TTL index removes the counter once the email has been quiet long enough.
const passwordFailureSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    failures: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

passwordFailureSchema.plugin(toJSONPlugin);

export const PasswordFailure = mongoose.model('PasswordFailure', passwordFailureSchema);

// ---------- Setting ----------

// Shop settings an admin can change without a deploy (limits, email texts, messages).
// A single document with key 'main'; `values` keeps only what differs from the defaults
// in src/modules/settings/model.js, so a new default in code applies until someone overrides it.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  // minimize: false keeps `values: {}` instead of dropping the empty object.
  { timestamps: true, minimize: false },
);

settingSchema.plugin(toJSONPlugin);

export const Setting = mongoose.model('Setting', settingSchema);
