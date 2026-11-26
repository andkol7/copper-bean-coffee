import { BaseController } from '../../lib/BaseController.js';
import { Product } from './model.js';

// All standard handlers (list, get, create, update, remove). The only HTTP detail: a product in
// the URL may be its id or its slug, for reading and for changing alike:
//   /api/v1/products/ethiopia-yirgacheffe   or   /api/v1/products/6b0201ec5e9b826df8fd2213
class ProductsController extends BaseController {
  async findRecord(req) {
    return this.Model.findByIdOrSlug(req.params.idOrSlug, req.user);
  }
}

export const products = new ProductsController(Product);
