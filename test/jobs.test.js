import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from 'chai';
import mongoose from 'mongoose';
import {
  Address as AddressCollection,
  Counter as CounterCollection,
  Order as OrderCollection,
  Product as ProductCollection,
  ShippingMethod as ShippingCollection,
  User as UserCollection,
} from '../src/db.js';
import { jobs, runJob } from '../src/jobs/index.js';
import { startScheduler } from '../src/jobs/scheduler.js';
import { Address } from '../src/modules/addresses/model.js';
import { Order } from '../src/modules/orders/model.js';
import { Product } from '../src/modules/products/model.js';
import { ShippingMethod } from '../src/modules/shipping/model.js';
import { User } from '../src/modules/users/model.js';
import { dbUri, startDb, stopDb } from './helpers/db.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exec = promisify(execFile);

// Runs scripts/job.js as its own process against the test database, the way cron would.
const cli = (...args) =>
  exec(process.execPath, ['scripts/job.js', ...args], {
    env: { ...process.env, MONGODB_URI: dbUri(), NODE_ENV: 'test' },
    timeout: 60_000,
  }).then(
    (result) => ({ code: 0, ...result }),
    (err) => err, // has .code (the exit code), .stdout and .stderr
  );

// A small fake logger that remembers what it was told.
const fakeLog = () => ({ lines: [], errors: [], log(text) { this.lines.push(text); }, error(text) { this.errors.push(text); } });

describe('jobs', () => {
  describe('the registry', () => {
    it('every job says what it does, how often, and can run', () => {
      for (const [name, job] of Object.entries(jobs)) {
        expect(job.description, name).to.be.a('string').and.not.equal('');
        expect(job.everyMinutes(), name).to.be.a('number').and.be.above(0);
        expect(job.run, name).to.be.a('function');
      }
    });

    it('runJob refuses an unknown name and says which exist', async () => {
      const err = await runJob('make-coffee').catch((e) => e);
      expect(err.message).to.include('Unknown job "make-coffee"').and.include('expire-orders');
      expect((await runJob('constructor').catch((e) => e)).message).to.include('Unknown job'); // not an object property
    });
  });

  describe('the scheduler', () => {
    // Intervals here are fractions of a minute: 0.001 minute is 60 ms.
    const job = (run, everyMinutes = 0.001) => ({ description: 'test', everyMinutes: () => everyMinutes, run });

    it('runs a job at once, then again and again on its interval', async () => {
      let runs = 0;
      const stop = startScheduler({ list: { count: job(async () => ++runs) }, log: fakeLog() });
      await sleep(30);
      expect(runs).to.equal(1); // right away, not after the first interval
      await sleep(250);
      stop();
      expect(runs).to.be.at.least(3);
    });

    it('stop() ends the timers', async () => {
      let runs = 0;
      const stop = startScheduler({ list: { count: job(async () => ++runs) }, log: fakeLog() });
      await sleep(30);
      stop();
      const after = runs;
      await sleep(200);
      expect(runs).to.equal(after);
    });

    it('does not start a job again while the last run is still going', async () => {
      let started = 0;
      let running = 0;
      let overlapped = false;
      const slow = job(async () => {
        started++;
        running++;
        if (running > 1) overlapped = true;
        await sleep(200);
        running--;
      }, 0.0003); // every 18 ms, but each run takes 200 ms
      const stop = startScheduler({ list: { slow }, log: fakeLog() });
      await sleep(150);
      stop();
      expect(started).to.equal(1);
      expect(overlapped).to.equal(false);
    });

    it('a failing job is logged and tried again; other jobs are not affected', async () => {
      const log = fakeLog();
      let good = 0;
      let bad = 0;
      const stop = startScheduler({
        list: {
          good: job(async () => ++good),
          bad: job(async () => {
            bad++;
            throw new Error('the database is on holiday');
          }),
        },
        log,
      });
      await sleep(250);
      stop();
      expect(bad).to.be.at.least(2);
      expect(good).to.be.at.least(2);
      expect(log.errors[0]).to.equal('Job bad failed: the database is on holiday');
    });

    it('says something only when a job did something', async () => {
      const log = fakeLog();
      const results = [0, 3];
      const stop = startScheduler({ list: { counted: job(async () => results.shift() ?? 0) }, log });
      await sleep(200);
      stop();
      expect(log.lines).to.deep.equal(['Job counted: 3']);
    });

  });

  describe('expire-orders, started from outside (scripts/job.js)', () => {
    const u = {};
    const p = {};
    let shipping;
    let address;

    before(async () => {
      await startDb();
      await Promise.all([OrderCollection.init(), ProductCollection.init()]);
    });
    after(stopDb);

    beforeEach(async () => {
      u.ann = await new User({ email: 'ann@example.com', name: 'Ann', password: 'correct horse' }).create();
      p.coffee = await new Product({ name: 'Ethiopia', category: 'coffee', priceCents: 1450, stock: 10 }).create();
      shipping = await new ShippingMethod({ name: 'Standard', priceCents: 499, countries: ['UA'] }).create();
      address = await new Address({
        name: 'Ann',
        phone: '+380 67 123 45 67',
        line1: '12 Khreshchatyk St',
        city: 'Kyiv',
        postalCode: '01001',
        country: 'UA',
      }).create({ actor: u.ann });
    });
    afterEach(() =>
      Promise.all(
        [OrderCollection, ProductCollection, UserCollection, ShippingCollection, AddressCollection, CounterCollection].map((c) =>
          c.deleteMany({}),
        ),
      ),
    );

    // An order placed 2 hours ago that nobody paid.
    const staleOrder = async () => {
      const order = await new Order({
        items: [{ product: p.coffee.id, quantity: 3 }],
        addressId: address.id,
        shippingMethodId: shipping.id,
      }).create({ actor: u.ann });
      await OrderCollection.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(order.id) },
        { $set: { createdAt: new Date(Date.now() - 120 * 60_000) } },
      );
      return order;
    };

    it('without a name it lists the jobs and touches nothing', async () => {
      const result = await cli();
      expect(result.code).to.equal(0);
      expect(result.stdout).to.include('expire-orders').and.include('Cancels orders that were not paid in time');
    });

    it('runs the job once, as its own process, and exits', async () => {
      const order = await staleOrder();
      expect((await ProductCollection.findById(p.coffee.id)).stock).to.equal(7);

      const result = await cli('expire-orders');
      expect(result.code).to.equal(0);
      expect(result.stdout).to.include('expire-orders: 1');

      expect((await OrderCollection.findById(order.id)).status).to.equal('cancelled');
      expect((await ProductCollection.findById(p.coffee.id)).stock).to.equal(10);
    });

    it('running it again, or two at the same time, does no harm', async () => {
      await staleOrder();
      const results = await Promise.all([cli('expire-orders'), cli('expire-orders')]);
      expect(results.map((r) => r.code)).to.deep.equal([0, 0]);

      const counts = results.map((r) => Number(r.stdout.match(/expire-orders: (\d+)/)[1]));
      expect(counts.reduce((a, b) => a + b, 0)).to.equal(1); // cancelled once in total
      expect((await ProductCollection.findById(p.coffee.id)).stock).to.equal(10); // and given back once
    });

    it('an unknown job is an error that names the real ones', async () => {
      const result = await cli('make-coffee');
      expect(result.code).to.equal(1);
      expect(result.stderr).to.include('Unknown job "make-coffee"').and.include('expire-orders');
    });
  });
});
