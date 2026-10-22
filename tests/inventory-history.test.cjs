/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness loads transpiled CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTs(relativePath, overrides = {}) {
  const file = path.resolve(__dirname, '..', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = name => name in overrides ? overrides[name] : name.startsWith('@/')
    ? loadTs(name.slice(2) + '.ts', overrides) : name.startsWith('.')
    ? loadTs(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), name + '.ts')), overrides)
    : require(name);
  new Function('require', 'module', 'exports', compiled)(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const { fetchInventoryHistory } = loadTs('lib/inventory-history.ts');

function fakeClient(dataset, failOriginals = false) {
  const calls = [];
  return {
    calls,
    from() {
      const filters = [], ordering = [];
      let bounds, originalQuery = false;
      const q = {
        select() { return q; },
        eq(key, value) { filters.push(row => row[key] === value); return q; },
        gte(key, value) { filters.push(row => row[key] >= value); return q; },
        lt(key, value) { filters.push(row => key === 'tx_date' ? Date.parse(row[key]) < Date.parse(value) : row[key] < value); return q; },
        is(key, value) { filters.push(row => row[key] === value); return q; },
        in(key, values) { originalQuery = true; assert.ok(values.length <= 100); filters.push(row => values.includes(row[key])); return q; },
        order(key, options) { ordering.push([key, options?.ascending !== false]); return q; },
        range(from, to) { bounds = [from, to]; return q; },
        then(resolve, reject) {
          calls.push({ originalQuery, bounds });
          if (failOriginals && originalQuery) return Promise.resolve({ data: null, error: Error('denied') }).then(resolve, reject);
          const rows = dataset.filter(row => filters.every(f => f(row)));
          rows.sort((a, b) => {
            for (const [key, ascending] of ordering) {
              const comparison = String(a[key]).localeCompare(String(b[key]));
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          const from = bounds?.[0] || 0;
          const to = Math.min(bounds?.[1] ?? 999, from + 999);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const row = (id, extra = {}) => ({ id, product_id: 'p', tx_date: '2026-09-30', created_at: '2026-09-30T00:00:00Z', deleted_at: null, tx_type: 'in', ...extra });

test('history returns all 1505 rows under a 1000-row API limit and excludes cancelled/other products', async () => {
  const dataset = Array.from({ length: 1505 }, (_, i) => row(String(i).padStart(5, '0')));
  dataset.push(row('cancelled', { deleted_at: '2026-09-30' }), row('other', { product_id: 'other' }));
  const client = fakeClient(dataset);
  const result = await fetchInventoryHistory(client, 'p', '2026-09-01', '2026-09-30');
  assert.equal(result.length, 1505);
  assert.equal(new Set(result.map(r => r.id)).size, 1505);
  assert.equal(client.calls.length, 2);
});

test('201 adjustments resolve source snapshots from receipts outside dates in bounded batches', async () => {
  const dataset = [];
  for (let i = 0; i < 201; i++) {
    dataset.push(row('o' + i, { tx_date: '2026-08-01', source_kind: 'supplier', supplier_id: 'supplier', supplier_code_snapshot: 'NCC01', supplier_name_snapshot: 'Original name' }));
    dataset.push(row('a' + i, { tx_type: 'adjust_out', adjusted_from_transaction_id: 'o' + i, source_kind: 'factory' }));
  }
  const client = fakeClient(dataset);
  const result = await fetchInventoryHistory(client, 'p', '2026-09-01', '2026-09-30');
  assert.equal(result.length, 201);
  assert.ok(result.every(r => r.original_tx_type === 'in' && r.source_kind === 'supplier' && r.supplier_code_snapshot === 'NCC01'));
  assert.equal(client.calls.filter(c => c.originalQuery).length, 3);
});

test('outbound adjustment stays identified as outbound; unknown legacy source is not invented', async () => {
  const client = fakeClient([row('out', { tx_type: 'out', tx_date: '2026-08-01' }), row('adj', { tx_type: 'adjust_in', adjusted_from_transaction_id: 'out' }), row('legacy')]);
  const result = await fetchInventoryHistory(client, 'p', '2026-09-01', '2026-09-30');
  assert.equal(result.find(r => r.id === 'adj').original_tx_type, 'out');
  assert.equal(result.find(r => r.id === 'legacy').source_kind, undefined);
});

test('a failed original read fails the whole history instead of displaying incorrect source', async () => {
  await assert.rejects(fetchInventoryHistory(fakeClient([row('adj', { adjusted_from_transaction_id: 'missing' })], true), 'p', '2026-09-01', '2026-09-30'), /denied/);
});

test('a hidden or missing original prevents misleading adjustment direction and source', async () => {
  await assert.rejects(fetchInventoryHistory(fakeClient([row('adj', { adjusted_from_transaction_id: 'missing' })]), 'p', '2026-09-01', '2026-09-30'), /Không tải đủ phiếu gốc/);
});

test('invalid date range is rejected before reading', async () => {
  const client = fakeClient([]);
  await assert.rejects(fetchInventoryHistory(client, 'p', '2026-10-01', '2026-09-30'), /Khoảng ngày/);
  assert.equal(client.calls.length, 0);
});

test('includes transactions late on the last selected day and excludes next day', async () => {
  const result = await fetchInventoryHistory(fakeClient([row('late', { tx_date: '2026-09-30T23:59:59Z' }), row('next', { tx_date: '2026-10-01T00:00:00Z' })]), 'p', '2026-09-30', '2026-09-30');
  assert.deepEqual(result.map(r => r.id), ['late']);
});

test('receipt labels use supplier code and full person name, never supplier name or login', () => {
  const helpers = loadTs('lib/inventory-receipts.ts', { '@/lib/supabaseClient': { supabase: {} } });
  assert.equal(helpers.receiptSourceLabel({ source_kind: 'supplier', supplier_code_snapshot: 'NCC01', supplier_name_snapshot: 'Full supplier name' }), 'NCC01');
  assert.equal(helpers.receiptSourceLabel({ source_kind: 'factory' }), 'Nhà máy tự sản xuất');
  assert.equal(helpers.receiptSourceLabel({}), 'Chưa ghi nhận');
  assert.equal(helpers.receiptCreatorLabel({ created_by_name_snapshot: 'Nguyễn Trọng Hiếu', created_by: 'user-id' }), 'Nguyễn Trọng Hiếu');
  assert.equal(helpers.receiptCreatorLabel({ created_by: 'user-id' }), 'Chưa cập nhật họ tên');
  assert.equal(helpers.receiptCreatorLabel({}), 'Chưa xác định');
});

test('request id survives same-payload retry, changes only for a different operation payload', () => {
  const { receiptRequestId } = loadTs('lib/inventory-receipts.ts', { '@/lib/supabaseClient': { supabase: {} } });
  const ref = { current: null };
  const initial = receiptRequestId(ref, { qty: 10, source_kind: 'factory' });
  assert.equal(receiptRequestId(ref, { qty: 10, source_kind: 'factory' }), initial);
  assert.notEqual(receiptRequestId(ref, { qty: 11, source_kind: 'factory' }), initial);
});

test('metadata batches 205 rows and fails on partial or denied lookup instead of hiding errors', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: String(i), qty: 10 }));
  const calls = [];
  let incomplete = false, denied = false;
  const { loadReceiptMetadata } = loadTs('lib/inventory-receipts.ts', { '@/lib/supabaseClient': { supabase: {
    rpc: async (name, args) => {
      assert.equal(name, 'inventory_receipt_metadata_v1');
      calls.push(args.p_transaction_ids);
      if (denied) return { error: Error('Access denied'), data: null };
      const ids = incomplete ? args.p_transaction_ids.slice(1) : args.p_transaction_ids;
      return { error: null, data: ids.map(id => ({ id, source_kind: 'factory', created_by_name_snapshot: 'Nguyễn Trọng Hiếu' })) };
    },
  } } });
  const result = await loadReceiptMetadata('phoi', rows);
  assert.deepEqual(calls.map(ids => ids.length), [100, 100, 5]);
  assert.equal(result.length, 205);
  assert.ok(result.every(r => r.qty === 10 && r.created_by_name_snapshot === 'Nguyễn Trọng Hiếu'));
  incomplete = true;
  await assert.rejects(loadReceiptMetadata('phoi', rows), /Không tải đủ/);
  denied = true;
  await assert.rejects(loadReceiptMetadata('phoi', rows), /Access denied/);
});
