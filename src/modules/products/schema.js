import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

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

export const ProductCollection = mongoose.model('Product', productSchema);
