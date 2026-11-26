import { expect } from 'chai';
import { UserCollection } from '../src/modules/users/schema.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const ann = () => ({ email: 'ann@example.com', name: 'Ann', password: 'correct horse' });

describe('users: User', () => {
  before(async () => {
    await startDb();
    await UserCollection.init();
  });
  after(stopDb);
  afterEach(() => UserCollection.deleteMany({}));

  it('needs email, name and password to be created', () => {
    expect(() => new User({ email: 'ann@example.com' })).to.throw('Missing required fields: name, password');
  });

  it('create stores a bcrypt hash, never the password itself', async () => {
    const user = await new User(ann()).create();
    expect(user).to.not.have.property('password');
    expect(user.toJSON()).to.not.have.property('passwordHash');

    const saved = await UserCollection.findById(user.id).select('+passwordHash').lean();
    expect(saved).to.not.have.property('password');
    expect(saved.passwordHash).to.match(/^\$2[aby]\$/);
    expect(saved.passwordHash).to.not.include('correct horse');
  });

  it('checkCredentials returns the user for the right password, any email case', async () => {
    await new User(ann()).create();
    const user = await User.checkCredentials(' ANN@example.com', 'correct horse');
    expect(user).to.be.an.instanceOf(User);
    expect(user.email).to.equal('ann@example.com');
  });

  it('checkCredentials returns null for a wrong password or an unknown email', async () => {
    await new User(ann()).create();
    expect(await User.checkCredentials('ann@example.com', 'wrong')).to.equal(null);
    expect(await User.checkCredentials('nobody@example.com', 'correct horse')).to.equal(null);
  });

  it('update with a new password re-hashes it, so only the new one works', async () => {
    const user = await new User(ann()).create();
    await user.update({ password: 'new password' });
    expect(await User.checkCredentials('ann@example.com', 'correct horse')).to.equal(null);
    expect(await User.checkCredentials('ann@example.com', 'new password')).to.not.equal(null);
  });

  it('update without a password leaves the hash alone', async () => {
    const user = await new User(ann()).create();
    await user.update({ name: 'Anna' });
    expect((await User.findById(user.id)).name).to.equal('Anna');
    expect(await User.checkCredentials('ann@example.com', 'correct horse')).to.not.equal(null);
  });

  it('findByEmail returns null instead of throwing when there is no such user', async () => {
    expect(await User.findByEmail('nobody@example.com')).to.equal(null);
  });
});
