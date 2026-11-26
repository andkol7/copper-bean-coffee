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
import { settings } from '../src/modules/settings/model.js';
import { ShippingMethodCollection } from '../src/modules/shipping/schema.js';
import { ShippingMethod } from '../src/modules/shipping/model.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';

const api = (method, path, token) => {
  const req = request(app)[method](path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const logIn = (email, password = PASSWORD) => request(app).post('/api/v1/auth/sessions').send({ email, password });

describe('deleting a user', () => {
  const t = {};
  const u = {};
  let annAddress;
  let order;

  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), OrderCollection.init(), ProductCollection.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    for (const [name, role] of [['admin', 'admin'], ['ann', 'customer'], ['bob', 'customer']]) {
      const email = `${name}@example.com`;
      u[name] = await new User({ email, name, phone: '+380 67 123 45 67', password: PASSWORD, role }).create();
      t[name] = (await logIn(email)).body;
    }

    // Ann has bought something; Bob has only saved an address.
    const coffee = await new Product({ name: 'Ethiopia', category: 'coffee', priceCents: 1450, stock: 10 }).create();
    const shipping = await new ShippingMethod({ name: 'Standard', priceCents: 499, countries: ['UA'] }).create();
    const home = { name: 'Ann Smith', phone: '+380 67 123 45 67', line1: '12 Khreshchatyk St', city: 'Kyiv', postalCode: '01001', country: 'UA' };
    annAddress = await new Address(home).create({ actor: u.ann });
    await new Address({ ...home, name: 'Bob' }).create({ actor: u.bob });
    order = await new Order({
      items: [{ product: coffee.id, quantity: 1 }],
      addressId: annAddress.id,
      shippingMethodId: shipping.id,
    }).create({ actor: u.ann });
  });
  afterEach(() =>
    Promise.all(
      [UserCollection, SessionCollection, AddressCollection, OrderCollection, ProductCollection, ShippingMethodCollection, CounterCollection].map(
        (c) => c.deleteMany({}),
      ),
    ),
  );

  const remove = (user) => api('delete', `/api/v1/users/${user.id}`, t.admin.accessToken);

  describe('without history (no orders)', () => {
    it('is deleted completely, with addresses and logins', async () => {
      expect((await remove(u.bob)).status).to.equal(204);
      expect(await UserCollection.countDocuments({ _id: u.bob.id })).to.equal(0);
      expect(await AddressCollection.countDocuments({ user: u.bob.id })).to.equal(0);
      expect(await SessionCollection.countDocuments({ user: u.bob.id })).to.equal(0);
      expect((await api('get', `/api/v1/users/${u.bob.id}`, t.admin.accessToken)).status).to.equal(404);
    });
  });

  describe('with history (orders)', () => {
    it('the record stays, but nothing personal is left in it', async () => {
      expect((await remove(u.ann)).status).to.equal(204);

      const wiped = await UserCollection.findById(u.ann.id).select('+passwordHash').lean();
      expect(wiped.name).to.equal(settings.message('deletedUserName'));
      expect(wiped.email).to.equal(`deleted-${u.ann.id}@deleted.invalid`);
      expect(wiped).to.not.have.property('phone');
      expect(wiped.deletedAt).to.be.an.instanceOf(Date);
      expect(JSON.stringify(wiped)).to.not.include('ann@example.com').and.not.include('+380');
    });

    it('the orders still point at their customer and keep their own copy of the address', async () => {
      await remove(u.ann);
      const kept = await OrderCollection.findById(order.id).lean();
      expect(String(kept.customer)).to.equal(u.ann.id);
      expect(kept.shippingAddress).to.include({ name: 'Ann Smith', city: 'Kyiv' });
      expect((await api('get', `/api/v1/orders/${order.id}`, t.admin.accessToken)).status).to.equal(200);
    });

    it('the saved addresses and every login are gone', async () => {
      await remove(u.ann);
      expect(await AddressCollection.countDocuments({ user: u.ann.id })).to.equal(0);
      expect(await SessionCollection.countDocuments({ user: u.ann.id })).to.equal(0);
      const refresh = await request(app).post('/api/v1/auth/sessions').send({ refreshToken: t.ann.refreshToken });
      expect(refresh.status).to.equal(401);
    });

    it('nobody can act as the account: the old token, the old password and the new email all fail', async () => {
      await remove(u.ann);
      expect((await api('get', '/api/v1/users/me', t.ann.accessToken)).status).to.equal(401); // token issued before
      expect((await logIn('ann@example.com')).status).to.equal(401);
      expect((await logIn(`deleted-${u.ann.id}@deleted.invalid`, PASSWORD)).status).to.equal(401);
    });

    it('the email is free again: the person can register anew, as a new account', async () => {
      await remove(u.ann);
      const again = await request(app).post('/api/v1/users').send({ email: 'ann@example.com', name: 'Ann', password: 'a new password' });
      expect(again.status).to.equal(201);
      expect(again.body.id).to.not.equal(u.ann.id);
      expect((await api('get', '/api/v1/orders', (await logIn('ann@example.com', 'a new password')).body.accessToken)).body.total).to.equal(0);
    });

    it('is left out of the admin list, cannot be edited, and deleting again is harmless', async () => {
      await remove(u.ann);
      const list = await api('get', '/api/v1/users', t.admin.accessToken);
      expect(list.body.items.map((user) => user.id)).to.not.include(u.ann.id);

      expect((await api('patch', `/api/v1/users/${u.ann.id}`, t.admin.accessToken).send({ name: 'Back' })).status).to.equal(404);
      expect((await remove(u.ann)).status).to.equal(204);
    });
  });

  it('an admin still cannot delete themselves', async () => {
    expect((await remove(u.admin)).status).to.equal(403);
    expect(await UserCollection.countDocuments({ _id: u.admin.id })).to.equal(1);
  });
});
