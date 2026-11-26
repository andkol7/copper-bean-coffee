import { BaseController } from '../../lib/BaseController.js';
import { Customer } from './model.js';

// Read only: list and get. The card is more than the user record (stats, recent orders,
// addresses), so "the record" of GET /customers/:id is the profile the model puts together.
class CustomersController extends BaseController {
  async findRecord(req) {
    return this.Model.profile(req.params.id);
  }
}

export const customers = new CustomersController(Customer);
