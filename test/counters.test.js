import { expect } from 'chai';
import { Counter as CounterCollection } from '../src/db.js';
import { Counter } from '../src/modules/counters/model.js';
import { startDb, stopDb } from './helpers/db.js';

describe('counters', () => {
  before(startDb);
  after(stopDb);
  afterEach(() => CounterCollection.deleteMany({}));

  it('counts 1, 2, 3 from the first call on', async () => {
    expect(await Counter.next('order')).to.equal(1);
    expect(await Counter.next('order')).to.equal(2);
    expect(await Counter.next('order')).to.equal(3);
  });

  it('each name counts on its own', async () => {
    await Counter.next('order');
    await Counter.next('order');
    expect(await Counter.next('invoice')).to.equal(1);
    expect(await Counter.next('order')).to.equal(3);
  });

  it('numbers taken at the same moment are all different, with none missing', async () => {
    const numbers = await Promise.all(Array.from({ length: 50 }, () => Counter.next('order')));
    expect(new Set(numbers).size).to.equal(50);
    expect([...numbers].sort((a, b) => a - b)).to.deep.equal(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('keeps one document per name, holding the last number given out', async () => {
    await Counter.next('order');
    await Counter.next('order');
    expect(await CounterCollection.countDocuments()).to.equal(1);
    expect((await CounterCollection.findById('order')).seq).to.equal(2);
  });
});
