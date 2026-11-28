import { BaseModel } from '../../lib/BaseModel.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { mailer } from '../../lib/mailer.js';
import { placeholders, render } from '../../lib/template.js';
import { settings } from '../settings/model.js';
import { EmailTemplateCollection } from './schema.js';

// The order emails all get the same variables (see Order in modules/orders).
const ORDER_VARIABLES = {
  name: "the customer's name",
  number: 'the order number, CB-1042',
  items: 'one line per product: "2 × Ethiopia Yirgacheffe  $29.00"',
  subtotal: 'the items, $29.00',
  shippingName: 'the shipping method, Standard',
  shippingPrice: 'the delivery price, $4.99 or "free"',
  total: 'what the customer pays, $33.99',
  address: 'the delivery address, several lines',
  orderUrl: 'a link to the order on the website',
};

// The emails the shop itself sends. They are created in the database the first time the server
// starts (ensureDefaults); from then on the database is the source: an admin edits them there, and
// the texts below are only the starting point. These can be changed or switched off, not deleted,
// and may use only their own variables, so a typo like {totl} is refused instead of reaching customers.
export const SYSTEM_TEMPLATES = {
  'otp.code': {
    description: 'The one-time login code (POST /api/v1/auth/otp)',
    variables: { name: "the user's name", code: 'the 6-digit code', ttlMinutes: 'minutes the code works' },
    mustStayActive: true, // without it nobody could log in with a code
    subject: 'Your Copper Bean login code: {code}',
    text: 'Hi {name},\n\nYour login code is {code}. It works once and expires in {ttlMinutes} minutes.\n\nIf you did not ask for it, just ignore this email.',
  },
  'order.created': {
    description: 'Sent when a customer places an order',
    variables: { ...ORDER_VARIABLES, payWithinMinutes: 'minutes before an unpaid order is cancelled' },
    subject: 'Order {number} is placed',
    text:
      'Hi {name},\n\nThank you for your order {number}.\n\n{items}\n\nItems: {subtotal}\nDelivery ({shippingName}): {shippingPrice}\nTotal: {total}\n\n' +
      'It will go to:\n{address}\n\nPlease pay within {payWithinMinutes} minutes, otherwise the order is cancelled and the items go back on sale. ' +
      'We will write again as soon as the payment arrives.\n\nYour order: {orderUrl}',
  },
  'order.paid': {
    description: 'Sent when the payment for an order arrives',
    variables: ORDER_VARIABLES,
    subject: 'Payment received for order {number}',
    text: 'Hi {name},\n\nWe have received {total} for order {number}. We are packing it now and will write when it is on its way.\n\nYour order: {orderUrl}',
  },
  'order.shipped': {
    description: 'Sent when an order is handed to the delivery service',
    variables: ORDER_VARIABLES,
    subject: 'Order {number} is on its way',
    text: 'Hi {name},\n\nOrder {number} has been sent by {shippingName} to:\n{address}\n\n{items}\n\nYour order: {orderUrl}',
  },
  'order.cancelled': {
    description: 'Sent when an order is cancelled: by the customer, by the shop, or because it was not paid in time',
    variables: { ...ORDER_VARIABLES, reason: 'why it was cancelled' },
    subject: 'Order {number} is cancelled',
    text: 'Hi {name},\n\nOrder {number} is cancelled: {reason}.\n\nNothing will be charged, and the items are back on sale. If this is a mistake, you are welcome to order again.\n\nYour order: {orderUrl}',
  },
};

// An email text with {placeholders}, found by key.
//   await EmailTemplate.send('order.paid', { to: 'ann@example.com', vars: { name: 'Ann', ... } })
export class EmailTemplate extends BaseModel {
  static schema = EmailTemplateCollection;
  static required = ['key', 'subject', 'text'];

  get definition() {
    return SYSTEM_TEMPLATES[this.key];
  }

  // The API shows, with each template, whether the shop uses it and which variables it can use.
  toJSON() {
    const json = super.toJSON();
    const definition = SYSTEM_TEMPLATES[json.key];
    return { ...json, system: Boolean(definition), variables: definition?.variables ?? null };
  }

  async create(options) {
    this.key = this.key?.trim().toLowerCase();
    return super.create(options);
  }

  async update(changes, options) {
    const definition = this.definition;
    if (definition) {
      if (definition.mustStayActive && changes.active === false) throw conflict(settings.message('templateMustStayActive'));
      EmailTemplate.checkPlaceholders(definition, `${changes.subject ?? this.subject}\n${changes.text ?? this.text}`);
    }
    return super.update(changes, options);
  }

  async delete(options) {
    if (this.definition) throw conflict(settings.message('templateInUse'));
    return super.delete(options);
  }

  // A shop email may only use its own variables: anything else would reach customers as "{totl}".
  static checkPlaceholders(definition, text) {
    const unknown = placeholders(text).filter((name) => !(name in definition.variables));
    if (unknown.length) {
      const list = (names) => names.map((n) => `{${n}}`).join(', ');
      throw badRequest(settings.message('templateUnknownPlaceholders', { unknown: list(unknown), allowed: list(Object.keys(definition.variables)) }));
    }
  }

  // Creates the shop's templates that are not in the database yet; never changes existing ones.
  // server.js calls it at startup, so an admin sees all of them in the list from day one.
  static async ensureDefaults() {
    for (const [key, { description, subject, text }] of Object.entries(SYSTEM_TEMPLATES)) {
      await this.updateOne({ key }, { $setOnInsert: { key, description, subject, text, active: true } }, { upsert: true });
    }
  }

  // Sends one email from a template. Returns false when it was not sent on purpose: the template is
  // switched off, or the address cannot receive mail (a wiped account, see User.delete).
  static async send(key, { to, vars = {} }) {
    if (!to || to.endsWith('.invalid')) return false;

    let template = await this.findOne({ key }, { required: false });
    if (!template && SYSTEM_TEMPLATES[key]) {
      await this.ensureDefaults(); // a fresh database: the server was not started yet (tests, scripts)
      template = await this.findOne({ key });
    }
    if (!template) throw new Error(`No email template "${key}"`);
    if (!template.active) return false;

    await mailer.send({ to, subject: render(template.subject, vars), text: render(template.text, vars) });
    return true;
  }

  // GET /api/v1/email-templates: the shop's own first, then the rest, by key.
  static listOptions() {
    return { sort: { key: 1 } };
  }
}
