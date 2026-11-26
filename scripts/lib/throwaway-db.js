import mongoose from 'mongoose';

// For the end-to-end checks (scripts/smoke.js, scripts/ui-check.js): a throwaway database next to the
// one in .env, on the same server (Atlas or local), so a check never touches real data.
//   .env:  mongodb+srv://user:pass@cluster/demo-store?retryWrites=true
//   check: mongodb+srv://user:pass@cluster/demo-store-smoke?retryWrites=true
// The connection string is never printed: it holds the password.
export function throwawayUri(baseUri, suffix) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)\/?([^?]*)(\?.*)?$/.exec(baseUri ?? '');
  if (!match) throw new Error('MONGODB_URI in .env does not look like a MongoDB connection string');
  const [, server, database, options = ''] = match;
  const name = `${database || 'demo-store'}-${suffix}`;
  return { uri: `${server}/${name}${options}`, name };
}

// Drops the database, but only if it really is the throwaway one: a last guard against a mistake.
export async function dropThrowaway({ uri, name }) {
  if (!name.endsWith('-smoke') && !name.endsWith('-ui-check')) throw new Error(`Refusing to drop "${name}"`);
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15_000 }).asPromise();
  try {
    if (connection.name !== name) throw new Error(`Connected to "${connection.name}", not "${name}"; not dropping anything`);
    await connection.dropDatabase();
  } finally {
    await connection.close();
  }
}
