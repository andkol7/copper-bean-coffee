import { jobs } from './index.js';

// Runs every job from src/jobs on a timer inside this process. Each job runs once right away
// (to catch up after the server was asleep or down) and then every job.everyMinutes().
// Returns a function that stops the timers.
//
// A job that is still running when its next turn comes is skipped, so slow runs do not pile up.
// A job that fails is logged and tried again next time; it never takes the server down.
// The timers are unref'd: they never keep the process alive on their own.
export function startScheduler({ list = jobs, log = console } = {}) {
  const running = new Set();
  const timers = [];

  const tick = async (name, job) => {
    if (running.has(name)) return;
    running.add(name);
    try {
      const result = await job.run();
      if (result) log.log(`Job ${name}: ${result}`); // quiet when there was nothing to do
    } catch (err) {
      log.error(`Job ${name} failed: ${err.message}`);
    } finally {
      running.delete(name);
    }
  };

  for (const [name, job] of Object.entries(list)) {
    tick(name, job);
    timers.push(setInterval(() => tick(name, job), job.everyMinutes() * 60_000).unref());
  }

  return () => timers.forEach(clearInterval);
}
