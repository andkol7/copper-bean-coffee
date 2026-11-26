import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { PasswordFailureCollection as PasswordFailure, SessionCollection } from '../src/modules/sessions/schema.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { settings } from '../src/modules/settings/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';

const api = (method, path, token) => {
  const req = request(app)[method](path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const logIn = async (email, password = PASSWORD) =>
  (await request(app).post('/api/v1/auth/sessions').send({ email, password })).body;
const register = (body) => request(app).post('/api/v1/users').send(body);

describe('users routes', () => {
  const t = {}; // login results by name: { accessToken, refreshToken, user }

  before(async () => {
    await startDb();
    await UserCollection.init();
  });
  after(stopDb);

  beforeEach(async () => {
    for (const [name, role] of [['admin', 'admin'], ['manager', 'manager'], ['ann', 'customer']]) {
      await new User({ email: `${name}@example.com`, name: name, password: PASSWORD, role }).create();
      t[name] = await logIn(`${name}@example.com`);
    }
  });
  afterEach(() =>
    Promise.all([UserCollection, SessionCollection, PasswordFailure].map((collection) => collection.deleteMany({}))),
  );

  describe('POST /api/v1/users (register)', () => {
    const body = { email: 'Bob@Example.com', name: 'Bob', password: 'long enough' };

    it('creates a customer and never returns the password hash', async () => {
      const res = await register(body);
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ email: 'bob@example.com', name: 'Bob', role: 'customer' });
      expect(res.body).to.not.have.any.keys('passwordHash', 'password');
      expect((await logIn('bob@example.com', 'long enough')).accessToken).to.be.a('string');
    });

    it('ignores a role sent by the client', async () => {
      const res = await register({ ...body, role: 'admin' });
      expect(res.status).to.equal(201);
      expect(res.body.role).to.equal('customer');
    });

    it('409 for an email that is taken, in any letter case', async () => {
      const res = await register({ ...body, email: 'ANN@example.com' });
      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal('duplicate');
    });

    it('400 for a bad email, a short password or a missing name', async () => {
      expect((await register({ ...body, email: 'nope' })).status).to.equal(400);
      expect((await register({ ...body, password: 'short' })).status).to.equal(400);
      expect((await register({ email: body.email, password: body.password })).status).to.equal(400);
    });

    it('passwords are limited to 72 bytes, because bcrypt ignores the rest', async () => {
      expect((await register({ ...body, password: 'a'.repeat(73) })).status).to.equal(400);
      expect((await register({ ...body, email: 'c@example.com', password: 'я'.repeat(40) })).status).to.equal(400);
      expect((await register({ ...body, email: 'd@example.com', password: 'a'.repeat(72) })).status).to.equal(201);
    });
  });

  describe('POST /api/v1/staff', () => {
    const body = { email: 'new@example.com', name: 'New', password: 'long enough', role: 'manager' };

    it('an admin creates a manager or an admin, who can then log in', async () => {
      const res = await api('post', '/api/v1/staff', t.admin.accessToken).send(body);
      expect(res.status).to.equal(201);
      expect(res.body.role).to.equal('manager');
      expect((await logIn('new@example.com', 'long enough')).user.role).to.equal('manager');

      const another = await api('post', '/api/v1/staff', t.admin.accessToken).send({ ...body, email: 'a2@example.com', role: 'admin' });
      expect(another.body.role).to.equal('admin');
    });

    it('nobody else may: manager and customer get 403, a stranger 401', async () => {
      expect((await api('post', '/api/v1/staff', t.manager.accessToken).send(body)).status).to.equal(403);
      expect((await api('post', '/api/v1/staff', t.ann.accessToken).send(body)).status).to.equal(403);
      expect((await api('post', '/api/v1/staff').send(body)).status).to.equal(401);
    });

    it('400 for the role customer or no role', async () => {
      expect((await api('post', '/api/v1/staff', t.admin.accessToken).send({ ...body, role: 'customer' })).status).to.equal(400);
      expect((await api('post', '/api/v1/staff', t.admin.accessToken).send({ ...body, role: undefined })).status).to.equal(400);
    });
  });

  describe('/api/v1/users/me', () => {
    it('GET returns the logged-in user', async () => {
      const res = await api('get', '/api/v1/users/me', t.ann.accessToken);
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ email: 'ann@example.com', role: 'customer' });
    });

    it('PATCH changes name and phone, and ignores a role', async () => {
      const res = await api('patch', '/api/v1/users/me', t.ann.accessToken).send({
        name: 'Anna',
        phone: '+380 67 123 45 67',
        role: 'admin',
      });
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: 'Anna', phone: '+380 67 123 45 67', role: 'customer' });
      expect((await User.findByEmail('ann@example.com')).role).to.equal('customer');
    });

    it('PATCH with nothing to change, or only a role, is 400', async () => {
      expect((await api('patch', '/api/v1/users/me', t.ann.accessToken).send({})).status).to.equal(400);
      expect((await api('patch', '/api/v1/users/me', t.ann.accessToken).send({ role: 'admin' })).status).to.equal(400);
    });

    it('a new password needs the current one, then ends every login', async () => {
      const change = (extra) => api('patch', '/api/v1/users/me', t.ann.accessToken).send({ password: 'brand new pass', ...extra });

      expect((await change({})).status).to.equal(400); // no currentPassword
      const wrong = await change({ currentPassword: 'wrong' });
      expect(wrong.status).to.equal(400);
      expect(wrong.body.error.message).to.equal(settings.message('wrongCurrentPassword'));

      expect((await change({ currentPassword: PASSWORD })).status).to.equal(200);

      // The old refresh token is dead, the old password no longer works, the new one does.
      const refresh = await request(app).post('/api/v1/auth/sessions').send({ refreshToken: t.ann.refreshToken });
      expect(refresh.status).to.equal(401);
      expect((await request(app).post('/api/v1/auth/sessions').send({ email: 'ann@example.com', password: PASSWORD })).status).to.equal(401);
      expect((await logIn('ann@example.com', 'brand new pass')).accessToken).to.be.a('string');
    });

    it('401 without a token', async () => {
      expect((await api('get', '/api/v1/users/me')).status).to.equal(401);
      expect((await api('patch', '/api/v1/users/me').send({ name: 'x' })).status).to.equal(401);
    });
  });

  describe('admin: /api/v1/users', () => {
    it('only an admin may list, read, change or delete users', async () => {
      const id = t.ann.user.id;
      for (const token of [t.manager.accessToken, t.ann.accessToken]) {
        expect((await api('get', '/api/v1/users', token)).status).to.equal(403);
        expect((await api('get', `/api/v1/users/${id}`, token)).status).to.equal(403);
        expect((await api('patch', `/api/v1/users/${id}`, token).send({ name: 'x' })).status).to.equal(403);
        expect((await api('delete', `/api/v1/users/${id}`, token)).status).to.equal(403);
      }
      expect((await api('get', '/api/v1/users')).status).to.equal(401);
    });

    it('list: paginated, filtered by role, searched by name or email', async () => {
      const all = await api('get', '/api/v1/users?limit=2', t.admin.accessToken);
      expect(all.body).to.include({ page: 1, limit: 2, total: 3, pages: 2 });
      expect(all.body.items).to.have.length(2);
      expect(all.body.items[0]).to.not.have.property('passwordHash');

      expect((await api('get', '/api/v1/users?role=manager', t.admin.accessToken)).body.total).to.equal(1);
      expect((await api('get', '/api/v1/users?q=ANN', t.admin.accessToken)).body.items[0].email).to.equal('ann@example.com');
      expect((await api('get', '/api/v1/users?role=boss', t.admin.accessToken)).status).to.equal(400);
    });

    it('search treats the text literally, not as a pattern', async () => {
      // As a pattern "a.n" would match "ann"; as text it matches nothing.
      expect((await api('get', '/api/v1/users?q=a.n', t.admin.accessToken)).body.total).to.equal(0);
    });

    it('GET one: 200, 404 for a missing id, 400 for a malformed one', async () => {
      expect((await api('get', `/api/v1/users/${t.ann.user.id}`, t.admin.accessToken)).body.email).to.equal('ann@example.com');
      expect((await api('get', '/api/v1/users/507f1f77bcf86cd799439011', t.admin.accessToken)).status).to.equal(404);
      expect((await api('get', '/api/v1/users/not-an-id', t.admin.accessToken)).status).to.equal(400);
    });

    it('PATCH changes someone\'s role at once, and rejects an unknown role', async () => {
      const path = `/api/v1/users/${t.ann.user.id}`;
      const res = await api('patch', path, t.admin.accessToken).send({ role: 'manager' });
      expect(res.body.role).to.equal('manager');
      expect((await api('get', '/api/v1/users', t.ann.accessToken)).status).to.equal(403); // still not admin
      expect((await api('patch', path, t.admin.accessToken).send({ role: 'boss' })).status).to.equal(400);
    });

    it('PATCH cannot set a password or an email', async () => {
      const path = `/api/v1/users/${t.ann.user.id}`;
      const res = await api('patch', path, t.admin.accessToken).send({ name: 'Anna', email: 'x@example.com', password: 'hacked hacked' });
      expect(res.status).to.equal(200);
      expect(res.body.email).to.equal('ann@example.com');
      expect((await logIn('ann@example.com')).accessToken).to.be.a('string');
    });

    it('an admin cannot change their own role, but can change their own name', async () => {
      const path = `/api/v1/users/${t.admin.user.id}`;
      const role = await api('patch', path, t.admin.accessToken).send({ role: 'manager' });
      expect(role.status).to.equal(403);
      expect(role.body.error.message).to.equal(settings.message('ownRole'));
      expect((await api('patch', path, t.admin.accessToken).send({ name: 'Boss' })).status).to.equal(200);
    });

    it('DELETE removes a user and ends their logins; an admin cannot delete themselves', async () => {
      const own = await api('delete', `/api/v1/users/${t.admin.user.id}`, t.admin.accessToken);
      expect(own.status).to.equal(403);
      expect(own.body.error.message).to.equal(settings.message('ownAccount'));

      expect((await api('delete', `/api/v1/users/${t.ann.user.id}`, t.admin.accessToken)).status).to.equal(204);
      expect((await api('get', '/api/v1/users/me', t.ann.accessToken)).status).to.equal(401); // token still valid, user is gone
      expect(await SessionCollection.countDocuments({ user: t.ann.user.id })).to.equal(0);
      expect((await api('delete', `/api/v1/users/${t.ann.user.id}`, t.admin.accessToken)).status).to.equal(404);
    });
  });

  describe('DELETE /api/v1/auth/sessions (log out)', () => {
    const logOut = (refreshToken) => request(app).delete('/api/v1/auth/sessions').send({ refreshToken });

    it('ends that login: the refresh token stops working', async () => {
      expect((await logOut(t.ann.refreshToken)).status).to.equal(204);
      const refresh = await request(app).post('/api/v1/auth/sessions').send({ refreshToken: t.ann.refreshToken });
      expect(refresh.status).to.equal(401);
    });

    it('also works with a token that was already swapped for a new one, and ends the whole family', async () => {
      const next = (await request(app).post('/api/v1/auth/sessions').send({ refreshToken: t.ann.refreshToken })).body;
      expect((await logOut(t.ann.refreshToken)).status).to.equal(204); // the old, used token
      const refresh = await request(app).post('/api/v1/auth/sessions').send({ refreshToken: next.refreshToken });
      expect(refresh.status).to.equal(401);
    });

    it('does not touch the same user\'s other logins', async () => {
      const laptop = await logIn('ann@example.com');
      await logOut(t.ann.refreshToken);
      const refresh = await request(app).post('/api/v1/auth/sessions').send({ refreshToken: laptop.refreshToken });
      expect(refresh.status).to.equal(201);
    });

    it('401 for an unknown token, 400 without one', async () => {
      expect((await logOut('x'.repeat(43))).status).to.equal(401);
      expect((await request(app).delete('/api/v1/auth/sessions').send({})).status).to.equal(400);
    });
  });
});
