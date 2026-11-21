import { expect } from 'chai';
import mongoose from 'mongoose';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { BaseController } from '../src/lib/BaseController.js';
import { BaseModel } from '../src/lib/BaseModel.js';
import { startDb, stopDb } from './helpers/db.js';

// A throwaway "Widget" resource built only from the base classes.
const WidgetCollection = mongoose.model(
  'Widget',
  new mongoose.Schema(
    { name: { type: String, required: true }, secret: { type: String, select: false } },
    { timestamps: true },
  ),
);

class Widget extends BaseModel {
  static schema = WidgetCollection;
  static required = ['name'];
}

// A subclass with an overridden method and a method of its own, both used unbound in routes.
class WidgetsController extends BaseController {
  listFilter(req) {
    return req.query.name ? { name: req.query.name } : {};
  }

  async count(req, res) {
    res.json({ count: await this.Model.schema.countDocuments() });
  }

  async boom() {
    throw new Error('something broke');
  }

  // An async helper, called from our own code rather than by Express.
  async loadByName(name) {
    return this.Model.findOne({ name });
  }
}
const widgets = new WidgetsController(Widget);
const widgetCreate = z.object({ name: z.string().min(1) });
const widgetUpdate = widgetCreate.partial();

const app = createApp({
  routes: [
    { method: 'get', path: '/widgets', handler: widgets.list },
    { method: 'get', path: '/widgets-count', handler: widgets.count },
    { method: 'get', path: '/boom', handler: widgets.boom },
    { method: 'get', path: '/widgets/:id', handler: widgets.get },
    { method: 'post', path: '/widgets', validate: { body: widgetCreate }, handler: widgets.create },
    { method: 'patch', path: '/widgets/:id', validate: { body: widgetUpdate }, handler: widgets.update },
    { method: 'delete', path: '/widgets/:id', handler: widgets.remove },
    { method: 'post', path: '/unsafe', handler: widgets.create }, // no validate.body on purpose
  ],
});

const missingId = new mongoose.Types.ObjectId().toString();

describe('BaseModel (records as class instances)', () => {
  before(startDb);
  after(stopDb);
  afterEach(() => WidgetCollection.deleteMany({}));

  it('the constructor refuses a record without its required fields', () => {
    const err = (() => {
      try {
        new Widget({});
      } catch (e) {
        return e;
      }
    })();
    expect(err.status).to.equal(400);
    expect(err.message).to.equal('Missing required fields: name');
  });

  it('create saves the record and fills id and timestamps on the same object', async () => {
    const widget = new Widget({ name: 'Kettle' });
    const result = await widget.create();
    expect(result).to.equal(widget);
    expect(widget).to.be.an.instanceOf(Widget);
    expect(widget.id).to.be.a('string');
    expect(widget.createdAt).to.be.an.instanceOf(Date);
  });

  it('finding returns instances of the class, or null with required: false', async () => {
    const { id } = await new Widget({ name: 'Kettle' }).create();
    const found = await Widget.findById(id);
    expect(found).to.be.an.instanceOf(Widget);
    expect(found.name).to.equal('Kettle');

    expect(await Widget.findOne({ name: 'Teapot' }, { required: false })).to.equal(null);
    expect(await Widget.findById(missingId, { required: false })).to.equal(null);
    expect((await Widget.findOne({ name: 'Teapot' }).catch((e) => e)).status).to.equal(404);
  });

  it('select loads a field the schema hides', async () => {
    await WidgetCollection.create({ name: 'x', secret: 's' });
    expect((await Widget.findOne({ name: 'x' })).secret).to.equal(undefined);
    expect((await Widget.findOne({ name: 'x' }, { select: '+secret' })).secret).to.equal('s');
  });

  it('update and delete act on the record itself', async () => {
    const widget = await new Widget({ name: 'Kettle' }).create();
    await widget.update({ name: 'Gooseneck kettle' });
    expect(widget.name).to.equal('Gooseneck kettle');
    expect((await Widget.findById(widget.id)).name).to.equal('Gooseneck kettle');

    expect(await widget.delete()).to.equal(true);
    expect(await widget.delete({ required: false })).to.equal(false);
    expect((await widget.delete().catch((e) => e)).status).to.equal(404);
  });

  it('a subclass can override a method, e.g. soft delete', async () => {
    class SoftWidget extends Widget {
      async delete() {
        await this.update({ name: 'deleted' });
        return true;
      }
    }
    const widget = await new SoftWidget({ name: 'Kettle' }).create();
    await widget.delete();
    expect((await Widget.findById(widget.id)).name).to.equal('deleted');
  });
});

describe('BaseController', () => {
  before(startDb);
  after(stopDb);
  afterEach(() => WidgetCollection.deleteMany({}));

  it('create: 201, returns the record with id', async () => {
    const res = await request(app).post('/widgets').send({ name: 'Grinder' });
    expect(res.status).to.equal(201);
    expect(res.body).to.include({ name: 'Grinder' });
    expect(res.body).to.have.property('_id'); // Widget has no toJSON plugin, unlike schemas in src/db.js
  });

  it('create: fields not in the request schema never reach the database', async () => {
    const res = await request(app).post('/widgets').send({ name: 'Grinder', secret: 'hacked' });
    expect(res.status).to.equal(201);
    const saved = await WidgetCollection.findById(res.body._id).select('+secret').lean();
    expect(saved).to.not.have.property('secret');
  });

  it('create: invalid body gives 400 with details', async () => {
    const res = await request(app).post('/widgets').send({ name: '' });
    expect(res.status).to.equal(400);
    expect(res.body.error.code).to.equal('validation_error');
    expect(res.body.error.details[0].path).to.equal('name');
  });

  it('create on a route without validate.body fails instead of trusting the client', async () => {
    const res = await request(app).post('/unsafe').send({ name: 'x' });
    expect(res.status).to.equal(500);
    expect(await WidgetCollection.countDocuments()).to.equal(0);
  });

  it('list: paginates, newest first', async () => {
    for (const name of ['a', 'b', 'c']) await new Widget({ name }).create();
    const res = await request(app).get('/widgets?page=1&limit=2');
    expect(res.status).to.equal(200);
    expect(res.body).to.include({ page: 1, limit: 2, total: 3, pages: 2 });
    expect(res.body.items.map((w) => w.name)).to.deep.equal(['c', 'b']);
  });

  it('subclass methods keep `this` when routes.js uses them on their own', async () => {
    for (const name of ['a', 'b', 'b']) await new Widget({ name }).create();
    expect((await request(app).get('/widgets-count')).body).to.deep.equal({ count: 3 });
    expect((await request(app).get('/widgets?name=b')).body.total).to.equal(2); // overridden listFilter
  });

  it('wrap: an error in a handler becomes a JSON 500 and is tagged with Controller.method', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).to.equal(500);
    expect(res.body.error.code).to.equal('internal_error');

    let caught;
    await widgets.boom({}, {}, (err) => (caught = err));
    expect(caught.where).to.equal('WidgetsController.boom');
  });

  it('wrap: an async helper still returns its value and throws back to its caller', async () => {
    await new Widget({ name: 'Kettle' }).create();
    expect((await widgets.loadByName('Kettle')).name).to.equal('Kettle');

    const err = await widgets.loadByName('Teapot').catch((e) => e);
    expect(err.status).to.equal(404);
    expect(err.where).to.equal('WidgetsController.loadByName');
  });

  it('wrap: sync methods are not wrapped, so they still return plain values', () => {
    expect(widgets.listFilter({ query: { name: 'a' } })).to.deep.equal({ name: 'a' });
  });

  it('list: rejects a limit above 50', async () => {
    const res = await request(app).get('/widgets?limit=1000');
    expect(res.status).to.equal(400);
  });

  it('get: 200 for an existing id, 404 for a missing one, 400 for a malformed one', async () => {
    const widget = await new Widget({ name: 'Kettle' }).create();
    expect((await request(app).get(`/widgets/${widget.id}`)).body.name).to.equal('Kettle');

    const missing = await request(app).get(`/widgets/${missingId}`);
    expect(missing.status).to.equal(404);
    expect(missing.body.error.message).to.equal('Widget not found');

    expect((await request(app).get('/widgets/not-an-id')).status).to.equal(400);
  });

  it('update: changes only the given fields', async () => {
    const widget = await new Widget({ name: 'Kettle' }).create();
    const res = await request(app).patch(`/widgets/${widget.id}`).send({ name: 'Gooseneck kettle' });
    expect(res.status).to.equal(200);
    expect(res.body.name).to.equal('Gooseneck kettle');
    expect((await request(app).patch(`/widgets/${missingId}`).send({ name: 'x' })).status).to.equal(404);
  });

  it('remove: 204, then the record is gone', async () => {
    const widget = await new Widget({ name: 'Kettle' }).create();
    expect((await request(app).delete(`/widgets/${widget.id}`)).status).to.equal(204);
    expect((await request(app).get(`/widgets/${widget.id}`)).status).to.equal(404);
  });
});
