import { BaseController } from '../../lib/BaseController.js';
import { Otp } from './model.js';

// Requesting a code is a standard create (POST /api/v1/auth/otp → otp.create); all the logic,
// including sending the email, is in the model. Code verification will be a custom method here.
export const otp = new BaseController(Otp);
