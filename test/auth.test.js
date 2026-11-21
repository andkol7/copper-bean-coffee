import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { Session as SessionCollection, User as UserCollection } from '../src/db.js';
import { buildRouter } from '../src/router.js';
import { routes } from '../src/routes.js';
import { settings } from '../src/modules/settings/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const whoAmI = async (req, res) => res.json({ id: req.user.id, role: req.user.role });

// The real routes plus three test routes, one per auth level.
const app = createApp({
  routes: [
    ...routes,
    { method: 'get', path: '/test/user', auth: 'user', handler: whoAmI },
    { method: 'get', path: '/test/staff', auth: 'staff', handler: whoAmI },
    { method: 'get', path: '/test/admin', auth: 'admin', handler: whoAmI },
  ],
});

const PASSWORD = 'correct horse';
const tokenFor = async (email) =>
  (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;
const get = (path, token) => {
  const req = request(app).get(path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('auth', () => {
  const tokens = {};
  const users = {};

  before(async () => {
    await startDb();
    await UserCollection.init();
  });
  after(stopDb);

  beforeEach(async () => {
    for (const role of ['customer', 'manager', 'admin']) {
      const email = `${role}@example.com`;
      users[role] = await new User({ email, name: role, password: PASSWORD, role }).create();
      tokens[role] = await tokenFor(email);
    }
  });
  afterEach(() => Promise.all([UserCollection.deleteMany({}), SessionCollection.deleteMany({})]));

  it('who may call what', async () => {
    const expected = {
      '/test/user': { customer: 200, manager: 200, admin: 200 },
      '/test/staff': { customer: 403, manager: 200, admin: 200 },
      '/test/admin': { customer: 403, manager: 403, admin: 200 },
    };
    for (const [path, byRole] of Object.entries(expected)) {
      for (const [role, status] of Object.entries(byRole)) {
        const res = await get(path, tokens[role]);
        expect(res.status, `${role} on ${path}`).to.equal(status);
      }
    }
  });

  it('puts the user into req.user', async () => {
    const res = await get('/test/staff', tokens.manager);
    expect(res.body).to.deep.equal({ id: users.manager.id, role: 'manager' });
  });

  it('403 says the user has no access', async () => {
    const res = await get('/test/admin', tokens.customer);
    expect(res.body.error).to.deep.equal({ code: 'forbidden', message: settings.message('forbidden') });
  });

  it('401 without a token or with a broken header', async () => {
    for (const header of [undefined, 'Bearer', `Basic ${tokens.admin}`, 'Bearer not-a-jwt']) {
      const req = request(app).get('/test/user');
      const res = await (header ? req.set('Authorization', header) : req);
      expect(res.status, String(header)).to.equal(401);
    }
  });

  it('401 with an expired token', async () => {
    const expired = jwt.sign({}, config.JWT_SECRET, { subject: users.admin.id, expiresIn: -1 });
    expect((await get('/test/user', expired)).status).to.equal(401);
  });

  it('a role change works at once, with the same token', async () => {
    expect((await get('/test/staff', tokens.customer)).status).to.equal(403);
    await users.customer.update({ role: 'manager' });
    expect((await get('/test/staff', tokens.customer)).status).to.equal(200);
  });

  it('a deleted user is out at once, even with a valid token', async () => {
    await users.customer.delete();
    expect((await get('/test/user', tokens.customer)).status).to.equal(401);
  });

  it('auth runs before validation: a stranger gets 401, not a list of field errors', async () => {
    const { z } = await import('zod');
    const strict = createApp({
      routes: [
        { method: 'post', path: '/x', auth: 'admin', validate: { body: z.object({ a: z.string() }) }, handler: whoAmI },
      ],
    });
    expect((await request(strict).post('/x').send({})).status).to.equal(401);
  });

  it('GET /api/v1/users/me returns the logged-in user without secrets', async () => {
    const res = await get('/api/v1/users/me', tokens.customer);
    expect(res.status).to.equal(200);
    expect(res.body).to.include({ id: users.customer.id, email: 'customer@example.com', role: 'customer' });
    expect(res.body).to.not.have.property('passwordHash');
    expect((await get('/api/v1/users/me')).status).to.equal(401);
  });

  it('routes.js with an unknown auth level does not start', () => {
    const route = { method: 'get', path: '/x', auth: 'superuser', handler: whoAmI };
    expect(() => buildRouter([route])).to.throw('unknown auth "superuser"');
  });
});
