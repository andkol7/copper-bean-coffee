import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AddressCollection } from '../src/modules/addresses/schema.js';
import { SessionCollection } from '../src/modules/sessions/schema.js';
import { SettingCollection as Setting } from '../src/modules/settings/schema.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { Address } from '../src/modules/addresses/model.js';
import { settings } from '../src/modules/settings/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';

const api = (method, path, token) => {
  const req = request(app)[method](path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

const home = {
  label: 'Home',
  name: 'Ann Smith',
  phone: '+380 67 123 45 67',
  line1: '12 Khreshchatyk St',
  city: 'Kyiv',
  postalCode: '01001',
  country: 'ua',
};

describe('addresses', () => {
  const t = {}; // access tokens by name
  const u = {}; // users by name

  before(async () => {
    await startDb();
    await Promise.all([AddressCollection.init(), UserCollection.init(), Setting.init()]);
  });
  after(async () => {
    await settings.reset();
    await stopDb();
  });

  beforeEach(async () => {
    for (const [name, role] of [['ann', 'customer'], ['bob', 'customer'], ['manager', 'manager']]) {
      const email = `${name}@example.com`;
      u[name] = await new User({ email, name, password: PASSWORD, role }).create();
      t[name] = (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;
    }
  });
  afterEach(async () => {
    await Promise.all([AddressCollection, UserCollection, SessionCollection].map((c) => c.deleteMany({})));
    await settings.reset();
  });

  const create = (data = home, token = t.ann) => api('post', '/api/v1/addresses', token).send(data);

  describe('POST /api/v1/addresses', () => {
    it('saves an address for the logged-in user, tidied up', async () => {
      const res = await create({ ...home, name: '  Ann Smith  ', country: 'ua' });
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ name: 'Ann Smith', city: 'Kyiv', country: 'UA', user: u.ann.id });
      expect(res.body.id).to.be.a('string');
    });

    it('the owner is always the caller: a user sent in the body is ignored', async () => {
      const res = await create({ ...home, user: u.bob.id });
      expect(res.body.user).to.equal(u.ann.id);
      expect(await AddressCollection.countDocuments({ user: u.bob.id })).to.equal(0);
    });

    it('works for staff too, as their own address', async () => {
      expect((await create(home, t.manager)).body.user).to.equal(u.manager.id);
    });

    it('400 for missing or bad values', async () => {
      const { line1, ...withoutLine1 } = home;
      const bad = [
        withoutLine1,
        { ...home, phone: 'call me' },
        { ...home, country: 'Ukraine' },
        { ...home, country: 'U1' },
        { ...home, postalCode: '' },
        { ...home, name: 'x'.repeat(101) },
        {},
      ];
      for (const body of bad) expect((await create(body)).status, JSON.stringify(body).slice(0, 60)).to.equal(400);
      expect(await AddressCollection.countDocuments()).to.equal(0);
    });

    it('401 without a token', async () => {
      expect((await create(home, null)).status).to.equal(401);
    });

    it('stops at the limit from settings, per user, and a delete frees a place', async () => {
      await settings.update({ addresses: { maxPerUser: 2 } });
      await create();
      const second = await create();
      expect((await create()).status).to.equal(409);
      expect((await create()).body.error.message).to.equal(settings.message('addressLimit', { max: 2 }));
      expect((await create(home, t.bob)).status).to.equal(201); // another user is not affected

      await api('delete', `/api/v1/addresses/${second.body.id}`, t.ann);
      expect((await create()).status).to.equal(201);
    });
  });

  describe('reading, changing and deleting', () => {
    let annAddress;
    let bobAddress;
    beforeEach(async () => {
      annAddress = (await create()).body;
      bobAddress = (await create({ ...home, name: 'Bob', city: 'Lviv' }, t.bob)).body;
    });

    it('the list holds only your own addresses, newest first, paginated', async () => {
      await create({ ...home, label: 'Work' });
      const res = await api('get', '/api/v1/addresses', t.ann);
      expect(res.body).to.include({ total: 2, page: 1 });
      expect(res.body.items.map((a) => a.label)).to.deep.equal(['Work', 'Home']);
      expect(res.body.items.every((a) => a.user === u.ann.id)).to.equal(true);

      expect((await api('get', '/api/v1/addresses?limit=1&page=2', t.ann)).body.items).to.have.length(1);
      expect((await api('get', '/api/v1/addresses', t.manager)).body.total).to.equal(0); // staff see only their own here too
      expect((await api('get', '/api/v1/addresses')).status).to.equal(401);
    });

    it('GET one: yours is 200; somebody else\'s is 404, as if it did not exist', async () => {
      expect((await api('get', `/api/v1/addresses/${annAddress.id}`, t.ann)).body.city).to.equal('Kyiv');
      expect((await api('get', `/api/v1/addresses/${bobAddress.id}`, t.ann)).status).to.equal(404);
      expect((await api('get', `/api/v1/addresses/${bobAddress.id}`, t.manager)).status).to.equal(404);
      expect((await api('get', '/api/v1/addresses/not-an-id', t.ann)).status).to.equal(400);
      expect((await api('get', `/api/v1/addresses/${annAddress.id}`)).status).to.equal(401);
    });

    it('PATCH changes only the given fields, and cannot hand the address to somebody else', async () => {
      const res = await api('patch', `/api/v1/addresses/${annAddress.id}`, t.ann).send({ city: 'Odesa', user: u.bob.id });
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ city: 'Odesa', name: 'Ann Smith', user: u.ann.id });

      expect((await api('patch', `/api/v1/addresses/${annAddress.id}`, t.ann).send({})).status).to.equal(400);
      expect((await api('patch', `/api/v1/addresses/${annAddress.id}`, t.ann).send({ country: 'UKR' })).status).to.equal(400);
    });

    it('PATCH on somebody else\'s address is a 404 and changes nothing', async () => {
      expect((await api('patch', `/api/v1/addresses/${bobAddress.id}`, t.ann).send({ city: 'Hacked' })).status).to.equal(404);
      expect((await AddressCollection.findById(bobAddress.id)).city).to.equal('Lviv');
    });

    it('DELETE removes your address; somebody else\'s stays', async () => {
      expect((await api('delete', `/api/v1/addresses/${bobAddress.id}`, t.ann)).status).to.equal(404);
      expect(await AddressCollection.countDocuments({ _id: bobAddress.id })).to.equal(1);

      expect((await api('delete', `/api/v1/addresses/${annAddress.id}`, t.ann)).status).to.equal(204);
      expect((await api('get', `/api/v1/addresses/${annAddress.id}`, t.ann)).status).to.equal(404);
    });
  });

  it('the model refuses to save an address that has no owner to check against', async () => {
    const err = await new Address(home).create().catch((e) => e);
    expect(err.status).to.equal(401);
  });
});
