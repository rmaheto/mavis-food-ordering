# mavis-food-ordering

Lightweight, mobile-friendly ordering and order-management website for a small food business.

This revision contains the persistence foundation only: a SQLite schema, a small
migration runner and plain data-access functions. It needs no hosting, CDN,
object storage or backup infrastructure.

## Local setup

Requires Node.js 18 or newer.

```
npm install
```

## Migrate a local database file

```
npm run migrate                 # creates/updates ./data/local.sqlite
npm run migrate -- path/to/file.sqlite
DATABASE_PATH=path/to/file.sqlite npm run migrate
```

Migrations are ordered SQL files in `db/migrations/`. Applied versions are
recorded in the `schema_migrations` table, so re-running is safe (idempotent).
Local database files are ignored by git.

## Run the tests

```
npm test
```

Tests use the built-in `node:test` runner against in-memory SQLite databases.

## Data model overview

- `category`: flat grouping (no hierarchy).
- `food_item`: name, description, ingredients, price in pence (GBP), availability,
  image reference, category, soft delete via `deleted_at`. Items referenced by
  order lines can never be hard-deleted.
- `customer_order`: unique order number, customer details, fulfilment method
  (`collection` or `delivery`; delivery requires address line, town/city and
  postcode), status (`pending_acceptance`, `confirmed`, `preparing`, `ready`,
  `completed`, `declined`) and total.
- `order_line`: snapshot of item name and unit price plus quantity, copied when
  the order is created and independent of later menu changes.
- `admin_user`: username and password hash (hashing is not handled here).
- `settings`: single row holding `accepting_orders`.
