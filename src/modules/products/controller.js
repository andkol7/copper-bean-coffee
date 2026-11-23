import { BaseController } from '../../lib/BaseController.js';
import { Product } from './model.js';

// All standard handlers (list, get, create, update, remove). The only HTTP detail: the shop
// finds a product by slug (GET /products/:slug), the CRM routes that change it use the id.
class ProductsController extends BaseController {
  async findRecord(req) {
    const { slug, id } = req.params;
    if (id) return this.Model.findById(id);

    // Customers get a 404 for a hidden product, as if it did not exist; staff can open it.
    const filter = { slug: slug.toLowerCase() };
    if (!req.user?.isStaff) filter.active = true;
    return this.Model.findOne(filter);
  }
}

export const products = new ProductsController(Product);
