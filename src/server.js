import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createApp } from './app.js';
import { settings } from './modules/settings/model.js';

async function main() {
  // Connect first: no point accepting requests the app cannot serve.
  const db = await connectDb(config.MONGODB_URI);
  console.log(`MongoDB connected (database "${db.name}")`);

  // Shop settings changed by an admin, laid over the defaults in modules/settings/model.js.
  await settings.load();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`Server listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });

  // Graceful shutdown: Ctrl+C locally, SIGTERM from Render on redeploy.
  // Stop taking new requests, let current ones finish, then close the database.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // If something hangs, do not wait forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
