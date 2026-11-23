import { BaseController } from '../../lib/BaseController.js';
import { Address } from './model.js';

// Standard handlers; the only difference is where the record comes from: the caller's own
// addresses, not any address by id.
class AddressesController extends BaseController {
  async findRecord(req) {
    return this.Model.findOwn(req.params.id, req.user);
  }
}

export const addresses = new AddressesController(Address);
