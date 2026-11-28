import mongoose from 'mongoose';
import { BaseModel } from '../../lib/BaseModel.js';
import { escapeRegex } from '../../lib/validation.js';
import { settings } from '../settings/model.js';
import { RequestLogCollection } from './schema.js';

// The request log: one entry per API request (see middleware/requestLog.js, which writes them).
// Read by an admin at GET /api/v1/request-logs, or straight in the database (collection requestlogs).
export class RequestLog extends BaseModel {
  static schema = RequestLogCollection;

  // Writes one entry. Never throws: a log that cannot be written must not break the request it
  // describes (it has been answered already anyway).
  static async write(entry) {
    try {
      const keepDays = settings.requestLogs.keepDays;
      await this.schema.create({ ...entry, expiresAt: new Date(entry.at.getTime() + keepDays * 24 * 60 * 60_000) });
    } catch (err) {
      console.error('Could not write the request log:', err.message);
    }
  }

  // GET /api/v1/request-logs?status=5xx&path=/orders&user=...&from=...&to=...
  //   status: an exact code (404) or a class (4xx, 5xx); errors: every answer 400 and up
  static listFilter({ status, errors, method, path, user, from, to } = {}) {
    const filter = {};
    if (errors) filter.status = { $gte: 400 };
    if (status) {
      const kind = /^([1-5])xx$/.exec(status);
      filter.status = kind ? { $gte: Number(kind[1]) * 100, $lt: Number(kind[1]) * 100 + 100 } : Number(status);
    }
    if (method) filter.method = method.toUpperCase();
    if (path) filter.path = new RegExp(escapeRegex(path), 'i'); // a part of the path, as plain text
    if (user) filter.user = new mongoose.Types.ObjectId(user);
    if (from || to) {
      filter.at = {};
      if (from) filter.at.$gte = from;
      if (to) filter.at.$lte = to;
    }
    return filter;
  }

  // Newest first.
  static listOptions() {
    return { sort: { at: -1, _id: -1 } };
  }
}
