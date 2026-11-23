export const ORDER_STATUSES = Object.freeze([
  'pending_acceptance',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'declined',
]);

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function toFoodItem(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    ingredients: row.ingredients,
    pricePence: row.price_pence,
    currency: row.currency,
    isAvailable: row.is_available === 1,
    imageRef: row.image_ref,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCategory(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrder(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    fulfilmentMethod: row.fulfilment_method,
    deliveryAddressLine: row.delivery_address_line,
    deliveryTownCity: row.delivery_town_city,
    deliveryPostcode: row.delivery_postcode,
    instructions: row.instructions,
    status: row.status,
    totalPence: row.total_pence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrderLine(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    foodItemId: row.food_item_id,
    itemName: row.item_name,
    unitPricePence: row.unit_price_pence,
    quantity: row.quantity,
  };
}

function toAdminUser(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FOOD_ITEM_UPDATABLE = {
  categoryId: 'category_id',
  name: 'name',
  description: 'description',
  ingredients: 'ingredients',
  pricePence: 'price_pence',
  imageRef: 'image_ref',
};

/**
 * Plain data-access functions over a better-sqlite3 database.
 * There is deliberately no hard-delete function for food items.
 */
export function createRepositories(db) {
  // ---- categories ----
  function createCategory({ name, sortOrder = 0 }) {
    const info = db
      .prepare('INSERT INTO category (name, sort_order) VALUES (?, ?)')
      .run(name, sortOrder);
    return getCategory(Number(info.lastInsertRowid));
  }

  function getCategory(id) {
    return toCategory(db.prepare('SELECT * FROM category WHERE id = ?').get(id));
  }

  function listCategories() {
    return db
      .prepare('SELECT * FROM category ORDER BY sort_order, name')
      .all()
      .map(toCategory);
  }

  // ---- food items ----
  function createFoodItem({
    categoryId = null,
    name,
    description = '',
    ingredients = '',
    pricePence,
    isAvailable = true,
    imageRef = null,
  }) {
    const info = db
      .prepare(
        `INSERT INTO food_item
           (category_id, name, description, ingredients, price_pence, is_available, image_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(categoryId, name, description, ingredients, pricePence, isAvailable ? 1 : 0, imageRef);
    return getFoodItem(Number(info.lastInsertRowid));
  }

  function getFoodItem(id) {
    return toFoodItem(db.prepare('SELECT * FROM food_item WHERE id = ?').get(id));
  }

  function updateFoodItem(id, changes) {
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(FOOD_ITEM_UPDATABLE)) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        sets.push(`${column} = ?`);
        values.push(changes[key]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'isAvailable')) {
      sets.push('is_available = ?');
      values.push(changes.isAvailable ? 1 : 0);
    }
    if (sets.length === 0) return getFoodItem(id);
    sets.push(`updated_at = ${NOW}`);
    db.prepare(`UPDATE food_item SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    return getFoodItem(id);
  }

  function setAvailability(id, isAvailable) {
    return updateFoodItem(id, { isAvailable });
  }

  function softDeleteFoodItem(id) {
    db.prepare(
      `UPDATE food_item SET deleted_at = COALESCE(deleted_at, ${NOW}), updated_at = ${NOW} WHERE id = ?`,
    ).run(id);
    return getFoodItem(id);
  }

  function listFoodItems({ includeDeleted = false, onlyAvailable = false, categoryId } = {}) {
    const where = [];
    const params = [];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (onlyAvailable) where.push('is_available = 1');
    if (categoryId !== undefined) {
      where.push('category_id = ?');
      params.push(categoryId);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db
      .prepare(`SELECT * FROM food_item ${clause} ORDER BY name, id`)
      .all(...params)
      .map(toFoodItem);
  }

  // ---- orders ----
  function nextOrderNumber() {
    const { next } = db
      .prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM customer_order')
      .get();
    return `ORD-${String(next).padStart(6, '0')}`;
  }

  /**
   * Create an order and its lines in one transaction. Item name and unit price
   * are copied from food_item into order_line at this moment (snapshot);
   * the total is the sum of snapshot price x quantity.
   * lines: [{ foodItemId, quantity }]
   */
  const createOrderWithLines = (order, lines) =>
    db.transaction(() => {
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error('An order requires at least one line');
      }
      const getItem = db.prepare('SELECT id, name, price_pence FROM food_item WHERE id = ?');
      const snapshots = lines.map((line) => {
        const item = getItem.get(line.foodItemId);
        if (!item) throw new Error(`Food item ${line.foodItemId} does not exist`);
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
          throw new Error('Quantity must be a positive integer');
        }
        return {
          foodItemId: item.id,
          itemName: item.name,
          unitPricePence: item.price_pence,
          quantity: line.quantity,
        };
      });
      const total = snapshots.reduce((sum, l) => sum + l.unitPricePence * l.quantity, 0);
      const orderNumber = order.orderNumber || nextOrderNumber();
      const info = db
        .prepare(
          `INSERT INTO customer_order
             (order_number, customer_name, phone, email, fulfilment_method,
              delivery_address_line, delivery_town_city, delivery_postcode,
              instructions, total_pence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          orderNumber,
          order.customerName,
          order.phone,
          order.email ?? null,
          order.fulfilmentMethod,
          order.deliveryAddressLine ?? null,
          order.deliveryTownCity ?? null,
          order.deliveryPostcode ?? null,
          order.instructions ?? null,
          total,
        );
      const orderId = Number(info.lastInsertRowid);
      const insertLine = db.prepare(
        `INSERT INTO order_line (order_id, food_item_id, item_name, unit_price_pence, quantity)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const l of snapshots) {
        insertLine.run(orderId, l.foodItemId, l.itemName, l.unitPricePence, l.quantity);
      }
      return getOrderWithLines(orderId);
    })();

  function getOrderWithLines(id) {
    const order = toOrder(db.prepare('SELECT * FROM customer_order WHERE id = ?').get(id));
    if (!order) return undefined;
    order.lines = db
      .prepare('SELECT * FROM order_line WHERE order_id = ? ORDER BY id')
      .all(id)
      .map(toOrderLine);
    return order;
  }

  function getOrderByNumber(orderNumber) {
    const row = db
      .prepare('SELECT id FROM customer_order WHERE order_number = ?')
      .get(orderNumber);
    return row ? getOrderWithLines(row.id) : undefined;
  }

  function listOrders({ status } = {}) {
    const rows = status
      ? db.prepare('SELECT id FROM customer_order WHERE status = ? ORDER BY created_at DESC, id DESC').all(status)
      : db.prepare('SELECT id FROM customer_order ORDER BY created_at DESC, id DESC').all();
    return rows.map((r) => getOrderWithLines(r.id));
  }

  /** Validates only against the allowed status set; no transition workflow. */
  function updateOrderStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) {
      throw new Error(`Invalid order status: ${status}`);
    }
    db.prepare(
      `UPDATE customer_order SET status = ?, updated_at = ${NOW} WHERE id = ?`,
    ).run(status, id);
    return getOrderWithLines(id);
  }

  // ---- admin users ----
  function createAdminUser({ username, passwordHash }) {
    const info = db
      .prepare('INSERT INTO admin_user (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);
    return toAdminUser(
      db.prepare('SELECT * FROM admin_user WHERE id = ?').get(Number(info.lastInsertRowid)),
    );
  }

  function findAdminUserByUsername(username) {
    return toAdminUser(db.prepare('SELECT * FROM admin_user WHERE username = ?').get(username));
  }

  // ---- settings ----
  function getSettings() {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return { acceptingOrders: row.accepting_orders === 1, updatedAt: row.updated_at };
  }

  function setAcceptingOrders(accepting) {
    db.prepare(
      `UPDATE settings SET accepting_orders = ?, updated_at = ${NOW} WHERE id = 1`,
    ).run(accepting ? 1 : 0);
    return getSettings();
  }

  return {
    createCategory,
    getCategory,
    listCategories,
    createFoodItem,
    getFoodItem,
    updateFoodItem,
    setAvailability,
    softDeleteFoodItem,
    listFoodItems,
    createOrderWithLines,
    getOrderWithLines,
    getOrderByNumber,
    listOrders,
    updateOrderStatus,
    createAdminUser,
    findAdminUserByUsername,
    getSettings,
    setAcceptingOrders,
  };
}
