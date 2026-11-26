# Copper Bean Coffee

A demo online store for a fictional coffee shop, built end to end as a portfolio project: a REST API with
authentication, a product catalogue, orders with stock reservation, and a small CRM. Stripe payments,
Telegram bots and an AI assistant come in the next phases.

**Status:** phase 1 of 6 (the API core) is done. This README covers running it locally; a full README with
an architecture diagram comes with the release.

## What is inside

- **Auth:** password login and one-time codes by email; short-lived JWT access tokens and rotating refresh
  tokens with reuse detection; roles `customer`, `manager`, `admin`.
- **Protection:** per-IP rate limits, a per-email lock after repeated wrong passwords (email codes still
  work, so attackers cannot lock users out), answers that never reveal whether an account exists.
- **Shop:** products with full-text search, filters and sorting; shipping methods with free-delivery
  thresholds and countries; saved addresses.
- **Orders:** prices and totals worked out on the server, atomic stock reservation with rollback, order
  numbers like `CB-1042`, a status state machine, unpaid orders cancelled automatically.
- **CRM:** customers with order statistics (one MongoDB aggregation), user management, safe user deletion
  (personal data wiped when the account has orders).
- **API docs:** Swagger UI at `/docs`, generated from the route list, so the docs match the code.
- **Tests:** about 270 tests on a real in-memory MongoDB, including parallel-request races.

## Stack

Node.js 20, Express 5, MongoDB with Mongoose 8, zod 4, JSON Web Tokens, bcrypt, Swagger UI.
Tests: Mocha, Chai, Supertest, mongodb-memory-server.

## Run it locally

You need Node.js 20 or newer and a MongoDB database: a local one, or a free cluster on
[MongoDB Atlas](https://www.mongodb.com/atlas).

```bash
npm install
cp .env.example .env    # then fill in .env, see below
npm run seed            # an admin, a demo customer, products and shipping methods
npm run dev             # http://localhost:3000
```

Open **http://localhost:3000/docs** to try the API in the browser.

### Settings in `.env`

| Variable | What it is |
|---|---|
| `MONGODB_URI` | The database, e.g. `mongodb://127.0.0.1:27017/demo-store` or an Atlas connection string |
| `JWT_SECRET` | At least 32 random characters; `.env.example` shows a command that makes one |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | The admin account `npm run seed` creates |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_DAYS` | Token lifetimes (15 minutes and 7 days by default) |
| `RUN_JOBS` | `true`: the server runs the periodic jobs itself; `false` when cron runs `npm run job` |
| `PORT`, `NODE_ENV` | The usual |

Login codes are not emailed locally: the server prints each email in its terminal.

### Trying it out

1. In `/docs`, call `POST /api/v1/auth/sessions` with the demo customer
   `{ "email": "demo@copperbean.test", "password": "demo-password-123" }` or with your admin.
2. Copy `accessToken` from the answer, press **Authorize** and paste it.
3. Save an address (`POST /api/v1/addresses`), pick a product and a shipping method, and place an order
   (`POST /api/v1/orders`). As the admin, move it on with `PATCH /api/v1/orders/{id}`.

Money is always in cents as whole numbers: `1450` means $14.50.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the server and restarts it when a file changes |
| `npm start` | Starts the server |
| `npm test` | Runs all tests on a throwaway in-memory MongoDB (your database is not touched) |
| `npm run seed` | Adds the starting data; safe to run again, never overwrites what is there |
| `npm run job` | Lists the periodic jobs; `npm run job -- expire-orders` runs one, e.g. from cron |

## How the code is organised

```
src/
  routes.js          every route of the API, one per line: method, path, rate limit, who may call it,
                     and the zod schemas that check the request
  router.js          turns that list into Express routes and refuses a broken list at startup
  modules/<name>/    one folder per area: schema.js (MongoDB), model.js (the logic),
                     controller.js (thin HTTP layer), schemas.js (request validation)
  lib/               base model and controller classes, errors, validation pieces, mailer
  middleware/        auth, rate limits, validation, errors
  jobs/              periodic jobs and the in-server scheduler
  docs/              the OpenAPI description, built from routes.js
scripts/             seed.js, job.js
test/                one file per area
```

The business rules live in the models, not in controllers or routes, so the same code serves the API,
the scripts and, later, the Telegram bot. Shop texts and limits (email templates, rate limits, how long
an unpaid order waits) are settings with defaults in code that an admin can override.

## Not in scope

Taxes are not calculated: prices are final prices. A real shop would use a tax service such as
Stripe Tax. Payments run in Stripe's test mode only, starting from phase 2.
