/* eslint-disable @typescript-eslint/no-require-imports -- Node loads transpiled TypeScript. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib/admin-permission.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { loadAdminPermission } = loaded.exports;

for (const role of ['admin', 'staff', 'manager', null]) {
  test('Database grants admin even when profile role is ' + role, async () => {
    const calls = [];
    const client = { profile: { role }, rpc(name) { calls.push(name); return Promise.resolve({ data: true, error: null }); } };
    assert.equal(await loadAdminPermission(client), true);
    assert.deepEqual(calls, ['is_admin']);
  });
}
test('A profile labelled admin cannot override a database denial', async () => {
  assert.equal(await loadAdminPermission({ profile: { role: 'admin' }, rpc: () => Promise.resolve({ data: false, error: null }) }), false);
});
for (const response of [{ data: true, error: { message: 'denied' } }, { data: null, error: null }, { data: 'true', error: null }, { data: 1, error: null }]) {
  test('Failed or invalid permission response blocks editing: ' + JSON.stringify(response), async () => {
    await assert.rejects(loadAdminPermission({ rpc: () => Promise.resolve(response) }), /Không kiểm tra được quyền tài khoản/);
  });
}
test('Transport failure is not converted into a permission grant', async () => {
  await assert.rejects(loadAdminPermission({ rpc: () => Promise.reject(Error('offline')) }), /offline/);
});

// Inspect executable syntax, not comments: copied pages cannot reintroduce role-only admin gates.
for (const page of ['phoi', 'inbound', 'outbound', 'returns']) {
  test('Inventory ' + page + ' uses the database permission for every admin gate', () => {
    const content = fs.readFileSync(path.join(root, 'app/(protected)/inventory', page, 'page.tsx'), 'utf8');
    const tree = ts.createSourceFile(page + '.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nodes = [];
    function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
    visit(tree);
    const checks = nodes.filter(ts.isBinaryExpression).filter(node => [node.left, node.right].some(side => ts.isStringLiteral(side) && side.text === 'admin'));
    assert.equal(checks.length, 0, 'Never infer admin from profiles.role; use loadAdminPermission.');
    assert.ok(nodes.some(node => ts.isCallExpression(node) && node.expression.getText(tree) === 'loadAdminPermission' && node.arguments[0]?.getText(tree) === 'supabase'));
    for (const gate of page === 'outbound' ? ['canEditAdmin', 'canDeleteAdmin'] : ['canEdit', 'canDelete']) {
      const variable = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === gate);
      assert.equal(variable?.initializer?.getText(tree), 'isAdmin', gate + ' must use database permission');
    }
    const load = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'load');
    assert.match(load.body.statements[0].getText(tree), /^setIsAdmin\(false\)/);
    const permissionSetters = nodes.filter(node => ts.isCallExpression(node) && node.expression.getText(tree) === 'setIsAdmin');
    assert.ok(permissionSetters.some(node => node.arguments[0]?.getText(tree) === 'adminPermission'));
    assert.ok(permissionSetters.filter(node => node.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword).length >= 2, 'Reload and error must revoke stale permission');
    if (page === 'phoi' || page === 'inbound') {
      for (const [fn, gate] of [['openEdit','canEdit'], ['openAdjustment','canCreate'], ['saveMulti','canCreate'], ['saveEdit','canEdit'], ['saveAdjustment','canCreate'], ['cancelReceipts','canDelete']]) {
        const declaration = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === fn);
        const first = declaration?.body?.statements[0];
        assert.ok(first && ts.isIfStatement(first) && first.expression.getText(tree).includes('!' + gate), fn + ' must check permission before working');
      }
    }
  });
}
test('Normal build runs the permission regression check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'npm run test:permissions');
});

// Execute the real save handler with fake API responses; never write to production.
for (const page of ['phoi', 'inbound']) {
  function saveHandler(canEdit, apiError = null) {
    const content = fs.readFileSync(path.join(root, 'app/(protected)/inventory', page, 'page.tsx'), 'utf8');
    const tree = ts.createSourceFile(page + '.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let declaration;
    function find(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveEdit') declaration = node; ts.forEachChild(node, find); }
    find(tree);
    const code = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const calls = [], closed = [], messages = [];
    const values = {
      canEdit, editing: { id: 'receipt-id', source_kind: 'factory', supplier_id: null },
      editSource: { kind: 'factory', supplierId: '' }, sourceReason: '', eDate: '2026-09-30', eProductId: 'product-id',
      eQty: '10', eCost: '15', eNote: 'Sửa ghi chú', beginMutation: () => true, endMutation: () => {},
      supabase: { rpc: async (name, payload) => { calls.push({ name, payload }); return { error: apiError }; } },
      showToast: (message, kind) => messages.push({ message, kind }), setEditOpen: value => closed.push(value),
      load: async () => {}, receiptErrorMessage: error => error.message,
    };
    return { run: new Function(...Object.keys(values), code + '; return saveEdit;')(...Object.values(values)), calls, closed, messages };
  }
  test(page + ': actual admin save handler sends the correct receipt update', async () => {
    const fixture = saveHandler(true);
    await fixture.run();
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].name, 'inventory_update_receipt_v1');
    assert.equal(fixture.calls[0].payload.p_kind, page === 'phoi' ? 'phoi' : 'inventory');
    assert.equal(fixture.calls[0].payload.p_transaction_id, 'receipt-id');
    assert.equal(fixture.calls[0].payload.p_note, 'Sửa ghi chú');
    assert.deepEqual(fixture.closed, [false]);
  });
  test(page + ': denied save does not send any write', async () => {
    const fixture = saveHandler(false);
    await fixture.run();
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.closed.length, 0);
    assert.equal(fixture.messages[0].kind, 'error');
  });
  test(page + ': failed save keeps the edit open and shows the error', async () => {
    const fixture = saveHandler(true, { message: 'permission denied' });
    await fixture.run();
    assert.equal(fixture.closed.length, 0);
    assert.deepEqual(fixture.messages, [{ message: 'permission denied', kind: 'error' }]);
  });
}
