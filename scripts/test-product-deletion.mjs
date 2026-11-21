// In-memory PostgreSQL only. PGLITE_MODULE may point to an existing @electric-sql/pglite installation.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = uid(1), superAdmin = uid(2), manager = uid(3), staff = uid(4), disabled = uid(5);
const product = n => uid(100 + n);
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
const actor = async id => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id ?? ''}',false); SET ROLE authenticated;`);
const rpc = ids => db.query('SELECT public.admin_soft_delete_products_v1($1::uuid[]) AS result', [ids]);
const rejects = async (fn, pattern) => assert.rejects(fn, pattern);
const unchanged = async ids => {
  await db.exec('RESET ROLE');
  const { rows } = await db.query('SELECT count(*)::integer AS n FROM products WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL', [ids]);
  assert.equal(rows[0].n, ids.length);
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text,is_active boolean,is_approved boolean,deleted_at timestamptz);
    CREATE TABLE super_admins(user_id uuid PRIMARY KEY);
    CREATE TABLE products(id uuid PRIMARY KEY,sku text,is_active boolean DEFAULT true,deleted_at timestamptz,deleted_by uuid);
    CREATE TABLE inventory_transactions(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id),deleted_at timestamptz);
    CREATE TABLE report_lines(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
    INSERT INTO profiles VALUES('${admin}','admin',true,true,null),('${superAdmin}','staff',true,true,null),('${manager}','manager',true,true,null),('${staff}','staff',true,true,null),('${disabled}','admin',false,true,null);
    INSERT INTO super_admins VALUES('${superAdmin}');
    INSERT INTO products(id,sku) SELECT ('00000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'TEST-'||n FROM generate_series(1,20) n;
    GRANT SELECT,UPDATE,DELETE ON products TO authenticated;
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;`);
  // Use the repository's real authority and product policies, rather than mocked permission booleans.
  const authSource = read('supabase-sql/20260710_fix_auth_approved_rls_rpc.sql');
  for (const name of ['is_approved_active_user', 'is_admin', 'is_manager']) {
    const definition = authSource.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\(\\)[\\s\\S]*?\\$\\$;'));
    assert.ok(definition, name);
    await db.exec(definition[0]);
  }
  for (const policy of ['products_select', 'products_update', 'products_delete']) {
    const definition = authSource.match(new RegExp('CREATE POLICY "' + policy + '"[^$]+'));
    assert.ok(definition, policy);
    await db.exec(definition[0]);
  }
  await check('reproduce old Admin soft-delete failing the SELECT policy', async () => {
    await actor(admin);
    await rejects(() => db.query('UPDATE products SET deleted_at=now() WHERE id=$1', [product(1)]), /row-level security/);
    await unchanged([product(1)]);
  });
  await db.exec(read('supabase-sql/20261121_fix_admin_product_soft_delete.sql'));
  await check('Admin deletes an unused product and records the real actor', async () => {
    await actor(admin);
    assert.deepEqual((await rpc([product(1)])).rows[0].result, { success: true, deleted_count: 1 });
    assert.equal((await db.query('SELECT * FROM products WHERE id=$1', [product(1)])).rows.length, 0);
    await db.exec('RESET ROLE');
    const row = (await db.query('SELECT * FROM products WHERE id=$1', [product(1)])).rows[0];
    assert.ok(row.deleted_at);
    assert.equal(row.deleted_by, admin);
    assert.equal(row.is_active, false);
  });
  await check('Super Admin with a staff profile can delete a batch', async () => {
    await actor(superAdmin);
    assert.deepEqual((await rpc([product(2),product(3)])).rows[0].result, { success:true,deleted_count:2 });
  });
  for (const [name,id] of [['manager',manager],['staff',staff],['disabled Admin',disabled],['no session',null]]) {
    await check(name + ' cannot call the deletion RPC', async () => {
      await actor(id);
      await rejects(() => rpc([product(4)]), /Chỉ Admin/);
      await unchanged([product(4)]);
    });
  }
  await check('anonymous role has no permission to execute the RPC', async () => {
    await db.exec('RESET ROLE; SET ROLE anon');
    await rejects(() => rpc([product(4)]), /permission denied/);
    await db.exec('RESET ROLE');
  });
  for (const ids of [null, [], [null], [product(4),product(4)], Array.from({length:101},(_,i)=>product(i+1)), [product(4),uid(999)]]) {
    await check('invalid batch is rejected: ' + JSON.stringify(ids)?.slice(0,85), async () => {
      await actor(admin);
      await rejects(() => rpc(ids), /Chọn từ|bị trùng|không tồn tại/);
      await unchanged([product(4)]);
    });
  }
  await check('already deleted product rejects the whole batch', async () => {
    await actor(admin);
    await rejects(() => rpc([product(1),product(4)]), /đã xóa/);
    await unchanged([product(4)]);
  });
  await db.exec(`INSERT INTO inventory_transactions VALUES('${uid(200)}','${product(6)}',now()); INSERT INTO report_lines VALUES('${uid(201)}','${product(7)}');`);
  for (const n of [6,7]) {
    await check('history blocks deletion and rolls back earlier unused product: ' + n, async () => {
      await actor(admin);
      await rejects(() => rpc([product(5),product(n)]), /đã được sử dụng/);
      await unchanged([product(5),product(n)]);
    });
  }
  await check('direct Manager soft-delete is blocked by the database', async () => {
    await actor(manager);
    await rejects(() => db.query('UPDATE products SET deleted_at=now() WHERE id=$1',[product(4)]), /Chỉ Admin/);
    await unchanged([product(4)]);
  });
  await check('direct Admin soft-delete cannot bypass the history guard', async () => {
    await actor(admin);
    await rejects(() => db.query('UPDATE products SET deleted_at=now() WHERE id=$1',[product(6)]), /đã được sử dụng/);
    await unchanged([product(6)]);
  });
  await check('hard deletion is blocked even for the database owner', async () => {
    await db.exec('RESET ROLE');
    await rejects(() => db.query('DELETE FROM products WHERE id=$1',[product(4)]), /xóa vĩnh viễn/);
    await unchanged([product(4)]);
  });
  await check('deactivation still works for a product with history', async () => {
    await actor(admin);
    await db.query('UPDATE products SET is_active=false WHERE id=$1',[product(6)]);
    await unchanged([product(6)]);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM inventory_transactions')).rows[0].n,1);
  });
  await check('installation can rerun; postfix audit reports no problems', async () => {
    await db.exec('RESET ROLE');
    await db.exec(read('supabase-sql/20261121_fix_admin_product_soft_delete.sql'));
    assert.deepEqual((await db.query(read('supabase-sql/20261121_audit_admin_product_soft_delete_postfix.sql'))).rows,[]);
  });
  const signature = (await db.query(`SELECT p.proargnames,oidvectortypes(p.proargtypes) AS args,pg_get_function_result(p.oid) AS result FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_soft_delete_products_v1'`)).rows[0];
  assert.deepEqual(signature, { proargnames:['p_product_ids'],args:'uuid[]',result:'jsonb' });
  if (process.argv.includes('--write-types')) {
    const types = `// Generated from pg_proc in temporary PostgreSQL by scripts/test-product-deletion.mjs --write-types.\n// Scoped to the product deletion migration; does not describe the full production schema.\nexport type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\nexport type ProductDeletionFunctions = {\n  admin_soft_delete_products_v1: {\n    Args: { ${signature.proargnames[0]}: string[] };\n    Returns: Json;\n  };\n};\n`;
    writeFileSync(fileURLToPath(new URL('lib/product-deletion-database.types.ts',root)),types);
  }
  console.log(`${passed} PostgreSQL checks passed. No production access.`);
} finally { await db.close(); }
