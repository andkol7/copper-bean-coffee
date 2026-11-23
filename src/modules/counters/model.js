import { Counter as CounterCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';

// Numbers that count up, for things people read out loud, like order CB-1042. MongoDB has no
// auto-increment, and neither "count the records + 1" nor "read the last number + 1" is safe:
// two requests at the same moment read the same value and get the same number.
//   const number = await Counter.next('order');   // 1, then 2, then 3...
export class Counter extends BaseModel {
  static schema = CounterCollection;

  // Adds one and returns the new value in a single atomic step, so two orders created at the
  // same moment never get the same number. The first call creates the counter (upsert).
  // A number that was taken but not used (the order failed after it) is simply skipped.
  static async next(name) {
    const counter = await this.updateOne({ _id: name }, { $inc: { seq: 1 } }, { upsert: true });
    return counter.seq;
  }
}
