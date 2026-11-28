import { expect } from 'chai';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { mailer } from '../src/lib/mailer.js';
import { AddressCollection } from '../src/modules/addresses/schema.js';
import { Address } from '../src/modules/addresses/model.js';
import { CounterCollection } from '../src/modules/counters/schema.js';
import { EmailTemplateCollection } from '../src/modules/email-templates/schema.js';
import { OrderCollection } from '../src/modules/orders/schema.js';
import { Order } from '../src/modules/orders/model.js';
import { ProductCollection } from '../src/modules/products/schema.js';
import { Product } from '../src/modules/products/model.js';
import { settings } from '../src/modules/settings/model.js';
import { ShippingMethodCollection } from '../src/modules/shipping/schema.js';
import { ShippingMethod } from '../src/modules/shipping/model.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

describe('order emails', () => {
  let ann;
  let admin;
  let manager;
  let place;

  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), OrderCollection.init(), ProductCollection.init(), EmailTemplateCollection.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    ann = await new User({ email: 'ann@example.com', name: 'Ann', password: 'correct horse' }).create();
    admin = await new User({ email: 'admin@example.com', name: 'Admin', password: 'correct horse', role: 'admin' }).create();
    manager = await new User({ email: 'manager@example.com', name: 'Manager', password: 'correct horse', role: 'manager' }).create();
    const coffee = await new Product({ name: 'Ethiopia Yirgacheffe', category: 'coffee', priceCents: 1450, stock: 10 }).create();
    const shipping = await new ShippingMethod({ name: 'Standard', priceCents: 499, countries: ['UA'] }).create();
    const address = await new Address({ name: 'Ann Smith', phone: '+380 67 123 45 67', line1: '1 Khreshchatyk St', city: 'Kyiv', postalCode: '01001', country: 'UA' }).create({ actor: ann });
    place = () => new Order({ items: [{ product: coffee.id, quantity: 2 }], addressId: address.id, shippingMethodId: shipping.id }).create({ actor: ann });
  });
  afterEach(() =>
    Promise.all(
      [UserCollection, OrderCollection, ProductCollection, ShippingMethodCollection, AddressCollection, CounterCollection, EmailTemplateCollection].map((c) =>
        c.deleteMany({}),
      ),
    ),
  );

  const last = () => mailer.outbox.at(-1);

  it('placing an order sends "order placed" with the items, totals, address and a link', async () => {
    const order = await place();
    expect(mailer.outbox).to.have.length(1);
    const mail = last();
    expect(mail.to).to.equal('ann@example.com');
    expect(mail.subject).to.equal('Order CB-1001 is placed');
    expect(mail.text)
      .to.include('Hi Ann,')
      .and.include('2 × Ethiopia Yirgacheffe  $29.00')
      .and.include('Items: $29.00')
      .and.include('Delivery (Standard): $4.99')
      .and.include('Total: $33.99')
      .and.include('Ann Smith\n1 Khreshchatyk St\n01001 Kyiv, UA')
      .and.include(`Please pay within ${settings.orders.unpaidExpireMinutes} minutes`)
      .and.include(`${config.APP_URL}/order?id=${order.id}`);
    expect(mail.text).to.not.match(/\{\w+\}/); // every placeholder filled
  });

  it('paid, then shipped: one email each', async () => {
    const order = await place();
    await order.update({ status: 'paid' }, { actor: admin });
    expect(last().subject).to.equal('Payment received for order CB-1001');
    expect(last().text).to.include('We have received $33.99');

    await order.update({ status: 'shipped' }, { actor: manager });
    expect(last().subject).to.equal('Order CB-1001 is on its way');
    expect(last().text).to.include('sent by Standard');

    await order.update({ status: 'completed' }, { actor: manager });
    expect(mailer.outbox.map((m) => m.subject)).to.have.length(3); // no email for "completed"
  });

  it('cancelled by the customer, by the shop, or with a note: the reason is in the email', async () => {
    const own = await place();
    await own.update({ status: 'cancelled' }, { actor: ann });
    expect(last().subject).to.equal('Order CB-1001 is cancelled');
    expect(last().text).to.include(`is cancelled: ${settings.message('cancelledByCustomer')}.`);

    const byShop = await place();
    await byShop.update({ status: 'cancelled' }, { actor: manager });
    expect(last().text).to.include(`is cancelled: ${settings.message('cancelledByShop')}.`);

    const withNote = await place();
    await withNote.update({ status: 'cancelled', note: 'the coffee is out of season' }, { actor: manager });
    expect(last().text).to.include('is cancelled: the coffee is out of season.');
  });

  it('an order that expires unpaid is cancelled with the "not paid in time" reason', async () => {
    const order = await place();
    await OrderCollection.collection.updateOne({ _id: new mongoose.Types.ObjectId(order.id) }, { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
    await Order.cancelExpired();
    expect(last().text).to.include(`is cancelled: ${settings.message('orderExpired')}.`);
  });

  it('a template switched off is not sent; the order goes on', async () => {
    await place(); // creates the templates
    await EmailTemplateCollection.updateOne({ key: 'order.created' }, { active: false });
    mailer.outbox.length = 0;
    const order = await place();
    expect(order.number).to.equal('CB-1002');
    expect(mailer.outbox).to.have.length(0);
  });

  it('if the email fails, the order is still placed and only a log line says so', async () => {
    const realTransport = mailer.transport;
    const realError = console.error;
    const logged = [];
    mailer.transport = async () => {
      throw new Error('mail service down');
    };
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const order = await place();
      expect(order.status).to.equal('pending_payment');
      expect(await OrderCollection.countDocuments()).to.equal(1);
    } finally {
      mailer.transport = realTransport;
      console.error = realError;
    }
    expect(logged[0]).to.include('Email order.created for order CB-1001 was not sent: mail service down');
  });

  it('a wiped account gets no email, and that does not stop a status change', async () => {
    const order = await place();
    await ann.delete({ actor: admin }); // has an order: wiped, not deleted
    mailer.outbox.length = 0;
    await (await Order.findById(order.id)).update({ status: 'cancelled' }, { actor: manager });
    expect(mailer.outbox).to.have.length(0);
    expect((await OrderCollection.findById(order.id)).status).to.equal('cancelled');
  });
});
