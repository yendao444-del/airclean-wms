const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vm = require('node:vm');
const plan = require('../electron/packing-plan.cjs');

function loadTs(relative) {
  const filename = path.resolve(__dirname, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return loaded.exports;
}
const labels = loadTs('../src/lib/packingLabels.ts');

function fixture() {
  const store = new Map();
  const users = [
    { username: 'toan', fullName: 'Nguyễn Đình Toàn', status: 'active', role: 'staff' },
    { username: 'khanh', fullName: 'Nguyễn Văn Khánh', status: 'active', role: 'staff' },
    { username: 'old', fullName: 'Nghỉ việc', status: 'inactive', role: 'staff' },
    { username: 'admin', fullName: 'Admin', status: 'active', role: 'admin' },
  ];
  const tx = {
    $executeRaw: async () => 1,
    appConfig: {
      findUnique: async ({ where: { key } }) => store.has(key) ? { key, value: store.get(key) } : null,
      upsert: async ({ where: { key }, create, update }) => { store.set(key, store.has(key) ? update.value : create.value); },
    },
    user: { findUnique: async ({ where }) => users.find(user => user.username === where.username) || null },
  };
  return { tx, read: () => plan.parsePlan(store.has(plan.PLAN_KEY) ? { value: store.get(plan.PLAN_KEY) } : null) };
}
const ami = [{ sku: '1-AMIECO-DEN', quantity: 1 }];
const amiKey = '1-AMIECO-DEN:1';

test('admin target overrides the default and can return to it; history is kept', async () => {
  const { tx, read } = fixture();
  await plan.updatePattern(tx, { key: amiKey, components: ami, target: 50 }, 'admin');
  assert.equal(read().patterns[amiKey].target, 50);
  await plan.updatePattern(tx, { key: amiKey, components: ami, target: null }, 'admin');
  assert.equal(read().patterns[amiKey].target, null);
  assert.equal(read().history.length, 2);
  await assert.rejects(plan.updatePattern(tx, { key: amiKey, components: ami, target: -1 }, 'admin'), /Chỉ tiêu/);
  await assert.rejects(plan.updatePattern(tx, { key: amiKey, components: ami, target: 1.5 }, 'admin'), /Chỉ tiêu/);
});

test('owner must be an active non-admin employee; null unassigns', async () => {
  const { tx, read } = fixture();
  await plan.updatePattern(tx, { key: amiKey, components: ami, owner: 'toan' }, 'admin');
  assert.equal(read().patterns[amiKey].ownerName, 'Nguyễn Đình Toàn');
  await assert.rejects(plan.updatePattern(tx, { key: amiKey, components: ami, owner: 'old' }, 'admin'), /không còn hoạt động/);
  await assert.rejects(plan.updatePattern(tx, { key: amiKey, components: ami, owner: 'admin' }, 'admin'), /không còn hoạt động/);
  await plan.updatePattern(tx, { key: amiKey, components: ami, owner: null }, 'admin');
  assert.equal(read().patterns[amiKey].owner, null);
});

test('changing the owner keeps the admin target', async () => {
  const { tx, read } = fixture();
  await plan.updatePattern(tx, { key: amiKey, components: ami, target: 100 }, 'admin');
  await plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'khanh' }], 'admin');
  assert.equal(read().patterns[amiKey].target, 100);
  assert.equal(read().patterns[amiKey].owner, 'khanh');
});

test('contiguous split: A gets 1,2,3 and B gets 4,5,6', () => {
  const split = labels.splitContiguous([1, 2, 3, 4, 5, 6], ['A', 'B']);
  assert.deepEqual(split.map(item => item.owner), ['A', 'A', 'A', 'B', 'B', 'B']);
  assert.deepEqual(labels.splitContiguous([1, 2, 3, 4, 5], ['A', 'B']).map(item => item.owner), ['A', 'A', 'A', 'B', 'B']);
  assert.deepEqual(labels.splitContiguous([1, 2], []), []);
});

test('default target is rounded orders per day; state is missing / enough / extra', () => {
  assert.equal(labels.defaultTarget(42.3), 42);
  assert.equal(labels.defaultTarget(27.5), 28);
  assert.deepEqual(labels.planState(30, 42), { state: 'missing', diff: 12 });
  assert.deepEqual(labels.planState(20, 20), { state: 'enough', diff: 0 });
  assert.deepEqual(labels.planState(94, 28), { state: 'extra', diff: 66 });
});

test('pattern key matches the backend basket key and labels follow the agreed format', () => {
  assert.equal(labels.patternKey([{ sku: '1-5duni-trang', quantity: 5 }, { sku: '1-5DUNI-DEN', quantity: 5 }]), '1-5DUNI-DEN:5|1-5DUNI-TRANG:5');
  const variants = {
    '1-AMIECO-DEN': { productSku: '1-AMIECO', productName: 'Khẩu Trang AMI ECO MASK', color: 'Đen', unit: 'Hộp' },
    '1-5DUNI-DEN': { productSku: '1-5DUNI', productName: 'Khẩu Trang 5D UNICARE', color: 'Đen', unit: 'Gói' },
    '1-5DUNI-TRANG': { productSku: '1-5DUNI', productName: 'Khẩu Trang 5D UNICARE', color: 'Trắng', unit: 'Gói' },
    '1-5DTHINHPHAT-DEN': { productSku: '1-5DTHINHPHAT', productName: 'Khẩu Trang 5D Thịnh Phát', color: 'Đen', unit: 'Gói' },
  };
  assert.equal(labels.patternLabel(ami, variants), 'AMI Eco Đen - 1 Hộp');
  assert.equal(labels.patternLabel([{ sku: '1-5DUNI-DEN', quantity: 5 }, { sku: '1-5DUNI-TRANG', quantity: 5 }], variants), '5D Unicare 5 Gói Đen + 5 Gói Trắng');
  assert.equal(labels.patternLabel([{ sku: '1-5DTHINHPHAT-DEN', quantity: 10 }, { sku: '1-5DUNI-DEN', quantity: 10 }], variants), '5D Thịnh Phát Đen - 10 Gói + 5D Unicare Đen - 10 Gói');
  assert.equal(labels.isMultiBrand([{ sku: '1-5DTHINHPHAT-DEN' }, { sku: '1-9ATHINHPHAT-BE200' }]), false);
});

test('one SKU belongs to one packer: a pattern sharing a SKU cannot go to someone else', async () => {
  const { tx, read } = fixture();
  const den10 = [{ sku: '1-5DUNI-DEN', quantity: 10 }];
  const den20 = [{ sku: '1-5DUNI-DEN', quantity: 20 }];
  const mix = [{ sku: '1-5DUNI-DEN', quantity: 5 }, { sku: '1-5DUNI-TRANG', quantity: 5 }];
  await plan.assignOwners(tx, [{ key: '1-5DUNI-DEN:10', components: den10, owner: 'toan' }], 'admin');
  await assert.rejects(plan.assignOwners(tx, [{ key: '1-5DUNI-DEN:20', components: den20, owner: 'khanh' }], 'admin'), /1-5DUNI-DEN đã phân công cho Nguyễn Đình Toàn/);
  await assert.rejects(plan.updatePattern(tx, { key: '1-5DUNI-DEN:5|1-5DUNI-TRANG:5', components: mix, owner: 'khanh' }, 'admin'), /đã phân công/);
  // The same person may take more patterns of their SKU.
  await plan.assignOwners(tx, [{ key: '1-5DUNI-DEN:20', components: den20, owner: 'toan' }], 'admin');
  assert.equal(read().patterns['1-5DUNI-DEN:20'].owner, 'toan');
  // A failed batch writes nothing.
  await assert.rejects(plan.assignOwners(tx, [
    { key: 'AMI:1', components: [{ sku: '1-AMIECO-DEN', quantity: 1 }], owner: 'khanh' },
    { key: '1-5DUNI-TRANG:10', components: [{ sku: '1-5DUNI-DEN', quantity: 1 }], owner: 'khanh' },
  ], 'admin'), /đã phân công/);
  assert.equal(read().patterns['AMI:1'], undefined);
  assert.deepEqual(plan.skuConflict(read(), 'x', den10, 'khanh').ownerName, 'Nguyễn Đình Toàn');
});

test('an assignment can carry the daily target; null keeps the default', async () => {
  const { tx, read } = fixture();
  await plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target: 50 }], 'admin', new Date(), { allowTarget: true });
  assert.equal(read().patterns[amiKey].target, 50);
  await plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target: null }], 'admin', new Date(), { allowTarget: true });
  assert.equal(read().patterns[amiKey].target, null);
  await assert.rejects(plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target: -3 }], 'admin', new Date(), { allowTarget: true }), /Chỉ tiêu/);
});

test('manager assignment cannot create or change a target', async () => {
  const { tx, read } = fixture();
  await plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target: 50 }], 'admin', new Date(), { allowTarget: true });
  await assert.rejects(
    plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target: 70 }], 'manager', new Date(), { allowTarget: false }),
    /Chỉ Admin được phép sửa chỉ tiêu/,
  );
  await plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'khanh' }], 'manager', new Date(), { allowTarget: false });
  assert.equal(read().patterns[amiKey].target, 50);
  await plan.assignOwners(tx, [{ key: 'NEW:1', components: [{ sku: 'NEW', quantity: 1 }], owner: 'khanh' }], 'manager', new Date(), { allowTarget: false });
  assert.equal(read().patterns['NEW:1'].target, undefined);
  for (const target of [null, undefined, 0, 50]) {
    await assert.rejects(plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target }], 'manager', new Date(), { allowTarget: false }), /Chỉ Admin/);
  }
  assert.equal(read().patterns[amiKey].owner, 'khanh');
  assert.equal(read().patterns[amiKey].target, 50);
  await assert.rejects(plan.assignOwners(tx, [{ key: amiKey, components: ami, owner: 'toan', target: 1 }], 'unknown'), /Chỉ Admin/);
});

test('real plan IPCs reject forged target permissions and preserve assignment targets', async () => {
  const { tx, read } = fixture();
  let transactions = 0;
  let broadcasts = 0;
  const handlers = new Map();
  const context = {
    currentSession: { role: 'admin', username: 'admin' },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    packingPlan: plan,
    prisma: { $transaction: async callback => { transactions++; return callback(tx); } },
    broadcastHandlingUnitsChanged: () => { broadcasts++; },
    requireRole: (...roles) => { if (!roles.includes(context.currentSession?.role)) throw new Error('Not authorized'); },
  };
  const source = fs.readFileSync(path.join(__dirname, '../electron/ipc-handlers.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('packingPlan:update'");
  const end = source.indexOf("ipcMain.handle('handlingUnits:getReconciliation'", start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  const update = handlers.get('packingPlan:update');
  const assign = handlers.get('packingPlan:assign');
  assert.equal((await assign(null, { assignments: [{ key: amiKey, components: ami, owner: 'toan', target: 50 }] })).success, true);
  for (const role of ['manager', 'staff', 'viewer', undefined]) {
    context.currentSession = { username: 'employee', role };
    const before = JSON.stringify(read());
    const beforeTransactions = transactions;
    const beforeBroadcasts = broadcasts;
    assert.equal((await update(null, { key: amiKey, components: ami, target: 90, role: 'admin' })).success, false);
    for (const target of [90, null, 0, undefined]) {
      assert.equal((await assign(null, { allowTarget: true, role: 'admin', assignments: [
        { key: 'NEW:1', components: [{ sku: 'NEW', quantity: 1 }], owner: 'toan' },
        { key: amiKey, components: ami, owner: 'toan', target },
      ] })).success, false);
    }
    assert.equal(JSON.stringify(read()), before);
    assert.equal(transactions, beforeTransactions);
    assert.equal(broadcasts, beforeBroadcasts);
  }
  context.currentSession = { username: 'manager', role: 'manager' };
  assert.equal((await assign(null, { assignments: [{ key: amiKey, components: ami, owner: 'khanh' }] })).success, true);
  assert.equal(read().patterns[amiKey].target, 50);
  assert.equal(read().patterns[amiKey].owner, 'khanh');
  context.currentSession = { username: 'admin', role: 'admin' };
  assert.equal((await update(null, { key: amiKey, components: ami, target: 100 })).success, true);
  assert.equal(read().patterns[amiKey].target, 100);
  assert.equal((await assign(null, { assignments: [{ key: amiKey, components: ami, owner: 'khanh', target: null }] })).success, true);
  assert.equal(read().patterns[amiKey].target, null);
});

test('roundUpTarget rounds a packing target up to the next multiple of 10', () => {
  assert.equal(labels.roundUpTarget(12), 20);
  assert.equal(labels.roundUpTarget(4), 10);
  assert.equal(labels.roundUpTarget(1), 10);
  assert.equal(labels.roundUpTarget(0), 10);
  assert.equal(labels.roundUpTarget(20), 20);
  assert.equal(labels.roundUpTarget(21), 30);
  assert.equal(labels.roundUpTarget(7, 5), 10);
});
