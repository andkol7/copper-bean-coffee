import { Address as AddressCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { conflict, unauthorized } from '../../lib/errors.js';
import { settings } from '../settings/model.js';

// A customer's saved delivery address. Everybody works only with their own: the owner is always
// the logged-in user (never taken from the request body), and somebody else's address is a 404.
export class Address extends BaseModel {
  static schema = AddressCollection;
  static required = ['name', 'phone', 'line1', 'city', 'postalCode', 'country'];

  async create({ actor } = {}) {
    if (!actor) throw unauthorized();
    const { maxPerUser } = settings.addresses;
    if ((await Address.count({ user: actor.id })) >= maxPerUser) {
      throw conflict(settings.message('addressLimit', { max: maxPerUser }));
    }
    this.user = actor.id;
    return super.create();
  }

  // The list is the actor's own addresses.
  static listFilter(query, { actor } = {}) {
    return { user: actor.id };
  }

  // One address of the actor's, by id.
  static async findOwn(id, actor) {
    return this.findOne({ _id: id, user: actor.id });
  }
}
