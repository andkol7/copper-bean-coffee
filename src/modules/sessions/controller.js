import { BaseController } from '../../lib/BaseController.js';
import { Session } from './model.js';

// Logging in and refreshing are a standard create (POST /api/v1/auth/sessions → sessions.create).
export const sessions = new BaseController(Session);
