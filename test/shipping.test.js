import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { SessionCollection } from '../src/modules/sessions/schema.js';
import { ShippingMethodCollection as ShippingCollection } from '../src/modules/shipping/schema.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { ShippingMethod } from '../src/modules/shipping/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';

const api = (method, path, token) => {
  const req = request(app)[method](path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const names = (res) => res.body.items.map((m) => m.name);

const methods = [
  { name: 'Standard', priceCents: 499, freeOverCents: 5000, countries: ['UA'] },
  { name: 'Express', priceCents: 1499, countries: ['UA'] },
  { name: 'International', priceCents: 2499, countries: ['US', 'DE'] },
  { name: 'Anywhere', priceCents: 3999 }, // no countries: delivers everywhere
  { name: 'Old courier', priceCents: 300, active: false },
];

describe('shipping methods', () => {
  const t = {};

  before(async () => {
    await startDb();
    await Promise.all([ShippingCollection.init(), UserCollection.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    for (const [name, role] of [['manager', 'manager'], ['ann', 'customer']]) {
      const email = `${name}@example.com`;
      await new User({ email, name, password: PASSWORD, role }).create();
      t[name] = (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;
    }
    for (const data of methods) await new ShippingMethod(data).create();
  });
  afterEach(() => Promise.all([ShippingCollection, UserCollection, SessionCollection].map((c) => c.deleteMany({}))));

  describe('GET /api/v1/shipping-methods', () => {
    it('is public: the methods on offer, cheapest first', async () => {
      const res = await api('get', '/api/v1/shipping-methods');
      expect(res.status).to.equal(200);
      expect(names(res)).to.deep.equal(['Standard', 'Express', 'International', 'Anywhere']);
      expect(res.body.items[0]).to.include({ priceCents: 499, freeOverCents: 5000 });
      expect(res.body.items[0].id).to.be.a('string');
    });

    it('?country= keeps the ones that deliver there and the ones that deliver everywhere', async () => {
      expect(names(await api('get', '/api/v1/shipping-methods?country=UA'))).to.deep.equal(['Standard', 'Express', 'Anywhere']);
      expect(names(await api('get', '/api/v1/shipping-methods?country=de'))).to.deep.equal(['International', 'Anywhere']);
      expect(names(await api('get', '/api/v1/shipping-methods?country=JP'))).to.deep.equal(['Anywhere']);
      expect((await api('get', '/api/v1/shipping-methods?country=Ukraine')).status).to.equal(400);
    });

    it('hidden methods: staff can ask for them, everybody else is quietly refused', async () => {
      expect(names(await api('get', '/api/v1/shipping-methods?active=false', t.manager))).to.deep.equal(['Old courier']);
      expect((await api('get', '/api/v1/shipping-methods?active=all', t.manager)).body.total).to.equal(5);
      expect((await api('get', '/api/v1/shipping-methods?active=all', t.ann)).body.total).to.equal(4);
      expect((await api('get', '/api/v1/shipping-methods?active=all')).body.total).to.equal(4);
      expect((await api('get', '/api/v1/shipping-methods', 'not-a-token')).status).to.equal(401);
    });
  });

  describe('POST /api/v1/shipping-methods', () => {
    const body = { name: 'Pigeon post', description: 'Slow but charming', priceCents: 100, countries: ['ua', 'UA', 'pl'] };
    const create = (data, token = t.manager) => api('post', '/api/v1/shipping-methods', token).send(data);

    it('a manager creates one; country codes are tidied up', async () => {
      const res = await create(body);
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ name: 'Pigeon post', priceCents: 100, active: true });
      expect(res.body.countries).to.deep.equal(['UA', 'PL']);
    });

    it('400 for bad values', async () => {
      const bad = [
        { name: '' },
        { priceCents: -1 },
        { priceCents: 4.99 },
        { priceCents: '499' },
        { freeOverCents: 12.5 },
        { countries: ['Ukraine'] },
        { countries: 'UA' },
      ];
      for (const change of bad) expect((await create({ ...body, ...change })).status, JSON.stringify(change)).to.equal(400);
    });

    it('only staff may: a customer gets 403, a guest 401', async () => {
      expect((await create(body, t.ann)).status).to.equal(403);
      expect((await create(body, null)).status).to.equal(401);
      expect(await ShippingCollection.countDocuments()).to.equal(methods.length);
    });
  });

  describe('PATCH and DELETE /api/v1/shipping-methods/:id', () => {
    let id;
    beforeEach(async () => {
      id = (await ShippingCollection.findOne({ name: 'Standard' }))._id.toString();
    });
    const patch = (data, token = t.manager) => api('patch', `/api/v1/shipping-methods/${id}`, token).send(data);

    it('changes the price, leaves the rest', async () => {
      const res = await patch({ priceCents: 599 });
      expect(res.body).to.include({ name: 'Standard', priceCents: 599, freeOverCents: 5000 });
    });

    it('null removes the free-delivery threshold', async () => {
      const res = await patch({ freeOverCents: null });
      expect(res.status).to.equal(200);
      expect((await ShippingMethod.findById(id)).costFor(1_000_000)).to.equal(499);
    });

    it('400 for an empty body or bad values; 404 for an unknown id; only staff may', async () => {
      expect((await patch({})).status).to.equal(400);
      expect((await patch({ priceCents: 1.5 })).status).to.equal(400);
      expect((await api('patch', '/api/v1/shipping-methods/507f1f77bcf86cd799439011', t.manager).send({ priceCents: 1 })).status).to.equal(404);
      expect((await patch({ priceCents: 1 }, t.ann)).status).to.equal(403);
      expect((await patch({ priceCents: 1 }, null)).status).to.equal(401);
    });

    it('DELETE hides it instead of deleting it, and PATCH active:true brings it back', async () => {
      expect((await api('delete', `/api/v1/shipping-methods/${id}`, t.manager)).status).to.equal(204);
      expect(names(await api('get', '/api/v1/shipping-methods'))).to.not.include('Standard');
      expect(await ShippingCollection.countDocuments({ _id: id })).to.equal(1);

      await patch({ active: true });
      expect(names(await api('get', '/api/v1/shipping-methods'))).to.include('Standard');
      expect((await api('delete', `/api/v1/shipping-methods/${id}`, t.ann)).status).to.equal(403);
    });
  });

  describe('the rules the order will use', () => {
    it('costFor: free from the threshold up, never free without one', async () => {
      const standard = await ShippingMethod.findOne({ name: 'Standard' });
      expect(standard.costFor(4999)).to.equal(499);
      expect(standard.costFor(5000)).to.equal(0); // exactly the threshold counts
      expect(standard.costFor(9000)).to.equal(0);

      const express = await ShippingMethod.findOne({ name: 'Express' });
      expect(express.costFor(1_000_000)).to.equal(1499);
    });

    it('servesCountry: listed countries, any case; a method with none delivers everywhere', async () => {
      const international = await ShippingMethod.findOne({ name: 'International' });
      expect(international.servesCountry('us')).to.equal(true);
      expect(international.servesCountry('UA')).to.equal(false);

      const anywhere = await ShippingMethod.findOne({ name: 'Anywhere' });
      expect(anywhere.servesCountry('JP')).to.equal(true);
    });
  });
});
