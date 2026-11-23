import { BaseController } from '../../lib/BaseController.js';
import { Order } from './model.js';

// Standard handlers: create places an order, update changes its status (the rules are in the
// model). The only HTTP detail is who may see which order.
class OrdersController extends BaseController {
  async findRecord(req) {
    return this.Model.findFor(req.params.id, req.user);
  }
}

export const orders = new OrdersController(Order);
