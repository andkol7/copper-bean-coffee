import { HttpError, notFound } from './errors.js';

// Marks "built from a database document", which skips the required-fields check
// (a loaded user has no plain password, for example).
const FROM_DB = Symbol('fromDb');

// Base class for records. An instance is one record: its fields are plain properties
// (user.email, otp.expiresAt), and methods act on that record. Finding records is static and
// returns instances.
//
//   export class Product extends BaseModel {
//     static schema = ProductCollection;            // the Mongoose model from src/db.js
//     static required = ['name', 'slug', 'priceCents'];
//     async delete() { return this.update({ active: false }); }  // soft delete
//   }
//
//   const product = await new Product({ name, slug, priceCents }).create();
//   const same = await Product.findById(product.id);
export class BaseModel {
  static schema; // set by every subclass
  static required = []; // fields the constructor insists on

  #doc = null; // the Mongoose document this record was loaded from, if any

  constructor(data = {}, source) {
    if (source !== FROM_DB) {
      const missing = this.constructor.required.filter((field) => data[field] == null);
      if (missing.length) {
        throw new HttpError(400, 'bad_request', `Missing required fields: ${missing.join(', ')}`, missing);
      }
    }
    Object.assign(this, data);
  }

  // ---------- One record ----------

  // Methods that change data take an options object; { actor } is the logged-in user who acts
  // (from BaseController), for rules like "an admin cannot delete themselves". The base ignores it.

  // Saves a new record from this instance's fields; afterwards the instance has id, createdAt...
  async create(options = {}) {
    this.#load(await this.constructor.schema.create({ ...this }));
    return this;
  }

  // Changes only the given fields. runValidators: Mongoose skips schema checks on updates by default.
  async update(changes, options = {}) {
    const doc = await this.constructor.schema.findOneAndUpdate(
      { _id: this.id },
      { $set: changes },
      { new: true, runValidators: true },
    );
    if (!doc) throw notFound(this.constructor.schema.modelName);
    this.#load(doc);
    return this;
  }

  // Hard delete; returns true if this call deleted it. With required: false a record that is
  // already gone gives false instead of 404, which also settles races (see Otp.verify).
  // Records that must keep history (products, orders) override this with a soft delete.
  async delete({ required = true } = {}) {
    const doc = await this.constructor.schema.findByIdAndDelete(this.id);
    if (!doc && required) throw notFound(this.constructor.schema.modelName);
    return doc !== null;
  }

  // What res.json() sends. A loaded record uses the schema's toJSON (id instead of _id,
  // hidden fields such as passwordHash removed).
  toJSON() {
    return this.#doc ? this.#doc.toJSON() : { ...this };
  }

  // Replaces this instance's fields with the document's.
  #load(doc) {
    this.#doc = doc;
    for (const key of Object.keys(this)) delete this[key];
    const { _id, __v, ...fields } = doc.toObject();
    Object.assign(this, fields, { id: String(_id) });
  }

  // ---------- Finding (static, return instances) ----------

  static fromDoc(doc) {
    if (!doc) return null;
    const record = new this({}, FROM_DB);
    record.#load(doc);
    return record;
  }

  // Options for findById and findOne:
  //   required - true (default): nothing found means 404 "Product not found";
  //              false: nothing found means null, for questions like "is this email taken?"
  //   select   - extra fields to load or skip, e.g. '+passwordHash' for login
  // A malformed id gives a Mongoose CastError, which the error handler turns into 400.
  static async findById(id, options) {
    return this.findOne({ _id: id }, options);
  }

  static async findOne(filter, { required = true, select } = {}) {
    const query = this.schema.findOne(filter);
    if (select) query.select(select);
    const doc = await query;
    if (!doc && required) throw notFound(this.schema.modelName);
    return this.fromDoc(doc);
  }

  // The database filter for a list request, from the checked query (?role=...&q=...) and the
  // actor. Everything by default; models override it, e.g. "customers see only their own orders".
  static listFilter(query, { actor } = {}) {
    return {};
  }

  // One page of records plus the numbers a client needs to draw pagination.
  // _id breaks ties between records created in the same millisecond; without it the
  // order is undefined and a record can show up on two pages or on none.
  static async list(filter = {}, { page = 1, limit = 20, sort = { createdAt: -1, _id: -1 } } = {}) {
    const [docs, total] = await Promise.all([
      this.schema
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit),
      this.schema.countDocuments(filter),
    ]);
    return { items: docs.map((doc) => this.fromDoc(doc)), page, limit, total, pages: Math.ceil(total / limit) };
  }

  // Finds one record and applies a MongoDB update ($set, $inc...) in a single atomic step.
  // Atomic matters for counters: two parallel requests cannot both read "attempts: 4" and
  // both get a fifth try.
  // Deletes every record matching the filter; returns how many were deleted.
  static async deleteMany(filter) {
    const { deletedCount } = await this.schema.deleteMany(filter);
    return deletedCount;
  }

  // upsert: true creates the record if nothing matches the filter.
  static async updateOne(filter, update, { required = true, upsert = false } = {}) {
    const doc = await this.schema.findOneAndUpdate(filter, update, { new: true, runValidators: true, upsert });
    if (!doc && required) throw notFound(this.schema.modelName);
    return this.fromDoc(doc);
  }
}
