import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- Setting ----------

// Shop settings an admin can change without a deploy (limits, email texts, messages).
// A single document with key 'main'; `values` keeps only what differs from the defaults
// in src/modules/settings/model.js, so a new default in code applies until someone overrides it.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  // minimize: false keeps `values: {}` instead of dropping the empty object.
  { timestamps: true, minimize: false },
);

settingSchema.plugin(toJSONPlugin);

export const SettingCollection = mongoose.model('Setting', settingSchema);
