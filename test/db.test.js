import { expect } from 'chai';
import { Product, User } from '../src/db.js';
import { startDb, stopDb } from './helpers/db.js';

const validProduct = () => ({
  name: 'Ethiopia Yirgacheffe',
  slug: 'ethiopia-yirgacheffe',
  category: 'coffee',
  priceCents: 1450,
  stock: 20,
});

describe('db: Product', () => {
  before(async () => {
    await startDb();
    await Product.init(); // wait until indexes (unique slug) are built
  });
  after(stopDb);
  afterEach(() => Product.deleteMany({}));

  it('saves a valid product with defaults', async () => {
    const product = await Product.create(validProduct());
    expect(product.active).to.equal(true);
    expect(product.currency).to.equal('usd');
    expect(product.createdAt).to.be.an.instanceOf(Date);
  });

  it('shows id instead of _id and hides __v in JSON', async () => {
    const json = (await Product.create(validProduct())).toJSON();
    expect(json.id).to.be.a('string');
    expect(json).to.not.have.any.keys('_id', '__v');
  });

  it('rejects a price that is not a whole number of cents', async () => {
    const err = await Product.create({ ...validProduct(), priceCents: 14.5 }).catch((e) => e);
    expect(err.name).to.equal('ValidationError');
    expect(err.errors.priceCents.message).to.equal('priceCents must be a whole number');
  });

  it('rejects an unknown category and a negative stock', async () => {
    const err = await Product.create({ ...validProduct(), category: 'cake', stock: -1 }).catch((e) => e);
    expect(err.errors).to.have.all.keys('category', 'stock');
  });

  it('does not allow two products with the same slug', async () => {
    await Product.create(validProduct());
    const err = await Product.create({ ...validProduct(), name: 'Copy' }).catch((e) => e);
    expect(err.code).to.equal(11000);
  });
});

const validUser = () => ({
  email: 'Ann@Example.com ',
  name: 'Ann',
  passwordHash: '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfake',
});

describe('db: User', () => {
  before(async () => {
    await startDb();
    await User.init(); // wait until indexes (unique email) are built
  });
  after(stopDb);
  afterEach(() => User.deleteMany({}));

  it('lowercases and trims the email, makes a new user a customer', async () => {
    const user = await User.create(validUser());
    expect(user.email).to.equal('ann@example.com');
    expect(user.role).to.equal('customer');
  });

  it('does not load the password hash unless asked for', async () => {
    const { id } = await User.create(validUser());
    expect((await User.findById(id)).passwordHash).to.equal(undefined);
    expect((await User.findById(id).select('+passwordHash')).passwordHash).to.be.a('string');
  });

  it('never puts the password hash into JSON, even when it was loaded', async () => {
    const { id } = await User.create(validUser());
    const json = (await User.findById(id).select('+passwordHash')).toJSON();
    expect(json).to.not.have.property('passwordHash');
    expect(json).to.include({ id, email: 'ann@example.com' });
  });

  it('rejects an unknown role', async () => {
    const err = await User.create({ ...validUser(), role: 'superuser' }).catch((e) => e);
    expect(err.errors).to.have.property('role');
  });

  it('does not allow two accounts with the same email in different case', async () => {
    await User.create(validUser());
    const err = await User.create({ ...validUser(), email: 'ANN@example.com' }).catch((e) => e);
    expect(err.code).to.equal(11000);
  });
});
