import { expect } from 'chai';
import request from 'supertest';
import { DEMO_CUSTOMER, seedUsers } from '../scripts/seed.js';
import { createApp } from '../src/app.js';
import { User as UserCollection } from '../src/db.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const ADMIN = { adminEmail: 'Boss@Copperbean.test', adminPassword: 'a long admin password' };
const logIn = (email, password) => request(app).post('/api/v1/auth/sessions').send({ email, password });

describe('seed', () => {
  before(async () => {
    await startDb();
    await UserCollection.init();
  });
  after(stopDb);
  afterEach(() => UserCollection.deleteMany({}));

  it('creates the admin and the demo customer, and both can log in', async () => {
    expect(await seedUsers(ADMIN)).to.deep.equal({ admin: 'created', demoCustomer: 'created' });

    const admin = await logIn('boss@copperbean.test', ADMIN.adminPassword);
    expect(admin.status).to.equal(201);
    expect(admin.body.user.role).to.equal('admin');

    const demo = await logIn(DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    expect(demo.status).to.equal(201);
    expect(demo.body.user.role).to.equal('customer');
  });

  it('can run again: no duplicates, and an existing password is not reset', async () => {
    await seedUsers(ADMIN);
    const again = await seedUsers({ ...ADMIN, adminPassword: 'some other password' });
    expect(again).to.deep.equal({ admin: 'already exists', demoCustomer: 'already exists' });
    expect(await UserCollection.countDocuments()).to.equal(2);
    expect((await logIn('boss@copperbean.test', ADMIN.adminPassword)).status).to.equal(201);
    expect((await logIn('boss@copperbean.test', 'some other password')).status).to.equal(401);
  });

  it('refuses to run without the admin email and password', async () => {
    const err = await seedUsers({}).catch((e) => e);
    expect(err.message).to.include('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD');
    expect(await UserCollection.countDocuments()).to.equal(0);
  });

  it('refuses a weak admin password or a bad email, and creates nothing', async () => {
    for (const bad of [{ ...ADMIN, adminPassword: 'short' }, { ...ADMIN, adminEmail: 'not-an-email' }]) {
      const err = await seedUsers(bad).catch((e) => e);
      expect(err.name).to.equal('ZodError');
    }
    expect(await UserCollection.countDocuments()).to.equal(0);
  });

  it('the demo customer has no extra rights', async () => {
    await seedUsers(ADMIN);
    expect((await User.findByEmail(DEMO_CUSTOMER.email)).role).to.equal('customer');
  });
});
