import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Product as ProductCollection, Session as SessionCollection, User as UserCollection } from '../src/db.js';
import { Product, slugify } from '../src/modules/products/model.js';
import { settings } from '../src/modules/settings/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';

const api = (method, path, token) => {
  const req = request(app)[method](path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const names = (res) => res.body.items.map((item) => item.name);

const shelf = [
  { name: 'Ethiopia Yirgacheffe', category: 'coffee', priceCents: 1450, stock: 40, description: 'Floral and light.' },
  { name: 'House Blend', category: 'coffee', priceCents: 1100, stock: 80, description: 'Notes of chocolate, a little Ethiopia in it.' },
  { name: 'Earl Grey', category: 'tea', priceCents: 900, stock: 0, description: 'Black tea with bergamot.' },
  { name: 'Hand Grinder', category: 'equipment', priceCents: 5900, stock: 12, description: 'Steel burrs.' },
  { name: 'Kenya AA', category: 'coffee', priceCents: 1600, stock: 5, active: false, description: 'Seasonal.' },
];

describe('products', () => {
  const t = {};

  before(async () => {
    await startDb();
    await Promise.all([ProductCollection.init(), UserCollection.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    for (const [name, role] of [['manager', 'manager'], ['ann', 'customer']]) {
      const email = `${name}@example.com`;
      await new User({ email, name, password: PASSWORD, role }).create();
      const res = await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD });
      t[name] = res.body.accessToken;
    }
    for (const data of shelf) await new Product(data).create();
  });
  afterEach(() => Promise.all([ProductCollection, UserCollection, SessionCollection].map((c) => c.deleteMany({}))));

  describe('GET /api/v1/products', () => {
    it('is public and shows only products on sale, newest first', async () => {
      const res = await api('get', '/api/v1/products');
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ page: 1, limit: 20, total: 4, pages: 1 });
      expect(names(res)).to.deep.equal(['Hand Grinder', 'Earl Grey', 'House Blend', 'Ethiopia Yirgacheffe']);
    });

    it('gives each product as the shop needs it: id, slug, cents, no internals', async () => {
      const [first] = (await api('get', '/api/v1/products?sort=price_asc')).body.items;
      expect(first).to.include({ name: 'Earl Grey', slug: 'earl-grey', category: 'tea', priceCents: 900, currency: 'usd', stock: 0, active: true });
      expect(first.id).to.be.a('string');
      expect(first).to.not.have.any.keys('_id', '__v', 'score');
    });

    it('paginates', async () => {
      const res = await api('get', '/api/v1/products?limit=3&page=2');
      expect(res.body).to.include({ page: 2, limit: 3, total: 4, pages: 2 });
      expect(res.body.items).to.have.length(1);
      expect((await api('get', '/api/v1/products?limit=51')).status).to.equal(400);
    });

    it('filters by category, price range and stock', async () => {
      expect(names(await api('get', '/api/v1/products?category=coffee'))).to.have.members(['Ethiopia Yirgacheffe', 'House Blend']);
      expect(names(await api('get', '/api/v1/products?minPriceCents=1000&maxPriceCents=2000'))).to.have.members(['Ethiopia Yirgacheffe', 'House Blend']);
      expect(names(await api('get', '/api/v1/products?inStock=true'))).to.not.include('Earl Grey');
      expect((await api('get', '/api/v1/products?category=cake')).status).to.equal(400);
      expect((await api('get', '/api/v1/products?minPriceCents=2000&maxPriceCents=1000')).status).to.equal(400);
    });

    it('sorts by price and by name', async () => {
      expect(names(await api('get', '/api/v1/products?sort=price_asc'))).to.deep.equal(['Earl Grey', 'House Blend', 'Ethiopia Yirgacheffe', 'Hand Grinder']);
      expect(names(await api('get', '/api/v1/products?sort=price_desc'))[0]).to.equal('Hand Grinder');
      expect(names(await api('get', '/api/v1/products?sort=name'))).to.deep.equal(['Earl Grey', 'Ethiopia Yirgacheffe', 'Hand Grinder', 'House Blend']);
      expect((await api('get', '/api/v1/products?sort=random')).status).to.equal(400);
    });

    it('searches words in the name and description, best match first', async () => {
      // "Ethiopia" is in the name of one product and only in the description of another.
      const res = await api('get', '/api/v1/products?q=ethiopia');
      expect(names(res)).to.deep.equal(['Ethiopia Yirgacheffe', 'House Blend']);
      expect(res.body.items[0]).to.not.have.property('score');
      expect(res.body.total).to.equal(2);
    });

    it('search combines with filters and sorting, and finds nothing for an unknown word', async () => {
      expect(names(await api('get', '/api/v1/products?q=ethiopia&category=tea'))).to.deep.equal([]);
      expect(names(await api('get', '/api/v1/products?q=ethiopia&sort=price_asc'))).to.deep.equal(['House Blend', 'Ethiopia Yirgacheffe']);
      expect((await api('get', '/api/v1/products?q=unicorn')).body.total).to.equal(0);
      expect((await api('get', '/api/v1/products?sort=relevance')).status).to.equal(400); // relevance needs q
    });

    it('treats odd search text as text, not as a query', async () => {
      for (const q of ['$where', '{"$ne":1}', '"unclosed', '-', '(((']) {
        const res = await api('get', `/api/v1/products?q=${encodeURIComponent(q)}`);
        expect(res.status, q).to.equal(200);
      }
    });

    it('hidden products: staff can ask for them, everybody else is quietly refused', async () => {
      expect(names(await api('get', '/api/v1/products?active=false', t.manager))).to.deep.equal(['Kenya AA']);
      expect((await api('get', '/api/v1/products?active=all', t.manager)).body.total).to.equal(5);

      // A customer, a guest and a made-up token header all get the normal list for a customer / guest.
      expect((await api('get', '/api/v1/products?active=all', t.ann)).body.total).to.equal(4);
      expect((await api('get', '/api/v1/products?active=all')).body.total).to.equal(4);
    });

    it('a token that is sent must be good: a broken one is 401, not a guest', async () => {
      expect((await api('get', '/api/v1/products', 'not-a-token')).status).to.equal(401);
    });
  });

  describe('GET /api/v1/products/:slug', () => {
    it('is public', async () => {
      const res = await api('get', '/api/v1/products/ethiopia-yirgacheffe');
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: 'Ethiopia Yirgacheffe', priceCents: 1450 });
    });

    it('404 for an unknown slug, and for a hidden product unless you are staff', async () => {
      expect((await api('get', '/api/v1/products/nothing-here')).status).to.equal(404);
      expect((await api('get', '/api/v1/products/kenya-aa')).status).to.equal(404);
      expect((await api('get', '/api/v1/products/kenya-aa', t.ann)).status).to.equal(404);
      expect((await api('get', '/api/v1/products/kenya-aa', t.manager)).body.active).to.equal(false);
    });

    it('does not care about letter case in the URL', async () => {
      expect((await api('get', '/api/v1/products/Earl-Grey')).status).to.equal(200);
    });
  });

  describe('POST /api/v1/products', () => {
    const body = { name: 'Rwanda Bourbon', category: 'coffee', priceCents: 1500, stock: 10 };
    const create = (data, token = t.manager) => api('post', '/api/v1/products', token).send(data);

    it('a manager creates a product; the slug is made from the name', async () => {
      const res = await create(body);
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ name: 'Rwanda Bourbon', slug: 'rwanda-bourbon', active: true, currency: 'usd' });
      expect((await api('get', '/api/v1/products/rwanda-bourbon')).status).to.equal(200);
    });

    it('takes a slug that was sent, and drops fields it does not know', async () => {
      const res = await create({ ...body, slug: 'rwanda', createdAt: '2001-01-01', currency: 'eur', _id: '507f1f77bcf86cd799439011' });
      expect(res.body.slug).to.equal('rwanda');
      expect(res.body.currency).to.equal('usd');
      expect(res.body.createdAt).to.not.equal('2001-01-01T00:00:00.000Z');
      expect(res.body.id).to.not.equal('507f1f77bcf86cd799439011');
    });

    it('409 for a slug that is taken', async () => {
      const res = await create({ ...body, name: 'Another', slug: 'earl-grey' });
      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal('duplicate');
    });

    it('400 when the slug cannot be made from the name', async () => {
      const res = await create({ ...body, name: 'Ефіопія' });
      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal(settings.message('slugNeeded'));
      expect((await create({ ...body, name: 'Ефіопія', slug: 'ethiopia-ua' })).status).to.equal(201);
    });

    it('400 for bad values: price in fractions, negative stock, unknown category, http image, bad slug', async () => {
      const bad = [
        { priceCents: 14.5 },
        { priceCents: -1 },
        { stock: -1 },
        { stock: 1.5 },
        { category: 'cake' },
        { imageUrl: 'http://example.com/a.jpg' },
        { imageUrl: 'javascript:alert(1)' },
        { slug: 'Not A Slug' },
        { name: '' },
        { priceCents: '1500' },
      ];
      for (const change of bad) {
        const res = await create({ ...body, ...change });
        expect(res.status, JSON.stringify(change)).to.equal(400);
      }
    });

    it('only staff may: a customer gets 403, a guest 401', async () => {
      expect((await create(body, t.ann)).status).to.equal(403);
      expect((await create(body, null)).status).to.equal(401); // null = a guest; undefined would mean the default, the manager
      expect(await ProductCollection.countDocuments()).to.equal(shelf.length);
    });
  });

  describe('PATCH and DELETE /api/v1/products/:id', () => {
    let id;
    beforeEach(async () => {
      id = (await ProductCollection.findOne({ slug: 'earl-grey' }))._id.toString();
    });
    const patch = (data, token = t.manager, path = `/api/v1/products/${id}`) => api('patch', path, token).send(data);

    it('changes the price and stock and leaves the rest as it was', async () => {
      const res = await patch({ priceCents: 950, stock: 25 });
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: 'Earl Grey', priceCents: 950, stock: 25, category: 'tea' });
      expect((await api('get', '/api/v1/products/earl-grey')).body.priceCents).to.equal(950);
    });

    it('400 for an empty body or bad values; 404 for an unknown id; 400 for a malformed id', async () => {
      expect((await patch({})).status).to.equal(400);
      expect((await patch({ priceCents: 9.99 })).status).to.equal(400);
      expect((await patch({ priceCents: 100 }, t.manager, '/api/v1/products/507f1f77bcf86cd799439011')).status).to.equal(404);
      expect((await patch({ priceCents: 100 }, t.manager, '/api/v1/products/not-an-id')).status).to.equal(400);
    });

    it('only staff may', async () => {
      expect((await patch({ priceCents: 1 }, t.ann)).status).to.equal(403);
      expect((await patch({ priceCents: 1 }, null)).status).to.equal(401);
      expect((await api('delete', `/api/v1/products/${id}`, t.ann)).status).to.equal(403);
    });

    it('DELETE hides the product instead of deleting it; PATCH active:true puts it back', async () => {
      expect((await api('delete', `/api/v1/products/${id}`, t.manager)).status).to.equal(204);

      expect((await api('get', '/api/v1/products/earl-grey')).status).to.equal(404);
      expect(names(await api('get', '/api/v1/products'))).to.not.include('Earl Grey');
      expect((await api('get', '/api/v1/products/earl-grey', t.manager)).body.active).to.equal(false);
      expect(await ProductCollection.countDocuments({ slug: 'earl-grey' })).to.equal(1); // still in the database

      expect((await patch({ active: true })).body.active).to.equal(true);
      expect((await api('get', '/api/v1/products/earl-grey')).status).to.equal(200);
    });

    it('DELETE on an unknown id is 404, and deleting twice is fine', async () => {
      expect((await api('delete', '/api/v1/products/507f1f77bcf86cd799439011', t.manager)).status).to.equal(404);
      await api('delete', `/api/v1/products/${id}`, t.manager);
      expect((await api('delete', `/api/v1/products/${id}`, t.manager)).status).to.equal(204);
    });
  });

  describe('slugify', () => {
    it('makes URL-safe slugs', () => {
      expect(slugify('Ethiopia Yirgacheffé')).to.equal('ethiopia-yirgacheffe');
      expect(slugify('  Pour-Over   Dripper (ceramic)! ')).to.equal('pour-over-dripper-ceramic');
      expect(slugify('Ефіопія')).to.equal('');
    });
  });
});
