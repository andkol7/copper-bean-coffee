import { paginationQuery } from './validation.js';

// Standard REST handlers on top of a BaseModel class. The logic lives in the model; a module
// extends this class only for HTTP details, e.g. where the record comes from:
//
//   class MeController extends BaseController {
//     findRecord(req) { return req.user; }   // /users/me instead of /users/:id
//   }
//
// What a request may contain is declared in routes.js (`validate`), and the checked data
// arrives here as req.valid. Models never see req or res; they get the checked data and
// { actor } - the logged-in user, if any - so rules like "an admin cannot delete themselves"
// can live in the model.
export class BaseController {
  constructor(Model) {
    this.Model = Model; // the record class, e.g. Product
    // routes.js passes methods around on their own (handler: products.list), and a method
    // taken off its object loses `this`. Binding them all here makes that safe for every
    // subclass too, so subclasses never have to think about it. Async methods are also
    // wrapped in try/catch (see wrap), so no handler needs its own.
    bindMethods(this);
  }

  // The one try/catch for every async method of every controller.
  // Called by Express (req, res, next): the error goes to next(), i.e. to the error handler.
  // Called from our own code (a helper like loadOrder(id)): the error is thrown back to the caller.
  // The error is tagged with "Controller.method", so a 500 in the server log says where it happened.
  wrap(name, method) {
    const where = `${this.constructor.name}.${name}`;
    return async (...args) => {
      try {
        return await method.apply(this, args);
      } catch (err) {
        if (err && typeof err === 'object') err.where ??= where;
        const next = args[2];
        if (typeof next !== 'function') throw err;
        next(err);
      }
    };
  }

  // The list filter comes from the model (static listFilter), built from the checked query
  // and the actor, e.g. "customers see only their own orders".
  listFilter(req) {
    return this.Model.listFilter(req.valid?.query ?? {}, { actor: req.user });
  }

  // The record a request is about. By default the :id in the URL; override for other sources.
  async findRecord(req) {
    return this.Model.findById(req.params.id);
  }

  async list(req, res) {
    // Pagination is the same for every list, so it is checked here, not in each route.
    const { page, limit } = paginationQuery.parse(req.query);
    const options = this.Model.listOptions(req.valid?.query ?? {}, { actor: req.user });
    res.json(await this.Model.list(this.listFilter(req), { ...options, page, limit }));
  }

  async get(req, res) {
    res.json(await this.findRecord(req));
  }

  // The response is whatever the record's create() returns: the saved record by default,
  // or something else when a model decides so (Otp answers with a neutral message).
  async create(req, res) {
    const record = new this.Model(validBody(req));
    res.status(201).json(await record.create({ actor: req.user }));
  }

  async update(req, res) {
    const record = await this.findRecord(req);
    res.json(await record.update(validBody(req), { actor: req.user }));
  }

  async remove(req, res) {
    const record = await this.findRecord(req);
    await record.delete({ actor: req.user });
    res.status(204).end();
  }
}

// Writes only accept a body that the route checked. A route without `validate.body` is a bug,
// not a reason to trust the client, so it fails instead of saving whatever was sent.
function validBody(req) {
  if (!req.valid?.body) throw new Error(`${req.method} ${req.path}: route has no validate.body`);
  return req.valid.body;
}

// Binds every method of the object's class and its parent classes to the object itself;
// async methods (handlers and async helpers) are wrapped with obj.wrap on the way.
// Sync methods such as listFilter only get bound: wrapping would turn their result into a Promise.
function bindMethods(obj) {
  for (let proto = Object.getPrototypeOf(obj); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || Object.hasOwn(obj, name)) continue; // the subclass version wins
      const { value } = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof value !== 'function') continue;
      obj[name] = value.constructor.name === 'AsyncFunction' ? obj.wrap(name, value) : value.bind(obj);
    }
  }
}
