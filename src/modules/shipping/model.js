import { ShippingMethodCollection } from './schema.js';
import { BaseModel } from '../../lib/BaseModel.js';

// A way to deliver an order, with its price. The order takes a copy of the chosen method's name
// and price when it is created (the next step), so editing a method never changes a past order.
export class ShippingMethod extends BaseModel {
  static schema = ShippingMethodCollection;
  static required = ['name', 'priceCents'];

  // What delivery costs for items worth subtotalCents: free from the threshold up, if there is one.
  costFor(subtotalCents) {
    const free = this.freeOverCents != null && subtotalCents >= this.freeOverCents;
    return free ? 0 : this.priceCents;
  }

  // Does it deliver to this country? A method with no countries delivers everywhere.
  servesCountry(country) {
    return this.countries.length === 0 || this.countries.includes(country.toUpperCase());
  }

  // Soft delete, as for products: it only stops being offered. PATCH { active: true } brings it back.
  async delete() {
    await this.update({ active: false });
    return true;
  }

  // GET /api/v1/shipping-methods?country=UA. Customers and guests get the methods on offer;
  // staff may also ask for hidden ones with active=false, or all with active=all.
  static listFilter({ country, active } = {}, { actor } = {}) {
    const filter = {};

    const wanted = actor?.isStaff ? (active ?? 'true') : 'true';
    if (wanted !== 'all') filter.active = wanted === 'true';

    // The ones that deliver there, and the ones that deliver everywhere.
    if (country) filter.$or = [{ countries: { $size: 0 } }, { countries: country }];

    return filter;
  }

  // Cheapest first.
  static listOptions() {
    return { sort: { priceCents: 1, _id: 1 } };
  }
}
