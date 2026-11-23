import { Product as ProductCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { badRequest } from '../../lib/errors.js';
import { settings } from '../settings/model.js';

// 'Ethiopia Yirgacheffé' → 'ethiopia-yirgacheffe'. Accents are dropped; letters outside a-z
// (Cyrillic, say) are not transliterated, so a name made only of those gives '' and the
// manager has to send the slug by hand.
export const slugify = (text) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// How ?sort= maps to MongoDB. _id is the tie-breaker, so pages never repeat or skip a product.
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { priceCents: 1, _id: 1 },
  price_desc: { priceCents: -1, _id: -1 },
  name: { name: 1, _id: 1 },
};
const RELEVANCE = { score: { $meta: 'textScore' } };

// A product in the shop. Customers see only active products; staff can see and edit the rest.
//   await new Product({ name, category, priceCents }).create()   // the slug comes from the name
export class Product extends BaseModel {
  static schema = ProductCollection;
  static required = ['name', 'category', 'priceCents'];

  async create(options) {
    this.slug ??= slugify(this.name);
    if (!this.slug) throw badRequest(settings.message('slugNeeded'));
    return super.create(options);
  }

  // Soft delete: a product that was ordered has to stay readable in old orders, so deleting
  // only takes it off sale. PATCH { active: true } puts it back.
  async delete() {
    await this.update({ active: false });
    return true;
  }

  // GET /api/v1/products?category=coffee&q=ethiopia&minPriceCents=1000&inStock=true&sort=price_asc
  // Visitors and customers always get products on sale only; staff may ask for the hidden
  // ones too with active=false, or for everything with active=all.
  static listFilter({ category, q, minPriceCents, maxPriceCents, inStock, active } = {}, { actor } = {}) {
    const filter = {};

    const wanted = actor?.isStaff ? (active ?? 'true') : 'true';
    if (wanted !== 'all') filter.active = wanted === 'true';

    if (category) filter.category = category;
    if (inStock) filter.stock = { $gt: 0 };

    if (minPriceCents !== undefined || maxPriceCents !== undefined) {
      filter.priceCents = {};
      if (minPriceCents !== undefined) filter.priceCents.$gte = minPriceCents;
      if (maxPriceCents !== undefined) filter.priceCents.$lte = maxPriceCents;
    }

    // MongoDB full-text search over name and description (the index in db.js): whole words,
    // not parts of words, case-insensitive. "quoted phrases" and -excluded words work too.
    if (q) filter.$text = { $search: q };

    return filter;
  }

  // With a search text the best match comes first, unless another order was asked for.
  static listOptions({ q, sort } = {}) {
    const order = sort ?? (q ? 'relevance' : 'newest');
    if (order === 'relevance' && q) return { sort: { ...RELEVANCE, _id: -1 }, select: RELEVANCE };
    return { sort: SORTS[order] ?? SORTS.newest };
  }
}
