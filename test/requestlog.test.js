import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { RequestLogCollection } from '../src/modules/request-logs/schema.js';
import { SessionCollection } from '../src/modules/sessions/schema.js';
import { settings } from '../src/modules/settings/model.js';
import { SettingCollection } from '../src/modules/settings/schema.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const PASSWORD = 'correct horse';

// A broken route, to see how a 500 is logged.
const boom = async () => {
  const err = new Error('the kettle exploded');
  err.where = 'KettleController.boil';
  throw err;
};

describe('request log', () => {
  let app;
  let admin;
  let ann;

  // Entries are written after the answer has gone, so wait until they show up.
  const logs = async (count, filter = {}) => {
    for (let i = 0; i < 50; i++) {
      const found = await RequestLogCollection.find(filter).sort({ at: 1, _id: 1 }).lean();
      if (found.length >= count) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return RequestLogCollection.find(filter).sort({ at: 1, _id: 1 }).lean();
  };
  const tokenFor = async (email) => (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;

  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), RequestLogCollection.init(), SettingCollection.init()]);
    const { routes } = await import('../src/routes.js');
    app = createApp({ requestLogs: true, routes: [...routes, { method: 'get', path: '/api/v1/test/boom', handler: boom }] });
  });
  after(async () => {
    await settings.reset();
    await stopDb();
  });
  beforeEach(async () => {
    admin = await new User({ email: 'admin@example.com', name: 'Admin', password: PASSWORD, role: 'admin' }).create();
    ann = await new User({ email: 'ann@example.com', name: 'Ann', password: PASSWORD }).create();
    await RequestLogCollection.deleteMany({});
  });
  afterEach(async () => {
    await Promise.all([UserCollection, SessionCollection, RequestLogCollection].map((c) => c.deleteMany({})));
    await settings.reset();
  });

  it('logs an API request: method, path, route, query, status, time, user, IP', async () => {
    const token = await tokenFor('ann@example.com');
    await logs(1); // the login's own entry arrives after its answer: wait for it, then clear
    await RequestLogCollection.deleteMany({});
    await request(app).get(`/api/v1/addresses?page=1&limit=5`).set('Authorization', `Bearer ${token}`).set('User-Agent', 'test-agent');

    const [entry] = await logs(1);
    expect(entry).to.include({ method: 'GET', path: '/api/v1/addresses', route: '/api/v1/addresses', status: 200, role: 'customer', userAgent: 'test-agent' });
    expect(entry.query).to.deep.equal({ page: '1', limit: '5' });
    expect(String(entry.user)).to.equal(ann.id);
    expect(entry.ms).to.be.a('number').and.be.at.least(0);
    expect(entry.ip).to.be.a('string');
    expect(entry).to.not.have.property('error');
  });

  it('never keeps a request body: no password, no code, no token', async () => {
    await request(app).post('/api/v1/auth/sessions').send({ email: 'ann@example.com', password: PASSWORD });
    const [entry] = await logs(1);
    expect(entry).to.include({ method: 'POST', status: 201 });
    expect(JSON.stringify(entry)).to.not.include(PASSWORD);
    expect(entry).to.not.have.any.keys('body', 'headers');
  });

  it('logs errors with the code and message the client got', async () => {
    await request(app).post('/api/v1/auth/sessions').send({ email: 'ann@example.com', password: 'wrong' });
    await request(app).get('/api/v1/orders');
    await request(app).get('/api/v1/nowhere');
    const entries = await logs(3);
    expect(entries.map((e) => [e.status, e.error?.code])).to.deep.equal([
      [401, 'unauthorized'],
      [401, 'unauthorized'],
      [404, 'not_found'],
    ]);
    expect(entries[0].error.message).to.equal(settings.message('loginFailed'));
  });

  it('a 500 also records where in the code it happened', async () => {
    await request(app).get('/api/v1/test/boom');
    const [entry] = await logs(1);
    expect(entry.status).to.equal(500);
    expect(entry.error).to.deep.equal({ code: 'internal_error', message: 'Something went wrong', where: 'KettleController.boil' });
  });

  it('logs only the API: not the website, not /docs, not /health', async () => {
    await request(app).get('/');
    await request(app).get('/docs/openapi.json');
    await request(app).get('/health');
    await request(app).get('/api/v1/products');
    const entries = await logs(1);
    await new Promise((r) => setTimeout(r, 100));
    expect((await RequestLogCollection.find().lean()).map((e) => e.path)).to.deep.equal(['/api/v1/products']);
    expect(entries).to.have.length(1);
  });

  it('entries expire after settings.requestLogs.keepDays', async () => {
    await request(app).get('/api/v1/products');
    const [entry] = await logs(1);
    const days = (new Date(entry.expiresAt) - new Date(entry.at)) / (24 * 60 * 60_000);
    expect(days).to.equal(settings.requestLogs.keepDays);
  });

  it('can be switched off in settings', async () => {
    await settings.update({ requestLogs: { enabled: false } });
    await request(app).get('/api/v1/products');
    await new Promise((r) => setTimeout(r, 150));
    expect(await RequestLogCollection.countDocuments()).to.equal(0);
  });

  it('a log that cannot be written does not break the request', async () => {
    const real = RequestLogCollection.create;
    RequestLogCollection.create = async () => {
      throw new Error('disk full');
    };
    const errors = [];
    const realError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const res = await request(app).get('/api/v1/products');
      expect(res.status).to.equal(200);
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      RequestLogCollection.create = real;
      console.error = realError;
    }
    expect(errors[0]).to.include('Could not write the request log');
  });

  describe('GET /api/v1/request-logs', () => {
    let token;
    beforeEach(async () => {
      token = await tokenFor('admin@example.com');
      const annToken = await tokenFor('ann@example.com');
      await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${annToken}`); // 200
      await request(app).get('/api/v1/users').set('Authorization', `Bearer ${annToken}`); // 403
      await request(app).get('/api/v1/test/boom'); // 500
      await logs(5); // the two logins too
    });
    const list = (query = '', who = token) => request(app).get(`/api/v1/request-logs${query}`).set('Authorization', `Bearer ${who}`);

    it('lists the newest first, paginated', async () => {
      const res = await list('?limit=2');
      expect(res.status).to.equal(200);
      expect(res.body.total).to.be.at.least(5);
      expect(res.body.items).to.have.length(2);
      expect(res.body.items[0].path).to.equal('/api/v1/test/boom');
      expect(res.body.items[0]).to.not.have.property('expiresAt');
    });

    it('filters: only errors, a status class, an exact status, a part of the path, a user, a method', async () => {
      expect((await list('?errors=true')).body.items.map((e) => e.status).sort()).to.deep.equal([403, 500]);
      expect((await list('?status=5xx')).body.items.map((e) => e.status)).to.deep.equal([500]);
      expect((await list('?status=403')).body.items[0].path).to.equal('/api/v1/users');
      expect((await list('?path=ORDERS')).body.items.map((e) => e.path)).to.deep.equal(['/api/v1/orders']);
      // The 403 is hers too: who was refused is recorded, not only who got through.
      expect((await list(`?user=${ann.id}`)).body.items.map((e) => e.status).sort()).to.deep.equal([200, 403]);
      expect((await list('?method=post')).body.items.every((e) => e.method === 'POST')).to.equal(true);
    });

    it('filters by time', async () => {
      expect((await list(`?from=${new Date(Date.now() + 60_000).toISOString()}`)).body.total).to.equal(0);
      expect((await list(`?to=${new Date(Date.now() - 60 * 60_000).toISOString()}`)).body.total).to.equal(0);
    });

    it('400 for a bad filter; only an admin may look', async () => {
      expect((await list('?status=99')).status).to.equal(400);
      expect((await list('?user=nope')).status).to.equal(400);
      expect((await list('', await tokenFor('ann@example.com'))).status).to.equal(403);
      expect((await request(app).get('/api/v1/request-logs')).status).to.equal(401);
    });
  });
});

describe('request log is off by default in tests', () => {
  it('createApp() without requestLogs: true does not log', () => {
    const app = createApp();
    const names = app.router.stack.map((layer) => layer.name);
    expect(names).to.not.include('logRequests');
    expect(express).to.be.a('function');
  });
});
