import { BaseController } from '../../lib/BaseController.js';
import { ShippingMethod } from './model.js';

// Standard handlers only; the rules (who sees what, soft delete) are in the model.
export const shippingMethods = new BaseController(ShippingMethod);
