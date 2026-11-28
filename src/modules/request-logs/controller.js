import { BaseController } from '../../lib/BaseController.js';
import { RequestLog } from './model.js';

// Read only: GET /api/v1/request-logs (admin). Entries are written by middleware/requestLog.js.
export const requestLogs = new BaseController(RequestLog);
