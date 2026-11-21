/* eslint-disable @typescript-eslint/no-require-imports -- Execute actual TypeScript handlers with fake API responses. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
const compile = source => ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const loaded = {exports:{}};
new Function('module','exports',compile(fs.readFileSync(path.join(root,'lib/product-deletion.ts'),'utf8')))(loaded,loaded.exports);
const {softDeleteProducts} = loaded.exports;
const source = fs.readFileSync(path.join(root,'app/(protected)/products/page.tsx'),'utf8');
const tree = ts.createSourceFile('products.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];
function visit(node){nodes.push(node);ts.forEachChild(node,visit);}
visit(tree);

test('product Admin gates use the database authority and revoke stale permission',()=>{
  const adminRoleChecks=nodes.filter(ts.isBinaryExpression).filter(n=>[n.left,n.right].some(x=>ts.isStringLiteral(x)&&x.text==='admin'));
  assert.equal(adminRoleChecks.length,0);
  for(const gate of ['canEdit','canDelete']){
    assert.equal(nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===gate)?.initializer?.getText(tree),'isAdmin');
  }
  assert.ok(nodes.some(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='loadAdminPermission'&&n.arguments[0]?.getText(tree)==='supabase'));
  assert.ok(nodes.filter(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='setIsAdmin'&&n.arguments[0]?.kind===ts.SyntaxKind.FalseKeyword).length>=2);
  assert.doesNotMatch(source,/deleted_at:\s*new Date/);
});

test('successful RPC must report the exact deleted count',async()=>{
  const calls=[];
  await softDeleteProducts({rpc:async(name,args)=>{calls.push({name,args});return{data:{success:true,deleted_count:2},error:null};}},['a','b']);
  assert.deepEqual(calls,[{name:'admin_soft_delete_products_v1',args:{p_product_ids:['a','b']}}]);
});
for(const data of [null,{}, {success:false,deleted_count:1},{success:true,deleted_count:0}]){
  test('missing or partial server result cannot produce success: '+JSON.stringify(data),async()=>{
    await assert.rejects(softDeleteProducts({rpc:async()=>({data,error:null})},['a']),/Chưa xác nhận/);
  });
}
for(const code of ['PGRST202','42883']){
  test('missing database migration gives installation instructions: '+code,async()=>{
    await assert.rejects(softDeleteProducts({rpc:async()=>({data:null,error:{code,message:'missing function'}})},['a']),/20261121_fix_admin_product_soft_delete.sql/);
  });
}
test('database denial retains the actual message',async()=>{
  await assert.rejects(softDeleteProducts({rpc:async()=>({data:null,error:{code:'23503',message:'Mã hàng đã được sử dụng'}})},['a']),/đã được sử dụng/);
});

function fixture({allowed=true,confirm=true,error=null}={}){
  const calls=[],toasts=[],errors=[],selections=[],flags=[];
  const deletingRef={current:false};
  const context={
    canDelete:allowed,deletingRef,rows:[{id:'a',sku:'TEST-A'},{id:'b',sku:'TEST-B'}],selectedIds:new Set(['a','b']),
    showToast:(message,kind)=>toasts.push({message,kind}),setDeleting:value=>flags.push(value),
    showConfirm:async options=>{calls.push({confirm:options});return typeof confirm==='function'?confirm():confirm;},
    setError:message=>errors.push(message),supabase:{},
    softDeleteProducts:async(client,ids)=>{calls.push({write:ids});if(error)throw error;},
    setSelectedIds:value=>selections.push([...value]),load:async()=>{calls.push({reload:true});},
  };
  const code=['deleteProducts','bulkDelete','del'].map(name=>nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree)).join('\n');
  const handlers=new Function(...Object.keys(context),compile(code)+';return {deleteProducts,bulkDelete,del};')(...Object.values(context));
  return {...handlers,calls,toasts,errors,selections,flags,deletingRef};
}
test('single and bulk actions use the same guarded deletion path',async()=>{
  for(const bulk of [false,true]){
    const f=fixture();
    await(bulk?f.bulkDelete():f.del({id:'a'}));
    assert.deepEqual(f.calls.find(x=>x.write)?.write,bulk?['a','b']:['a']);
    assert.match(f.calls[0].confirm.message,/không xóa lịch sử/i);
    assert.equal(f.toasts.at(-1).kind,'success');
    assert.deepEqual(f.selections,[[]]);
    assert.equal(f.deletingRef.current,false);
  }
});
test('denied deletion never confirms or writes',async()=>{
  const f=fixture({allowed:false});await f.del({id:'a'});
  assert.deepEqual(f.calls,[]);assert.equal(f.toasts[0].kind,'error');
});
test('cancellation releases the busy guard and sends no write',async()=>{
  const f=fixture({confirm:false});await f.del({id:'a'});
  assert.equal(f.calls.length,1);assert.deepEqual(f.toasts,[]);assert.equal(f.deletingRef.current,false);
});
test('database failure preserves selection and avoids a success toast',async()=>{
  const f=fixture({error:Error('Đã có lịch sử')});await f.bulkDelete();
  assert.equal(f.errors.at(-1),'Đã có lịch sử');assert.deepEqual(f.selections,[]);assert.deepEqual(f.toasts,[]);assert.equal(f.deletingRef.current,false);
});
test('double click while confirming sends only one deletion',async()=>{
  let resolveConfirm;
  const f=fixture({confirm:()=>new Promise(resolve=>{resolveConfirm=resolve;})});
  const first=f.del({id:'a'});await f.del({id:'b'});resolveConfirm(true);await first;
  assert.equal(f.calls.filter(x=>x.confirm).length,1);assert.deepEqual(f.calls.filter(x=>x.write),[{write:['a']}]);
});
test('over-limit selection is blocked before confirmation',async()=>{
  const f=fixture();await f.deleteProducts(Array.from({length:101},(_,i)=>String(i)));
  assert.deepEqual(f.calls,[]);assert.match(f.toasts[0].message,/100/);
});
