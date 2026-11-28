import 'dotenv/config';
import { z } from 'zod';

// Used only when JWT_SECRET is not set outside production, so the app starts locally without setup.
const DEV_SECRET = 'dev-only-secret-do-not-use-in-production-0000';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/demo-store'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default(DEV_SECRET),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  // Used only by `npm run seed`, to create the first admin.
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  // Run the periodic jobs (src/jobs) inside the server process. Right for one small instance,
  // like the demo on Render. Set false when something else runs `npm run job` on a schedule.
  RUN_JOBS: z.stringbool().default(true),
  // Where the website is, for links in emails ("see your order"). On Render: the demo's address.
  APP_URL: z.url().default('http://localhost:3000').transform((url) => url.replace(/\/+$/, '')),
  // Email through Resend (resend.com). Without a key: printed in the terminal in development,
  // refused in production. MAIL_FROM must be on a domain verified in Resend.
  RESEND_API_KEY: z.string().startsWith('re_', 'RESEND_API_KEY starts with re_').optional(),
  MAIL_FROM: z.string().optional(),
});

const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
const parsed = schema.safeParse(env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === DEV_SECRET) {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

if (parsed.data.RESEND_API_KEY && !parsed.data.MAIL_FROM) {
  console.error('RESEND_API_KEY is set but MAIL_FROM is not: say who the emails come from, e.g. "Copper Bean Coffee <login@mail.example.com>".');
  process.exit(1);
}

export const config = parsed.data;
