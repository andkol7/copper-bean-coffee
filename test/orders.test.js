import { expect } from 'chai';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  Address as AddressCollection,
  Counter as CounterCollection,
  Order as OrderCollection,
  Product as ProductCollection,
  Session as SessionCollection,
  Setting,
  ShippingMethod as ShippingCollection,
  User as UserCollection,
} from '../src/db.js';
import { Address } from '../src/modules/addresses/model.js';
import { Counter } from '../src/modules/counters/model.js';
import { Order } from '../src/modules/orders/model.js';
import { Product } from '../src/modules/products/model.js';
import { settings } from '../src/modules/settings/model.js';
import { ShippingMethod } from '../src/modules/shipping/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';
const MISSING_ID = '507f1f77bcf86cd799439011';

const api = (method, path, token) => {
  const req = request(app)[method](path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

const address = (extra = {}) => ({
  name: 'Ann Smith',
  phone: '+380 67 123 45 67',
  line1: '12 Khreshchatyk St',
  city: 'Kyiv',
  postalCode: '01001',
  country: 'UA',
  ...extra,
});

describe('orders', () => {
  const t = {}; // access tokens
  const u = {}; // users
  const p = {}; // products
  const s = {}; // shipping methods
  const a = {}; // addresses

  before(async () => {
    await startDb();
    await Promise.all(
      [OrderCollection, ProductCollection, UserCollection, ShippingCollection, AddressCollection, Setting].map((c) => c.init()),
    );
  });
  after(async () => {
    await settings.reset();
    await stopDb();
  });

  beforeEach(async () => {
    for (const [name, role] of [['ann', 'customer'], ['bob', 'customer'], ['manager', 'manager'], ['admin', 'admin']]) {
      const email = `${name}@example.com`;
      u[name] = await new User({ email, name, password: PASSWORD, role }).create();
      t[name] = (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;
    }

    p.coffee = await new Product({ name: 'Ethiopia Yirgacheffe', category: 'coffee', priceCents: 1450, stock: 10 }).create();
    p.tin = await new Product({ name: 'Tea Tin', category: 'tea', priceCents: 2500, stock: 10 }).create();
    p.grinder = await new Product({ name: 'Hand Grinder', category: 'equipment', priceCents: 5900, stock: 2 }).create();
    p.hidden = await new Product({ name: 'Kenya AA', category: 'coffee', priceCents: 1600, stock: 5, active: false }).create();

    s.standard = await new ShippingMethod({ name: 'Standard', priceCents: 499, freeOverCents: 5000, countries: ['UA'] }).create();
    s.intl = await new ShippingMethod({ name: 'International', priceCents: 2499, countries: ['US'] }).create();
    s.off = await new ShippingMethod({ name: 'Old courier', priceCents: 300, countries: ['UA'], active: false }).create();

    a.ann = await new Address(address()).create({ actor: u.ann });
    a.annUS = await new Address(address({ city: 'Austin', country: 'US', postalCode: '73301' })).create({ actor: u.ann });
    a.bob = await new Address(address({ name: 'Bob', city: 'Lviv' })).create({ actor: u.bob });
  });
  afterEach(async () => {
    await Promise.all(
      [OrderCollection, ProductCollection, UserCollection, ShippingCollection, AddressCollection, CounterCollection, SessionCollection].map((c) =>
        c.deleteMany({}),
      ),
    );
    await settings.reset();
  });

  const stockOf = async (product) => (await ProductCollection.findById(product.id)).stock;

  // Places an order as ann by default: 2 coffees, Standard shipping, her Kyiv address.
  const place = (token = t.ann, over = {}) =>
    api('post', '/api/v1/orders', token).send({
      items: [{ product: p.coffee.id, quantity: 2 }],
      addressId: a.ann.id,
      shippingMethodId: s.standard.id,
      ...over,
    });

  const setStatus = (token, id, status, note) => api('patch', `/api/v1/orders/${id}`, token).send({ status, note });

  describe('POST /api/v1/orders', () => {
    it('places an order: copies name and price, works out the totals, takes the stock', async () => {
      const res = await place();
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ number: 'CB-1001', status: 'pending_payment', customer: u.ann.id, currency: 'usd' });

      expect(res.body.items).to.deep.equal([{ product: p.coffee.id, name: 'Ethiopia Yirgacheffe', unitPriceCents: 1450, quantity: 2 }]);
      expect(res.body.subtotalCents).to.equal(2900);
      expect(res.body.shipping).to.deep.equal({ method: s.standard.id, name: 'Standard', priceCents: 499 });
      expect(res.body.totalCents).to.equal(3399);
      expect(res.body.shippingAddress).to.include({ name: 'Ann Smith', city: 'Kyiv', country: 'UA' });
      expect(res.body.shippingAddress).to.not.have.property('user');

      expect(res.body.statusHistory).to.have.length(1);
      expect(res.body.statusHistory[0]).to.include({ status: 'pending_payment', by: u.ann.id });
      expect(await stockOf(p.coffee)).to.equal(8);
    });

    it('numbers count up', async () => {
      expect((await place()).body.number).to.equal('CB-1001');
      expect((await place()).body.number).to.equal('CB-1002');
    });

    it('the numbering comes from settings', async () => {
      await settings.update({ orders: { numberPrefix: 'X-', numberStart: 5000 } });
      expect((await place()).body.number).to.equal('X-5000');
      expect((await place()).body.number).to.equal('X-5001');
    });

    it('delivery is free from the threshold up, and the threshold itself counts', async () => {
      const below = await place(t.ann, { items: [{ product: p.tin.id, quantity: 1 }] }); // 2500
      expect(below.body.shipping.priceCents).to.equal(499);
      expect(below.body.totalCents).to.equal(2999);

      const exactly = await place(t.ann, { items: [{ product: p.tin.id, quantity: 2 }] }); // 5000
      expect(exactly.body.shipping).to.include({ name: 'Standard', priceCents: 0 });
      expect(exactly.body.totalCents).to.equal(5000);
    });

    it('several products in one order add up', async () => {
      const res = await place(t.ann, { items: [{ product: p.coffee.id, quantity: 1 }, { product: p.grinder.id, quantity: 1 }] });
      expect(res.body.subtotalCents).to.equal(1450 + 5900);
      expect(res.body.shipping.priceCents).to.equal(0); // over $50
      expect(res.body.items).to.have.length(2);
    });

    it('ignores any price, total, status or customer the client sends', async () => {
      const res = await place(t.ann, {
        items: [{ product: p.coffee.id, quantity: 2, unitPriceCents: 1, name: 'Free coffee' }],
        subtotalCents: 1,
        totalCents: 1,
        status: 'paid',
        customer: u.bob.id,
        number: 'CB-1',
      });
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ totalCents: 3399, status: 'pending_payment', customer: u.ann.id, number: 'CB-1001' });
      expect(res.body.items[0]).to.include({ name: 'Ethiopia Yirgacheffe', unitPriceCents: 1450 });
    });

    it('keeps its own copy: later changes to the product, the shipping method or the address do not touch it', async () => {
      const { body } = await place();

      await p.coffee.update({ priceCents: 1, name: 'Renamed' });
      await s.standard.update({ priceCents: 1 });
      await a.ann.update({ city: 'Lviv' });

      const again = (await api('get', `/api/v1/orders/${body.id}`, t.ann)).body;
      expect(again.items[0]).to.include({ name: 'Ethiopia Yirgacheffe', unitPriceCents: 1450 });
      expect(again.shipping.priceCents).to.equal(499);
      expect(again.shippingAddress.city).to.equal('Kyiv');
      expect(again.totalCents).to.equal(3399);
    });

    it('400 for a bad body, and nothing is taken', async () => {
      const bad = [
        { items: [] },
        { items: [{ product: p.coffee.id, quantity: 1 }, { product: p.coffee.id, quantity: 2 }] }, // the same product twice
        { items: [{ product: p.coffee.id, quantity: 0 }] },
        { items: [{ product: p.coffee.id, quantity: 1.5 }] },
        { items: [{ product: p.coffee.id }] },
        { items: [{ product: 'not-an-id', quantity: 1 }] },
        { addressId: undefined },
        { shippingMethodId: 'nope' },
        { note: 'x'.repeat(501) },
      ];
      for (const over of bad) expect((await place(t.ann, over)).status, JSON.stringify(over).slice(0, 70)).to.equal(400);
      expect(await stockOf(p.coffee)).to.equal(10);
      expect(await OrderCollection.countDocuments()).to.equal(0);
    });

    it('a product that is hidden or does not exist is refused', async () => {
      const hidden = await place(t.ann, { items: [{ product: p.hidden.id, quantity: 1 }] });
      expect(hidden.status).to.equal(400);
      expect(hidden.body.error.message).to.equal(settings.message('productUnavailable'));
      expect((await place(t.ann, { items: [{ product: MISSING_ID, quantity: 1 }] })).status).to.equal(400);
      expect(await stockOf(p.hidden)).to.equal(5);
    });

    it('not enough stock: 409, and the items that were already taken are put back', async () => {
      const res = await place(t.ann, { items: [{ product: p.coffee.id, quantity: 2 }, { product: p.grinder.id, quantity: 3 }] });
      expect(res.status).to.equal(409);
      expect(res.body.error.message).to.equal(settings.message('notEnoughStock', { name: 'Hand Grinder', left: 2 }));

      expect(await stockOf(p.coffee)).to.equal(10);
      expect(await stockOf(p.grinder)).to.equal(2);
      expect(await OrderCollection.countDocuments()).to.equal(0);
      expect((await place()).body.number).to.equal('CB-1001'); // the refused order did not use a number up
    });

    it('the last items cannot be sold twice, even when everybody orders at once', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => place(t.ann, { items: [{ product: p.grinder.id, quantity: 1 }] })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).to.deep.equal([201, 201, 409, 409, 409, 409]);

      expect(await stockOf(p.grinder)).to.equal(0);
      const numbers = results.filter((r) => r.status === 201).map((r) => r.body.number).sort();
      expect(numbers).to.deep.equal(['CB-1001', 'CB-1002']);
    });

    it('an address that is not yours is a 404; a shipping method that is hidden or does not deliver there is a 400', async () => {
      expect((await place(t.ann, { addressId: a.bob.id })).status).to.equal(404);
      expect((await place(t.ann, { addressId: MISSING_ID })).status).to.equal(404);

      expect((await place(t.ann, { shippingMethodId: s.off.id })).status).to.equal(400);
      expect((await place(t.ann, { shippingMethodId: MISSING_ID })).status).to.equal(400);

      const notThere = await place(t.ann, { shippingMethodId: s.standard.id, addressId: a.annUS.id });
      expect(notThere.status).to.equal(400);
      expect(notThere.body.error.message).to.equal(settings.message('shippingNotThere', { country: 'US' }));
      expect((await place(t.ann, { shippingMethodId: s.intl.id, addressId: a.annUS.id })).status).to.equal(201);

      expect(await OrderCollection.countDocuments()).to.equal(1);
    });

    it('401 without a token', async () => {
      expect((await place(null)).status).to.equal(401);
    });

    it('if saving fails after the stock was taken, the stock is put back', async () => {
      const real = Counter.next;
      Counter.next = async () => {
        throw new Error('the counter is down');
      };
      let res;
      try {
        res = await place();
      } finally {
        Counter.next = real;
      }
      expect(res.status).to.equal(500);
      expect(await stockOf(p.coffee)).to.equal(10);
      expect(await OrderCollection.countDocuments()).to.equal(0);
    });
  });

  describe('reading orders', () => {
    let annOrder;
    let annSecond;
    let bobOrder;
    beforeEach(async () => {
      annOrder = (await place()).body;
      annSecond = (await place(t.ann, { items: [{ product: p.tin.id, quantity: 1 }] })).body;
      bobOrder = (await place(t.bob, { addressId: a.bob.id })).body;
    });

    it('a customer sees only their own orders, newest first', async () => {
      const res = await api('get', '/api/v1/orders', t.ann);
      expect(res.body).to.include({ total: 2, page: 1 });
      expect(res.body.items.map((o) => o.number)).to.deep.equal([annSecond.number, annOrder.number]);
      expect((await api('get', '/api/v1/orders', t.bob)).body.total).to.equal(1);
      expect((await api('get', '/api/v1/orders')).status).to.equal(401);
    });

    it('a customer cannot widen the list with ?customer=', async () => {
      const res = await api('get', `/api/v1/orders?customer=${u.bob.id}`, t.ann);
      expect(res.body.total).to.equal(2);
      expect(res.body.items.every((o) => o.customer === u.ann.id)).to.equal(true);
    });

    it('staff see all orders, and can narrow them by customer, status and number', async () => {
      expect((await api('get', '/api/v1/orders', t.manager)).body.total).to.equal(3);
      expect((await api('get', `/api/v1/orders?customer=${u.bob.id}`, t.manager)).body.items[0].number).to.equal(bobOrder.number);

      await setStatus(t.admin, annOrder.id, 'paid');
      expect((await api('get', '/api/v1/orders?status=paid', t.manager)).body.total).to.equal(1);
      expect((await api('get', '/api/v1/orders?status=pending_payment', t.ann)).body.total).to.equal(1);
      expect((await api('get', `/api/v1/orders?number=${annOrder.number.toLowerCase()}`, t.manager)).body.items[0].id).to.equal(annOrder.id);
      expect((await api('get', '/api/v1/orders?status=lost', t.manager)).status).to.equal(400);
    });

    it('paginates', async () => {
      const res = await api('get', '/api/v1/orders?limit=1&page=2', t.manager);
      expect(res.body).to.include({ total: 3, pages: 3, page: 2 });
      expect(res.body.items).to.have.length(1);
    });

    it('GET one: yours or any as staff; somebody else\'s is a 404 for a customer', async () => {
      expect((await api('get', `/api/v1/orders/${annOrder.id}`, t.ann)).body.number).to.equal(annOrder.number);
      expect((await api('get', `/api/v1/orders/${annOrder.id}`, t.manager)).status).to.equal(200);
      expect((await api('get', `/api/v1/orders/${annOrder.id}`, t.bob)).status).to.equal(404);
      expect((await api('get', `/api/v1/orders/${MISSING_ID}`, t.ann)).status).to.equal(404);
      expect((await api('get', '/api/v1/orders/not-an-id', t.ann)).status).to.equal(400);
      expect((await api('get', `/api/v1/orders/${annOrder.id}`)).status).to.equal(401);
    });
  });

  describe('changing the status', () => {
    let order;
    beforeEach(async () => {
      order = (await place()).body; // 2 coffees taken: stock 8
    });

    it('a customer can cancel their own unpaid order, and the stock goes back', async () => {
      const res = await setStatus(t.ann, order.id, 'cancelled', 'Changed my mind');
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('cancelled');
      expect(res.body.statusHistory).to.have.length(2);
      expect(res.body.statusHistory[1]).to.include({ status: 'cancelled', by: u.ann.id, note: 'Changed my mind' });
      expect(await stockOf(p.coffee)).to.equal(10);
    });

    it('cancelling twice is a 409, and the stock is not put back twice', async () => {
      await setStatus(t.ann, order.id, 'cancelled');
      expect((await setStatus(t.ann, order.id, 'cancelled')).status).to.equal(409);
      expect(await stockOf(p.coffee)).to.equal(10);
    });

    it('two cancellations at the same moment: one wins, the stock goes back once', async () => {
      const results = await Promise.all([setStatus(t.ann, order.id, 'cancelled'), setStatus(t.manager, order.id, 'cancelled')]);
      expect(results.map((r) => r.status).sort()).to.deep.equal([200, 409]);
      expect(await stockOf(p.coffee)).to.equal(10);
    });

    it('somebody else\'s order is a 404 and stays as it was', async () => {
      expect((await setStatus(t.bob, order.id, 'cancelled')).status).to.equal(404);
      expect((await OrderCollection.findById(order.id)).status).to.equal('pending_payment');
    });

    it('a customer may not do anything but cancel: 403 for paid, 409 for moves that do not exist', async () => {
      expect((await setStatus(t.ann, order.id, 'paid')).status).to.equal(403);
      expect((await setStatus(t.ann, order.id, 'shipped')).status).to.equal(409);
      expect((await setStatus(t.ann, order.id, 'refunded')).status).to.equal(409);
      expect((await setStatus(t.ann, order.id, 'pending_payment')).status).to.equal(409);
    });

    it('a manager can cancel and ship, but only an admin can mark an order as paid', async () => {
      expect((await setStatus(t.manager, order.id, 'paid')).status).to.equal(403);
      expect((await setStatus(t.manager, order.id, 'shipped')).status).to.equal(409); // not paid yet

      expect((await setStatus(t.admin, order.id, 'paid', 'Bank transfer')).status).to.equal(200);
      expect((await setStatus(t.manager, order.id, 'shipped')).body.status).to.equal('shipped');
      expect((await setStatus(t.manager, order.id, 'completed')).body.status).to.equal('completed');
    });

    it('the history says who did what, in order', async () => {
      await setStatus(t.admin, order.id, 'paid', 'Bank transfer');
      await setStatus(t.manager, order.id, 'shipped');
      const { statusHistory } = (await api('get', `/api/v1/orders/${order.id}`, t.ann)).body;
      expect(statusHistory.map((h) => h.status)).to.deep.equal(['pending_payment', 'paid', 'shipped']);
      expect(statusHistory[1]).to.include({ by: u.admin.id, note: 'Bank transfer' });
      expect(statusHistory[2].by).to.equal(u.manager.id);
    });

    it('a manager cancelling an unpaid order puts the stock back too', async () => {
      expect((await setStatus(t.manager, order.id, 'cancelled', 'Customer called')).status).to.equal(200);
      expect(await stockOf(p.coffee)).to.equal(10);
    });

    it('a paid order cannot be cancelled (that will be a refund), and its stock stays taken', async () => {
      await setStatus(t.admin, order.id, 'paid');
      expect((await setStatus(t.ann, order.id, 'cancelled')).status).to.equal(409);
      expect((await setStatus(t.admin, order.id, 'cancelled')).status).to.equal(409);
      expect(await stockOf(p.coffee)).to.equal(8);
    });

    it('finished and cancelled orders do not move any more', async () => {
      await setStatus(t.ann, order.id, 'cancelled');
      for (const status of ['paid', 'shipped', 'completed', 'pending_payment']) {
        expect((await setStatus(t.admin, order.id, status)).status, status).to.equal(409);
      }
    });

    it('400 for an unknown status or an empty body; 401 without a token', async () => {
      expect((await setStatus(t.admin, order.id, 'lost')).status).to.equal(400);
      expect((await api('patch', `/api/v1/orders/${order.id}`, t.admin).send({})).status).to.equal(400);
      expect((await setStatus(null, order.id, 'cancelled')).status).to.equal(401);
    });
  });

  describe('orders nobody pays for', () => {
    const backdate = (id, minutes) =>
      OrderCollection.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { createdAt: new Date(Date.now() - minutes * 60_000) } },
      );

    it('are cancelled after the time in settings, and the stock goes back', async () => {
      const old = (await place()).body;
      const fresh = (await place()).body;
      await backdate(old.id, 61);
      expect(await stockOf(p.coffee)).to.equal(6);

      expect(await Order.cancelExpired()).to.equal(1);

      const cancelled = (await api('get', `/api/v1/orders/${old.id}`, t.ann)).body;
      expect(cancelled.status).to.equal('cancelled');
      expect(cancelled.statusHistory.at(-1)).to.include({ status: 'cancelled', note: settings.message('orderExpired') });
      expect(cancelled.statusHistory.at(-1)).to.not.have.property('by'); // the system did it
      expect((await api('get', `/api/v1/orders/${fresh.id}`, t.ann)).body.status).to.equal('pending_payment');
      expect(await stockOf(p.coffee)).to.equal(8);
    });

    it('a paid order is never expired, however old', async () => {
      const paid = (await place()).body;
      await setStatus(t.admin, paid.id, 'paid');
      await backdate(paid.id, 10_000);
      expect(await Order.cancelExpired()).to.equal(0);
      expect((await OrderCollection.findById(paid.id)).status).to.equal('paid');
    });

    it('the waiting time comes from settings', async () => {
      const order = (await place()).body;
      await backdate(order.id, 61);
      await settings.update({ orders: { unpaidExpireMinutes: 120 } });
      expect(await Order.cancelExpired()).to.equal(0);
      await settings.update({ orders: { unpaidExpireMinutes: 30 } });
      expect(await Order.cancelExpired()).to.equal(1);
    });

    it('running it twice does no harm', async () => {
      const order = (await place()).body;
      await backdate(order.id, 61);
      expect(await Order.cancelExpired()).to.equal(1);
      expect(await Order.cancelExpired()).to.equal(0);
      expect(await stockOf(p.coffee)).to.equal(10);
    });
  });

  it('orders are never deleted', async () => {
    const { body } = await place();
    const order = await Order.findById(body.id);
    const err = await order.delete().catch((e) => e);
    expect(err.message).to.include('never deleted');
    expect(await OrderCollection.countDocuments()).to.equal(1);
  });
});
