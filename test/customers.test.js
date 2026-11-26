import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AddressCollection } from '../src/modules/addresses/schema.js';
import { Address } from '../src/modules/addresses/model.js';
import { CounterCollection } from '../src/modules/counters/schema.js';
import { OrderCollection } from '../src/modules/orders/schema.js';
import { Order } from '../src/modules/orders/model.js';
import { ProductCollection } from '../src/modules/products/schema.js';
import { Product } from '../src/modules/products/model.js';
import { SessionCollection } from '../src/modules/sessions/schema.js';
import { ShippingMethodCollection } from '../src/modules/shipping/schema.js';
import { ShippingMethod } from '../src/modules/shipping/model.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';
const MISSING_ID = '507f1f77bcf86cd799439011';

const api = (path, token) => {
  const req = request(app).get(path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('customers (CRM)', () => {
  const t = {};
  const u = {};
  const placed = {};

  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), OrderCollection.init(), ProductCollection.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    for (const [name, role] of [['admin', 'admin'], ['manager', 'manager'], ['ann', 'customer'], ['bob', 'customer'], ['cara', 'customer']]) {
      const email = `${name}@example.com`;
      u[name] = await new User({ email, name: name[0].toUpperCase() + name.slice(1), password: PASSWORD, role }).create();
      t[name] = (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;
      await sleep(5); // distinct createdAt, for "newest first"
    }

    const coffee = await new Product({ name: 'Ethiopia', category: 'coffee', priceCents: 1000, stock: 100 }).create();
    const shipping = await new ShippingMethod({ name: 'Standard', priceCents: 500, countries: ['UA'] }).create();
    const addressOf = async (user) =>
      new Address({ name: user.name, phone: '+380 67 123 45 67', line1: '1 Main St', city: 'Kyiv', postalCode: '01001', country: 'UA' }).create({ actor: user });
    const place = async (user, quantity) => {
      const address = await addressOf(user);
      return new Order({ items: [{ product: coffee.id, quantity }], addressId: address.id, shippingMethodId: shipping.id }).create({ actor: user });
    };

    // Ann: three orders, $105 completed path + $25 paid + $15 left unpaid. Spent = 105 + 25 = 130.
    placed.annBig = await place(u.ann, 10); // 10000 + 500
    await placed.annBig.update({ status: 'paid' }, { actor: u.admin });
    await placed.annBig.update({ status: 'shipped' }, { actor: u.admin });
    placed.annMid = await place(u.ann, 2); // 2000 + 500
    await placed.annMid.update({ status: 'paid' }, { actor: u.admin });
    await sleep(5);
    placed.annLast = await place(u.ann, 1); // 1000 + 500, unpaid

    // Bob: one cancelled order. Spent = 0, but he did order.
    placed.bob = await place(u.bob, 3);
    await placed.bob.update({ status: 'cancelled' }, { actor: u.bob });

    // Cara: never ordered.
  });
  afterEach(() =>
    Promise.all(
      [UserCollection, SessionCollection, AddressCollection, OrderCollection, ProductCollection, ShippingMethodCollection, CounterCollection].map(
        (c) => c.deleteMany({}),
      ),
    ),
  );

  const byName = (res) => Object.fromEntries(res.body.items.map((c) => [c.name, c]));

  describe('GET /api/v1/customers', () => {
    it('lists customers only (no staff), newest first, with their order stats', async () => {
      const res = await api('/api/v1/customers', t.manager);
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ total: 3, page: 1 });
      expect(res.body.items.map((c) => c.name)).to.deep.equal(['Cara', 'Bob', 'Ann']);

      const { Ann, Bob, Cara } = byName(res);
      expect(Ann.stats).to.include({ orders: 3, spentCents: 13000 });
      expect(new Date(Ann.stats.lastOrderAt).getTime()).to.equal(new Date(placed.annLast.createdAt).getTime());
      expect(Bob.stats).to.include({ orders: 1, spentCents: 0 }); // a cancelled order is not money spent
      expect(Cara.stats).to.deep.equal({ orders: 0, spentCents: 0, lastOrderAt: null });
    });

    it('gives each customer as the CRM needs it: id, no password hash, no role noise', async () => {
      const [first] = (await api('/api/v1/customers', t.manager)).body.items;
      expect(first.id).to.be.a('string');
      expect(first).to.have.all.keys('id', 'email', 'name', 'createdAt', 'stats');
      expect(first).to.not.have.any.keys('_id', 'passwordHash', '__v');
    });

    it('sorts by money spent, number of orders, last order and name', async () => {
      const names = async (sort) => (await api(`/api/v1/customers?sort=${sort}`, t.manager)).body.items.map((c) => c.name);
      expect((await names('spent'))[0]).to.equal('Ann');
      expect(await names('orders')).to.deep.equal(['Ann', 'Bob', 'Cara']);
      expect((await names('last_order'))[2]).to.equal('Cara'); // never ordered: last
      expect(await names('name')).to.deep.equal(['Ann', 'Bob', 'Cara']);
      expect((await api('/api/v1/customers?sort=random', t.manager)).status).to.equal(400);
    });

    it('sorting happens before paging, so page 2 continues the same order', async () => {
      const page1 = (await api('/api/v1/customers?sort=orders&limit=2', t.manager)).body;
      const page2 = (await api('/api/v1/customers?sort=orders&limit=2&page=2', t.manager)).body;
      expect(page1).to.include({ total: 3, pages: 2 });
      expect([...page1.items, ...page2.items].map((c) => c.name)).to.deep.equal(['Ann', 'Bob', 'Cara']);
    });

    it('searches by name or email, as plain text', async () => {
      expect((await api('/api/v1/customers?q=BOB', t.manager)).body.items.map((c) => c.name)).to.deep.equal(['Bob']);
      expect((await api('/api/v1/customers?q=cara@example', t.manager)).body.total).to.equal(1);
      expect((await api('/api/v1/customers?q=a.n', t.manager)).body.total).to.equal(0); // "." is not "any letter"
      expect((await api('/api/v1/customers?q=admin', t.manager)).body.total).to.equal(0); // staff are not customers
    });

    it('a wiped account is left out of the list', async () => {
      await request(app).delete(`/api/v1/users/${u.ann.id}`).set('Authorization', `Bearer ${t.admin}`);
      const res = await api('/api/v1/customers', t.manager);
      expect(res.body.items.map((c) => c.name)).to.not.include('Ann');
      expect(res.body.total).to.equal(2);
    });

    it('staff only: a customer gets 403, a guest 401', async () => {
      expect((await api('/api/v1/customers', t.admin)).status).to.equal(200);
      expect((await api('/api/v1/customers', t.ann)).status).to.equal(403);
      expect((await api('/api/v1/customers')).status).to.equal(401);
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('the card: profile, the same stats as the list, recent orders and addresses', async () => {
      const res = await api(`/api/v1/customers/${u.ann.id}`, t.manager);
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ id: u.ann.id, email: 'ann@example.com', name: 'Ann', role: 'customer' });
      expect(res.body).to.not.have.property('passwordHash');
      expect(res.body.stats).to.include({ orders: 3, spentCents: 13000 });

      expect(res.body.recentOrders.map((o) => o.number)).to.deep.equal([placed.annLast.number, placed.annMid.number, placed.annBig.number]);
      expect(res.body.addresses).to.have.length(3);
      expect(res.body.addresses.every((a) => a.user === u.ann.id)).to.equal(true);

      const fromList = byName(await api('/api/v1/customers', t.manager)).Ann.stats;
      expect(res.body.stats).to.deep.equal(fromList);
    });

    it('a customer without orders has zero stats and empty lists', async () => {
      const res = await api(`/api/v1/customers/${u.cara.id}`, t.manager);
      expect(res.body.stats).to.deep.equal({ orders: 0, spentCents: 0, lastOrderAt: null });
      expect(res.body.recentOrders).to.deep.equal([]);
      expect(res.body.addresses).to.deep.equal([]);
    });

    it('staff and unknown ids are a 404 here; a malformed id is a 400', async () => {
      expect((await api(`/api/v1/customers/${u.manager.id}`, t.manager)).status).to.equal(404);
      expect((await api(`/api/v1/customers/${MISSING_ID}`, t.manager)).status).to.equal(404);
      expect((await api('/api/v1/customers/not-an-id', t.manager)).status).to.equal(400);
    });

    it('a wiped account still opens, so the history behind its orders can be seen', async () => {
      await request(app).delete(`/api/v1/users/${u.ann.id}`).set('Authorization', `Bearer ${t.admin}`);
      const res = await api(`/api/v1/customers/${u.ann.id}`, t.manager);
      expect(res.status).to.equal(200);
      expect(res.body.email).to.match(/@deleted\.invalid$/);
      expect(res.body.stats.orders).to.equal(3);
      expect(res.body.addresses).to.deep.equal([]); // deleted with the account
    });

    it('staff only', async () => {
      expect((await api(`/api/v1/customers/${u.ann.id}`, t.ann)).status).to.equal(403);
      expect((await api(`/api/v1/customers/${u.ann.id}`)).status).to.equal(401);
    });
  });
});
