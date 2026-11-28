import { OrderCollection } from './schema.js';
import { config } from '../../config.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { formatMoney } from '../../lib/template.js';
import { Address } from '../addresses/model.js';
import { Counter } from '../counters/model.js';
import { EmailTemplate } from '../email-templates/model.js';
import { Product } from '../products/model.js';
import { settings } from '../settings/model.js';
import { ShippingMethod } from '../shipping/model.js';
import { User } from '../users/model.js';

// The state machine: from which status to which, and which roles may do it.
//   pending_payment -> paid       an admin, by hand, until Stripe does it (phase 2)
//   pending_payment -> cancelled  the customer (their own order), a manager, an admin
//   paid -> shipped -> completed  a manager or an admin
// Anything not listed is refused, e.g. cancelling a paid order (that is a refund, phase 2).
const TRANSITIONS = {
  pending_payment: { paid: ['admin'], cancelled: ['customer', 'manager', 'admin'] },
  paid: { shipped: ['manager', 'admin'] },
  shipped: { completed: ['manager', 'admin'] },
};

// An order. Customers place and cancel their own; staff see all and move them along.
//   POST  /api/v1/orders       { items: [{ product, quantity }], addressId, shippingMethodId, note? }
//   PATCH /api/v1/orders/:id   { status, note? }
// The client never sends a price or a total: they are worked out here from the database.
export class Order extends BaseModel {
  static schema = OrderCollection;
  static required = ['items', 'addressId', 'shippingMethodId'];

  // ---------- Placing an order ----------

  async create({ actor } = {}) {
    if (!actor) throw unauthorized();

    // What the client sent. None of it is stored as it is: the stored items, shipping and address
    // are copies made below.
    const { items: wanted, addressId, shippingMethodId } = this;
    for (const field of ['items', 'addressId', 'shippingMethodId']) delete this[field];

    const address = await Address.findOwn(addressId, actor); // 404 for somebody else's address
    const method = await ShippingMethod.findOne({ _id: shippingMethodId, active: true }, { required: false });
    if (!method) throw badRequest(settings.message('shippingUnavailable'));
    if (!method.servesCountry(address.country)) {
      throw badRequest(settings.message('shippingNotThere', { country: address.country }));
    }

    // Stock is taken first. If anything goes wrong from here on, it is put back.
    const lines = await Order.#reserveStock(wanted);
    try {
      const { numberPrefix, numberStart } = settings.orders;
      const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
      const shippingCents = method.costFor(subtotalCents);

      this.customer = actor.id;
      this.items = lines;
      this.subtotalCents = subtotalCents;
      this.shipping = { method: method.id, name: method.name, priceCents: shippingCents };
      this.shippingAddress = {
        name: address.name,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        postalCode: address.postalCode,
        country: address.country,
      };
      this.totalCents = subtotalCents + shippingCents;
      this.status = 'pending_payment';
      this.statusHistory = [{ status: 'pending_payment', at: new Date(), by: actor.id }];

      // The number comes last, once the order is certain to go through, so a refused order
      // does not use one up (a number can still be lost if saving fails right after this).
      this.number = `${numberPrefix}${numberStart - 1 + (await Counter.next('order'))}`;

      await super.create();
    } catch (err) {
      await Order.#releaseStock(lines);
      throw err;
    }
    await this.#notify('order.created', { customer: actor, payWithinMinutes: settings.orders.unpaidExpireMinutes });
    return this;
  }

  // Takes the stock of every item, or none of it. Returns the order lines.
  static async #reserveStock(wanted) {
    const lines = [];
    try {
      for (const { product, quantity } of wanted) {
        // One atomic step: take the stock only if enough is there, and read the name and price
        // at that very moment. Two customers after the last item cannot both get it.
        const taken = await Product.updateOne(
          { _id: product, active: true, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          { required: false },
        );
        if (!taken) throw await Order.#whyNotAvailable(product);
        lines.push({ product: taken.id, name: taken.name, unitPriceCents: taken.priceCents, quantity });
      }
    } catch (err) {
      await Order.#releaseStock(lines); // the items that were already taken
      throw err;
    }
    return lines;
  }

  // The reason a product could not be taken: it is gone or hidden, or there is not enough of it.
  static async #whyNotAvailable(productId) {
    const product = await Product.findById(productId, { required: false });
    if (!product?.active) return badRequest(settings.message('productUnavailable'));
    return conflict(settings.message('notEnoughStock', { name: product.name, left: product.stock }));
  }

  // Puts stock back on the shelf. Works for order lines and for stored order items alike.
  static async #releaseStock(lines) {
    for (const { product, quantity } of lines) {
      await Product.updateOne({ _id: product }, { $inc: { stock: quantity } }, { required: false });
    }
  }

  // ---------- Changing the status ----------

  async update({ status, note } = {}, { actor } = {}) {
    if (!actor) throw unauthorized();
    await this.#changeStatus(status, { actor, note });
    return this;
  }

  // actor is empty when the system itself cancels an expired order.
  async #changeStatus(to, { actor, note }) {
    const from = this.status;
    const roles = TRANSITIONS[from]?.[to];
    if (!roles) throw conflict(settings.message('statusNotAllowed', { from, to }));
    if (actor && !roles.includes(actor.role)) throw forbidden(settings.message('forbidden'));

    // The change applies only if the order still has the status we saw. Two people pressing the
    // button at once cannot both win, and stock below is released exactly once.
    const changed = await this.updateIf(
      { status: from },
      { $set: { status: to }, $push: { statusHistory: { status: to, at: new Date(), by: actor?.id, note } } },
    );
    if (!changed) throw conflict(settings.message('statusChanged'));

    if (to === 'cancelled') await Order.#releaseStock(this.items);

    // Tell the customer. For a cancel, say why: the note given, else who did it.
    const EMAILS = { paid: 'order.paid', shipped: 'order.shipped', cancelled: 'order.cancelled' };
    if (EMAILS[to]) {
      const byCustomer = actor && String(actor.id) === String(this.customer);
      const reason = note || settings.message(byCustomer ? 'cancelledByCustomer' : 'cancelledByShop');
      await this.#notify(EMAILS[to], { reason });
    }
  }

  // ---------- Emails to the customer ----------

  // Sends one of the order emails (templates in modules/email-templates). An email that cannot be
  // sent never undoes or breaks the order: the order is the real thing, the email only reports on it.
  async #notify(key, { customer, ...extra } = {}) {
    try {
      const to = customer ?? (await User.findById(this.customer, { required: false }));
      if (!to || to.deletedAt) return; // a wiped account has no address to write to
      await EmailTemplate.send(key, { to: to.email, vars: { name: to.name, ...this.#emailVars(), ...extra } });
    } catch (err) {
      console.error(`Email ${key} for order ${this.number} was not sent: ${err.message}`);
    }
  }

  // What the order emails can say (the list an admin sees is in SYSTEM_TEMPLATES).
  #emailVars() {
    const a = this.shippingAddress;
    return {
      number: this.number,
      items: this.items.map((item) => `${item.quantity} × ${item.name}  ${formatMoney(item.unitPriceCents * item.quantity)}`).join('\n'),
      subtotal: formatMoney(this.subtotalCents),
      shippingName: this.shipping.name,
      shippingPrice: this.shipping.priceCents ? formatMoney(this.shipping.priceCents) : 'free',
      total: formatMoney(this.totalCents),
      address: [a.name, a.line1, a.line2, `${a.postalCode} ${a.city}, ${a.country}`, a.phone].filter(Boolean).join('\n'),
      orderUrl: `${config.APP_URL}/order?id=${this.id}`,
    };
  }

  // Cancels the orders that were not paid in time and returns their stock. Called by the timer
  // in server.js. Returns how many were cancelled.
  static async cancelExpired() {
    const cutoff = new Date(Date.now() - settings.orders.unpaidExpireMinutes * 60_000);
    const { items } = await this.list(
      { status: 'pending_payment', createdAt: { $lt: cutoff } },
      { limit: 100, sort: { createdAt: 1, _id: 1 } },
    );

    let cancelled = 0;
    for (const order of items) {
      try {
        await order.#changeStatus('cancelled', { note: settings.message('orderExpired') });
        cancelled++;
      } catch (err) {
        if (err.status !== 409) throw err; // paid or cancelled by somebody in the meantime: leave it
      }
    }
    return cancelled;
  }

  // Orders are never deleted: they are the record of what was sold. Cancel or refund them.
  async delete() {
    throw new Error('Orders are never deleted: cancel or refund them instead');
  }

  // ---------- Who sees what ----------

  // Customers see only their own orders; staff see all, and may narrow them by customer.
  static listFilter({ status, number, customer } = {}, { actor } = {}) {
    const filter = {};
    if (!actor.isStaff) filter.customer = actor.id;
    else if (customer) filter.customer = customer;
    if (status) filter.status = status;
    if (number) filter.number = number.toUpperCase();
    return filter;
  }

  // One order. Somebody else's order is a 404 for a customer, as if it did not exist.
  static async findFor(id, actor) {
    return actor.isStaff ? this.findById(id) : this.findOne({ _id: id, customer: actor.id });
  }
}
