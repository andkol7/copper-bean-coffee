import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { jobs, runJob } from '../src/jobs/index.js';
import { settings } from '../src/modules/settings/model.js';

// Runs one periodic job once and exits, for a scheduler outside the server:
//   npm run job                    lists the jobs
//   npm run job -- expire-orders   runs one
// For example a crontab line:  */5 * * * *  cd /app && npm run job -- expire-orders
// When something else runs the jobs like this, set RUN_JOBS=false for the server.
async function main(name) {
  if (!name) {
    console.log('Jobs:');
    for (const [jobName, job] of Object.entries(jobs)) console.log(`  ${jobName}  ${job.description}`);
    console.log('Run one with: npm run job -- <name>');
    return;
  }
  if (!Object.hasOwn(jobs, name)) await runJob(name); // throws the "unknown job" message, without touching the database

  await connectDb(config.MONGODB_URI);
  try {
    await settings.load(); // the same limits and numbers the server uses
    console.log(`${name}: ${await runJob(name)}`);
  } finally {
    await disconnectDb();
  }
}

// Runs only when started as `node scripts/job.js`, not when something imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
