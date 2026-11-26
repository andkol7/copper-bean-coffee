import mongoose from 'mongoose';
import { escapeRegex } from '../../lib/validation.js';
import { Address } from '../addresses/model.js';
import { OrderCollection, SPENT_STATUSES } from '../orders/schema.js';
import { Order } from '../orders/model.js';
import { settings } from '../settings/model.js';
import { User } from '../users/model.js';

// A customer is not a separate collection: it is a User with the role customer. This class is the
// CRM's read-only view of them, adding what the shop knows about each one from their orders:
//   orders       how many orders they placed (any status)
//   spentCents   the money of their paid, shipped and completed orders
//   lastOrderAt  when they last ordered
// Editing a customer goes through /api/v1/users (admin); CRM notes come in phase 3.
export class Customer extends User {
  // GET /api/v1/customers?q=ann. Wiped accounts are left out of the list (see User.delete).
  static listFilter({ q } = {}) {
    const filter = { role: 'customer', deletedAt: null };
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ email: pattern }, { name: pattern }];
    }
    return filter;
  }

  // ?sort=newest|name|spent|orders|last_order. _id breaks ties, so pages never repeat or skip.
  static listOptions({ sort = 'newest' } = {}) {
    const SORTS = {
      newest: { createdAt: -1, _id: -1 },
      name: { name: 1, _id: 1 },
      spent: { 'stats.spentCents': -1, _id: -1 },
      orders: { 'stats.orders': -1, _id: -1 },
      last_order: { 'stats.lastOrderAt': -1, _id: -1 },
    };
    return { sort: SORTS[sort] };
  }

  // The list with statistics, worked out by MongoDB in ONE aggregation, not one query per customer:
  // for each user it joins their orders ($lookup, which uses the { customer, createdAt } index on
  // orders) and sums them up ($group). Sorting by money spent works across all pages because the
  // database sorts after the sums are known.
  static async list(filter = {}, { page = 1, limit = 20, sort = { createdAt: -1, _id: -1 } } = {}) {
    const [result] = await this.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: OrderCollection.collection.name,
          localField: '_id',
          foreignField: 'customer',
          pipeline: [Customer.#statsGroup()],
          as: 'stats',
        },
      },
      { $addFields: { stats: { $ifNull: [{ $first: '$stats' }, Customer.#noStats()] } } },
      { $project: { email: 1, name: 1, phone: 1, createdAt: 1, stats: { orders: 1, spentCents: 1, lastOrderAt: 1 } } },
      { $sort: sort },
      { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'count' }] } },
    ]);

    const total = result.total[0]?.count ?? 0;
    const items = result.items.map(({ _id, ...customer }) => ({ id: String(_id), ...customer }));
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
  }

  // GET /api/v1/customers/:id: the card in the CRM. A user who is not a customer is a 404 here.
  // A wiped account still opens, so staff can see the history behind its orders.
  static async profile(id) {
    const customer = await this.findOne({ _id: id, role: 'customer' });
    const [[stats], recent, addresses] = await Promise.all([
      // An aggregation is sent to MongoDB as it is: Mongoose does not turn the id text into an
      // ObjectId here the way it does in find(), so it is done by hand.
      Order.aggregate([{ $match: { customer: new mongoose.Types.ObjectId(customer.id) } }, Customer.#statsGroup()]),
      Order.list({ customer: customer.id }, { limit: settings.customers.recentOrders }),
      Address.list({ user: customer.id }, { limit: settings.addresses.maxPerUser }),
    ]);
    const { _id, ...numbers } = stats ?? Customer.#noStats();
    return { ...customer.toJSON(), stats: numbers, recentOrders: recent.items, addresses: addresses.items };
  }

  // The sums for one customer's orders. Used by both the list and the card, so they always agree.
  static #statsGroup() {
    return {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        spentCents: { $sum: { $cond: [{ $in: ['$status', SPENT_STATUSES] }, '$totalCents', 0] } },
        lastOrderAt: { $max: '$createdAt' },
      },
    };
  }

  static #noStats() {
    return { orders: 0, spentCents: 0, lastOrderAt: null };
  }
}
