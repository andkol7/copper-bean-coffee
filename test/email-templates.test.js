import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { mailer } from '../src/lib/mailer.js';
import { EmailTemplate, SYSTEM_TEMPLATES } from '../src/modules/email-templates/model.js';
import { EmailTemplateCollection } from '../src/modules/email-templates/schema.js';
import { SessionCollection } from '../src/modules/sessions/schema.js';
import { settings } from '../src/modules/settings/model.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const PASSWORD = 'correct horse';

describe('email templates', () => {
  const t = {};

  before(async () => {
    await startDb();
    await Promise.all([EmailTemplateCollection.init(), UserCollection.init()]);
  });
  after(stopDb);
  beforeEach(async () => {
    await EmailTemplate.ensureDefaults();
    for (const [name, role] of [['admin', 'admin'], ['manager', 'manager']]) {
      const email = `${name}@example.com`;
      await new User({ email, name, password: PASSWORD, role }).create();
      t[name] = (await request(app).post('/api/v1/auth/sessions').send({ email, password: PASSWORD })).body.accessToken;
    }
  });
  afterEach(() => Promise.all([EmailTemplateCollection, UserCollection, SessionCollection].map((c) => c.deleteMany({}))));

  const api = (method, path, token = t.admin) => request(app)[method](`/api/v1/email-templates${path}`).set('Authorization', `Bearer ${token}`);

  describe('the shop\'s own templates', () => {
    it('are created in the database from the starting texts', async () => {
      const keys = (await EmailTemplateCollection.find().lean()).map((d) => d.key).sort();
      expect(keys).to.deep.equal(Object.keys(SYSTEM_TEMPLATES).sort());
    });

    it('ensureDefaults never overwrites a template an admin changed, and adds a missing one', async () => {
      await EmailTemplateCollection.updateOne({ key: 'order.paid' }, { subject: 'Edited' });
      await EmailTemplateCollection.deleteOne({ key: 'order.shipped' });
      await EmailTemplate.ensureDefaults();
      expect((await EmailTemplateCollection.findOne({ key: 'order.paid' })).subject).to.equal('Edited');
      expect(await EmailTemplateCollection.countDocuments({ key: 'order.shipped' })).to.equal(1);
    });

    it('every starting text uses only its own variables', () => {
      for (const definition of Object.values(SYSTEM_TEMPLATES)) {
        expect(() => EmailTemplate.checkPlaceholders(definition, `${definition.subject}\n${definition.text}`)).to.not.throw();
      }
    });
  });

  describe('CRUD /api/v1/email-templates', () => {
    it('list: all templates, by key, each says if the shop uses it and which variables it has', async () => {
      const res = await api('get', '');
      expect(res.status).to.equal(200);
      expect(res.body.items.map((x) => x.key)).to.deep.equal(Object.keys(SYSTEM_TEMPLATES).sort());
      const paid = res.body.items.find((x) => x.key === 'order.paid');
      expect(paid).to.include({ system: true, active: true });
      expect(paid.variables).to.have.property('total');
    });

    it('get one by key', async () => {
      const res = await api('get', '/order.paid');
      expect(res.body).to.include({ key: 'order.paid', subject: SYSTEM_TEMPLATES['order.paid'].subject });
      expect((await api('get', '/nothing.here')).status).to.equal(404);
    });

    it('change the subject and text of a shop email; the next email uses them', async () => {
      const res = await api('patch', '/otp.code').send({ subject: 'Code {code} for {name}', text: 'Use {code}.' });
      expect(res.status).to.equal(200);
      await EmailTemplate.send('otp.code', { to: 'ann@example.com', vars: { name: 'Ann', code: '123456' } });
      expect(mailer.outbox.at(-1)).to.deep.equal({ to: 'ann@example.com', subject: 'Code 123456 for Ann', text: 'Use 123456.' });
    });

    it('a shop email refuses a placeholder it does not have, and lists the ones it has', async () => {
      const res = await api('patch', '/order.paid').send({ text: 'Paid {totl}' });
      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('{totl}').and.include('{total}');
      expect((await EmailTemplateCollection.findOne({ key: 'order.paid' })).text).to.not.include('{totl}');
    });

    it('a shop email can be switched off (and is then not sent), but not deleted', async () => {
      expect((await api('patch', '/order.paid').send({ active: false })).body.active).to.equal(false);
      expect(await EmailTemplate.send('order.paid', { to: 'ann@example.com', vars: {} })).to.equal(false);
      expect(mailer.outbox).to.have.length(0);

      const del = await api('delete', '/order.paid');
      expect(del.status).to.equal(409);
      expect(del.body.error.message).to.equal(settings.message('templateInUse'));
    });

    it('the login code email cannot be switched off', async () => {
      const res = await api('patch', '/otp.code').send({ active: false });
      expect(res.status).to.equal(409);
      expect(res.body.error.message).to.equal(settings.message('templateMustStayActive'));
    });

    it('your own templates: create, use any placeholder, change, delete', async () => {
      const created = await api('post', '').send({ key: 'Newsletter.Welcome', subject: 'Welcome, {name}', text: 'Hello {name}, {anything}' });
      expect(created.status).to.equal(201);
      expect(created.body).to.include({ key: 'newsletter.welcome', system: false, variables: null });

      expect((await api('post', '').send({ key: 'newsletter.welcome', subject: 's', text: 't' })).status).to.equal(409);
      expect((await api('patch', '/newsletter.welcome').send({ text: 'Hi {whatever}' })).status).to.equal(200);
      expect((await api('delete', '/newsletter.welcome')).status).to.equal(204);
      expect((await api('get', '/newsletter.welcome')).status).to.equal(404);
    });

    it('400 for a bad key, an empty subject, an empty change', async () => {
      expect((await api('post', '').send({ key: 'has spaces', subject: 's', text: 't' })).status).to.equal(400);
      expect((await api('post', '').send({ key: 'ok.key', subject: '', text: 't' })).status).to.equal(400);
      expect((await api('patch', '/order.paid').send({})).status).to.equal(400);
      expect((await api('patch', '/order.paid').send({ key: 'renamed' })).status).to.equal(400); // nothing to change: key is not editable
    });

    it('only an admin: a manager gets 403, a guest 401', async () => {
      expect((await api('get', '', t.manager)).status).to.equal(403);
      expect((await api('patch', '/order.paid', t.manager).send({ subject: 'x' })).status).to.equal(403);
      expect((await request(app).get('/api/v1/email-templates')).status).to.equal(401);
    });
  });

  describe('EmailTemplate.send', () => {
    it('fills the placeholders; unknown ones stay visible', async () => {
      await EmailTemplate.send('order.cancelled', { to: 'ann@example.com', vars: { name: 'Ann', number: 'CB-1001', reason: 'you cancelled it' } });
      const [mail] = mailer.outbox;
      expect(mail.subject).to.equal('Order CB-1001 is cancelled');
      expect(mail.text).to.include('Hi Ann,').and.include('Order CB-1001 is cancelled: you cancelled it.').and.include('{orderUrl}');
    });

    it('creates a missing shop template on the fly, from its starting text', async () => {
      await EmailTemplateCollection.deleteMany({});
      expect(await EmailTemplate.send('order.paid', { to: 'ann@example.com', vars: { number: 'CB-7' } })).to.equal(true);
      expect(mailer.outbox[0].subject).to.equal('Payment received for order CB-7');
    });

    it('does not write to wiped accounts (.invalid addresses) and refuses an unknown key', async () => {
      expect(await EmailTemplate.send('order.paid', { to: 'deleted-1@deleted.invalid', vars: {} })).to.equal(false);
      expect(mailer.outbox).to.have.length(0);
      expect((await EmailTemplate.send('no.such', { to: 'ann@example.com' }).catch((e) => e)).message).to.include('No email template');
    });
  });
});
