import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- RequestLog ----------

// One document per API request: what was asked, how it ended and how long it took. Bodies are NOT
// kept (passwords, codes and tokens travel in them). Old entries go by themselves (TTL on expiresAt,
// which is set from settings.requestLogs.keepDays when the entry is written).
const requestLogSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true }, // as requested: /api/v1/orders/6b02...
    route: { type: String }, // the route it matched: /api/v1/orders/:id (handy for grouping)
    query: { type: mongoose.Schema.Types.Mixed }, // ?page=2&q=... as an object
    status: { type: Number, required: true },
    ms: { type: Number, required: true }, // how long the server took
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // empty for guests
    role: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    // For answers 400 and up: the error code and message the client got, and for a 500 the place
    // in the code it came from (BaseController's "Controller.method").
    error: { code: String, message: String, where: String },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { versionKey: false },
);

// The usual questions: the latest requests, the latest errors, one user's requests, one route.
requestLogSchema.index({ at: -1 });
requestLogSchema.index({ status: 1, at: -1 });
requestLogSchema.index({ user: 1, at: -1 });
requestLogSchema.index({ route: 1, at: -1 });

requestLogSchema.plugin(toJSONPlugin, { hide: ['expiresAt'] });

export const RequestLogCollection = mongoose.model('RequestLog', requestLogSchema);
