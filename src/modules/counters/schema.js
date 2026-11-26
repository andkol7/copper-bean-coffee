import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- Counter ----------

// Numbers that count up: one document per sequence, `_id` is its name ('order') and `seq` the
// last number given out. See modules/counters.
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

export const CounterCollection = mongoose.model('Counter', counterSchema);
