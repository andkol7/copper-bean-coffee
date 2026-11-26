import mongoose from 'mongoose';

// Connecting to MongoDB and what all schemas share. Each module keeps its own schema in
// src/modules/<name>/schema.js.

// ---------- Connection ----------

export async function connectDb(uri) {
  // Fail after 10 s instead of hanging if the database cannot be reached.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

// ---------- Shared by every schema ----------

// API responses show `id` instead of `_id` and leave out Mongoose's internal `__v`.
// `hide` lists fields that must never leave the server, e.g. a password hash.
export function toJSONPlugin(schema, { hide = [] } = {}) {
  schema.set('toJSON', {
    versionKey: false,
    transform(doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const field of hide) delete ret[field];
      return ret;
    },
  });
}
