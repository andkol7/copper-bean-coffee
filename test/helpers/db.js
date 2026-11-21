import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../../src/db.js';

// Each test file gets its own throwaway MongoDB in memory, so tests never touch Atlas
// and can run in parallel without seeing each other's data.
let mongod;

export async function startDb() {
  // The default 10 s start limit is too tight on Windows when the antivirus scans mongod.
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 30_000 } });
  await connectDb(mongod.getUri());
}

export async function stopDb() {
  await disconnectDb();
  await mongod?.stop();
}
