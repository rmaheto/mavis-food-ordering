import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createRepositories } from '../src/repositories.js';

function setup() {
  const db = openDatabase(':memory:');
  const repo = createRepositories(db);
  const category = repo.createCategory({ name: 'Mains', sortOrder: 1 });
  const item = repo.createFoodItem({
    categoryId: category.id,
    name: 'Jollof Rice',
    description: 'Spiced rice',
    ingredients: 'rice, tomato, pepper',
    pricePence: 850,
    imageRef: 'images/jollof.jpg',
  });
  return { db, repo, category, item };
}

const collection = {
  customerName: 'Ada',
  phone: '07000000000',
  fulfilmentMethod: 'collection',
};

test('order lines snapshot name, price and quantity; total is computed', () => {
  const { repo, item } = setup();
  const order = repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 3 }]);
  assert.equal(order.status, 'pending_acceptance');
  assert.equal(order.totalPence, 2550);
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].itemName, 'Jollof Rice');
  assert.equal(order.lines[0].unitPricePence, 850);
  assert.equal(order.lines[0].quantity, 3);
  assert.match(order.orderNumber, /^ORD-\d{6}$/);
});

test('snapshots unchanged after price change, rename, unavailable and soft delete', () => {
  const { repo, item } = setup();
  const order = repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 2 }]);

  repo.updateFoodItem(item.id, { pricePence: 1200, name: 'Renamed' });
  repo.setAvailability(item.id, false);
  repo.softDeleteFoodItem(item.id);

  const after = repo.getOrderWithLines(order.id);
  assert.equal(after.totalPence, 1700);
  assert.equal(after.lines[0].itemName, 'Jollof Rice');
  assert.equal(after.lines[0].unitPricePence, 850);
  assert.equal(after.lines[0].quantity, 2);

  const current = repo.getFoodItem(item.id);
  assert.equal(current.isAvailable, false);
  assert.ok(current.deletedAt);
  assert.equal(current.pricePence, 1200);
});

test('soft-deleted items are excluded from listings by default', () => {
  const { repo, item } = setup();
  repo.softDeleteFoodItem(item.id);
  assert.equal(repo.listFoodItems().length, 0);
  assert.equal(repo.listFoodItems({ includeDeleted: true }).length, 1);
});

test('repositories expose no hard delete for food items', () => {
  const { repo } = setup();
  for (const key of Object.keys(repo)) {
    assert.ok(!/^(delete|remove|hardDelete)/i.test(key), `unexpected function ${key}`);
  }
});

test('hard delete of an ordered food item fails', () => {
  const { db, repo, item } = setup();
  repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 1 }]);
  assert.throws(() => db.prepare('DELETE FROM food_item WHERE id = ?').run(item.id), /cannot be deleted|FOREIGN KEY/);
  assert.ok(repo.getFoodItem(item.id));
});

test('order line snapshot columns cannot be updated', () => {
  const { db, repo, item } = setup();
  const order = repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 1 }]);
  assert.throws(() =>
    db.prepare('UPDATE order_line SET unit_price_pence = 1 WHERE order_id = ?').run(order.id),
  );
  assert.throws(() =>
    db.prepare('UPDATE order_line SET item_name = ? WHERE order_id = ?').run('x', order.id),
  );
});

test('category with food items cannot be deleted', () => {
  const { db, category } = setup();
  assert.throws(() => db.prepare('DELETE FROM category WHERE id = ?').run(category.id));
});

test('invalid status is rejected', () => {
  const { db, repo, item } = setup();
  const order = repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 1 }]);
  assert.throws(() => repo.updateOrderStatus(order.id, 'bogus'));
  assert.throws(() =>
    db.prepare("UPDATE customer_order SET status = 'bogus' WHERE id = ?").run(order.id),
  );
  for (const s of ['confirmed', 'preparing', 'ready', 'completed', 'declined']) {
    assert.equal(repo.updateOrderStatus(order.id, s).status, s);
  }
});

test('invalid fulfilment method is rejected', () => {
  const { repo, item } = setup();
  assert.throws(() =>
    repo.createOrderWithLines({ ...collection, fulfilmentMethod: 'drone' }, [
      { foodItemId: item.id, quantity: 1 },
    ]),
  );
});

test('delivery requires address line, town/city and postcode', () => {
  const { repo, item } = setup();
  const lines = [{ foodItemId: item.id, quantity: 1 }];
  const base = { ...collection, fulfilmentMethod: 'delivery' };
  assert.throws(() => repo.createOrderWithLines(base, lines));
  assert.throws(() =>
    repo.createOrderWithLines(
      { ...base, deliveryAddressLine: '1 High St', deliveryTownCity: 'London', deliveryPostcode: ' ' },
      lines,
    ),
  );
  const ok = repo.createOrderWithLines(
    { ...base, deliveryAddressLine: '1 High St', deliveryTownCity: 'London', deliveryPostcode: 'E1 1AA' },
    lines,
  );
  assert.equal(ok.fulfilmentMethod, 'delivery');
});

test('failed order creation leaves no partial rows', () => {
  const { db, repo, item } = setup();
  assert.throws(() =>
    repo.createOrderWithLines({ ...collection, fulfilmentMethod: 'delivery' }, [
      { foodItemId: item.id, quantity: 1 },
    ]),
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customer_order').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_line').get().n, 0);
});

test('duplicate order number is rejected', () => {
  const { repo, item } = setup();
  const lines = [{ foodItemId: item.id, quantity: 1 }];
  repo.createOrderWithLines({ ...collection, orderNumber: 'A-1' }, lines);
  assert.throws(() => repo.createOrderWithLines({ ...collection, orderNumber: 'A-1' }, lines));
});

test('non-positive quantity is rejected', () => {
  const { db, repo, item } = setup();
  assert.throws(() => repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 0 }]));
  assert.throws(() => repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: -1 }]));
  const order = repo.createOrderWithLines(collection, [{ foodItemId: item.id, quantity: 1 }]);
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO order_line (order_id, food_item_id, item_name, unit_price_pence, quantity) VALUES (?, ?, ?, ?, ?)',
      )
      .run(order.id, item.id, 'x', 100, 0),
  );
});

test('negative or fractional price is rejected', () => {
  const { repo } = setup();
  assert.throws(() => repo.createFoodItem({ name: 'Bad', pricePence: -1 }));
  assert.throws(() => repo.createFoodItem({ name: 'Bad', pricePence: 1.5 }));
});

test('admin users store a hash and enforce unique usernames', () => {
  const { repo } = setup();
  const u = repo.createAdminUser({ username: 'mavis', passwordHash: 'hash' });
  assert.equal(u.username, 'mavis');
  assert.equal(repo.findAdminUserByUsername('mavis').passwordHash, 'hash');
  assert.equal(repo.findAdminUserByUsername('nobody'), undefined);
  assert.throws(() => repo.createAdminUser({ username: 'mavis', passwordHash: 'other' }));
});

test('settings can toggle accepting orders', () => {
  const { repo } = setup();
  assert.equal(repo.getSettings().acceptingOrders, true);
  assert.equal(repo.setAcceptingOrders(false).acceptingOrders, false);
  assert.equal(repo.setAcceptingOrders(true).acceptingOrders, true);
});
