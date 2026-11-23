import { Order } from '../modules/orders/model.js';
import { settings } from '../modules/settings/model.js';

// The periodic jobs: work that has to happen from time to time without anybody asking for it.
// A job is only WHAT to do and how often; it does not know who runs it. Two things can:
//   - the server itself, on a timer (src/jobs/scheduler.js, see RUN_JOBS in .env), which suits
//     one small instance such as the demo on Render;
//   - anything outside: cron, a Render Cron Job, GitHub Actions, with `npm run job -- <name>`
//     (scripts/job.js). Then set RUN_JOBS=false so the server does not do the same work too.
// A job must be safe to run twice, or at the same time as another copy of itself. The logic
// itself belongs in the models, as everywhere else; a job is a thin wrapper around it.
export const jobs = {
  'expire-orders': {
    description: 'Cancels orders that were not paid in time and puts their stock back on the shelf',
    // Read when the scheduler starts.
    everyMinutes: () => settings.orders.sweepMinutes,
    // Returns how many orders were cancelled.
    run: () => Order.cancelExpired(),
  },
};

// Runs one job by name and returns what it returns.
export async function runJob(name, list = jobs) {
  if (!Object.hasOwn(list, name)) {
    throw new Error(`Unknown job "${name}". Known jobs: ${Object.keys(list).join(', ')}`);
  }
  return list[name].run();
}
