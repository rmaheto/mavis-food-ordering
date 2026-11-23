-- Initial schema: categories, food items, orders, order lines, admin users, settings.
-- Money is stored as integer pence in GBP.

CREATE TABLE category (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE food_item (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER REFERENCES category (id) ON DELETE RESTRICT,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description  TEXT NOT NULL DEFAULT '',
  ingredients  TEXT NOT NULL DEFAULT '',
  price_pence  INTEGER NOT NULL CHECK (typeof(price_pence) = 'integer' AND price_pence >= 0),
  currency     TEXT NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP'),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  image_ref    TEXT,
  deleted_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_food_item_category ON food_item (category_id);

CREATE TABLE customer_order (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number          TEXT NOT NULL UNIQUE CHECK (length(trim(order_number)) > 0),
  customer_name         TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
  phone                 TEXT NOT NULL CHECK (length(trim(phone)) > 0),
  email                 TEXT,
  fulfilment_method     TEXT NOT NULL CHECK (fulfilment_method IN ('collection', 'delivery')),
  delivery_address_line TEXT,
  delivery_town_city    TEXT,
  delivery_postcode     TEXT,
  instructions          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending_acceptance'
    CHECK (status IN ('pending_acceptance', 'confirmed', 'preparing', 'ready', 'completed', 'declined')),
  total_pence           INTEGER NOT NULL CHECK (typeof(total_pence) = 'integer' AND total_pence >= 0),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    fulfilment_method = 'collection'
    OR (
      delivery_address_line IS NOT NULL AND length(trim(delivery_address_line)) > 0
      AND delivery_town_city IS NOT NULL AND length(trim(delivery_town_city)) > 0
      AND delivery_postcode IS NOT NULL AND length(trim(delivery_postcode)) > 0
    )
  )
);

CREATE INDEX idx_customer_order_status ON customer_order (status);
CREATE INDEX idx_customer_order_created ON customer_order (created_at);

CREATE TABLE order_line (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
  food_item_id     INTEGER NOT NULL REFERENCES food_item (id) ON DELETE RESTRICT,
  item_name        TEXT NOT NULL CHECK (length(trim(item_name)) > 0),
  unit_price_pence INTEGER NOT NULL CHECK (typeof(unit_price_pence) = 'integer' AND unit_price_pence >= 0),
  quantity         INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0)
);

CREATE INDEX idx_order_line_order ON order_line (order_id);
CREATE INDEX idx_order_line_food_item ON order_line (food_item_id);

-- Food items referenced by orders must never be hard-deleted (R32).
CREATE TRIGGER food_item_no_hard_delete_when_ordered
BEFORE DELETE ON food_item
WHEN EXISTS (SELECT 1 FROM order_line WHERE food_item_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'food_item is referenced by order lines and cannot be deleted; mark unavailable or soft-delete instead');
END;

-- Order line snapshots are immutable once written (R39).
CREATE TRIGGER order_line_snapshot_immutable
BEFORE UPDATE OF food_item_id, item_name, unit_price_pence, quantity ON order_line
BEGIN
  SELECT RAISE(ABORT, 'order_line snapshot columns are immutable');
END;

CREATE TABLE admin_user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0, 1)),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO settings (id, accepting_orders) VALUES (1, 1);
