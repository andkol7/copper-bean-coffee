import { BaseController } from '../../lib/BaseController.js';
import { EmailTemplate } from './model.js';

// Standard CRUD; the only HTTP detail: a template is addressed by its key, /email-templates/order.paid.
class EmailTemplatesController extends BaseController {
  async findRecord(req) {
    return this.Model.findOne({ key: req.params.key.toLowerCase() });
  }
}

export const emailTemplates = new EmailTemplatesController(EmailTemplate);
