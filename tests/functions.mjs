import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {stripTypeScriptTypes} from 'node:module';
let checks=0;
function load(name,client){
 let handler;
 const source=fs.readFileSync(new URL(`../supabase/functions/${name}/index.ts`,import.meta.url),'utf8').replace(/import .*?;\n/,'');
 vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>client,Request,Response,Map,Promise,console,crypto,btoa,TextEncoder,Uint8Array,Uint32Array,Array,String,Date,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.supabase.co':'server-only-key'},serve:fn=>{handler=fn;}}});
 return handler;
}
const req=(body,auth)=>new Request('https://test/functions/v1/acessos',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
const AG='10000000-0000-4000-8000-000000000002',ALVO='30000000-0000-4000-8000-000000000009';
const convites=new Map();let usaSquads=true;let creates=0,deletes=0,updates=0,mode='ok',memberRole=null,alvoRole='designer',alvoAdmin=false,alvoCount=1,inserted=null,meus=['S1'],deles=['S1'],squadOk=true,squadInserts=[];
const fake={auth:{getUser:async jwt=>jwt==='valid'?{data:{user:{id:'caller'}}}:{data:{},error:{}},admin:{
  createUser:async()=>{creates++;return {data:{user:{id:'created'}}};},deleteUser:async()=>{deletes++;},updateUserById:async()=>{updates++;return {error:null};}}},
 from:table=>{
  const f={};
  const q={select:(c,o)=>{f.head=o?.head;return q;},eq:(k,v)=>{f[k]=v;return q;},
   maybeSingle:async()=>{
    if(table==='administradores')return {data:f.usuario_id==='caller'?(mode==='admin'?{usuario_id:'caller'}:null):(alvoAdmin?{usuario_id:ALVO}:null)};
    if(table==='agencia_usuarios')return {data:f.usuario_id==='caller'?(memberRole?{papel:memberRole}:null):(alvoRole?{papel:alvoRole}:null)};
    if(table==='squads')return {data:squadOk?{id:'S1'}:null};
    return {data:mode==='badagency'?null:{id:AG,usa_squads:usaSquads}};
   },
   then:(res)=>res(table==='squad_membros'?{data:(f.usuario_id==='caller'?meus:deles).map(x=>({squad_id:x})),error:null}:{count:alvoCount,error:null}),
   upsert:async row=>{convites.set(row.usuario_id,row);return {error:null};},
   insert:async row=>{if(table==='squad_membros'){squadInserts.push(row);return {error:null};}inserted=row;return {error:mode==='dbfail'?{}:null};}};
  return q;
 }};
const access=load('acessos',fake);const valid={email:'pessoa@example.test',agencia_id:AG,papel:'designer',nome:'Pessoa'};
const res=async(body,auth='valid')=>{const r=await access(req(body,auth));return {status:r.status,body:await r.json()};};
const call=async(body,auth)=>(await res(body,auth)).status;
for(const [auth,status] of [[null,401],['invalid',401]]){assert.equal(await call(valid,auth),status);assert.equal(creates,0);checks++;}
memberRole=null;assert.equal(await call(valid),403);checks++;
memberRole='designer';assert.equal(await call(valid),403);checks++;
memberRole='head';assert.equal(await call({...valid,papel:'head'}),403);checks++;
assert.equal(await call({...valid,papel:'admin'}),400);checks++;
memberRole='dono';assert.equal(await call({...valid,papel:'socio'}),403);checks++;
assert.match((await res({...valid,email:'sem-arroba'})).body.error,/E-mail inválido/);checks++;
assert.equal(await call({...valid,agencia_id:'agency'}),400);checks++;
mode='badagency';assert.equal(await call(valid),400);checks++;
assert.equal(creates,0);checks++;
mode='ok';memberRole='head';assert.equal(await call(valid),403);assert.equal(creates,0);checks++;
const SQ='50000000-0000-4000-8000-000000000001';
meus=[SQ];squadOk=false;assert.equal(await call({...valid,squad_id:SQ}),400);checks++;
squadOk=true;meus=['outro'];assert.equal(await call({...valid,squad_id:SQ}),403);checks++;
assert.equal(await call({...valid,squad_id:'x'}),400);checks++;
meus=[SQ];{const r=await res({...valid,squad_id:SQ});assert.equal(r.status,200);assert.match(r.body.codigo,/^\d{6}$/);assert.ok(convites.get('created').codigo_hash.length===64);}assert.equal(creates,1);assert.equal(squadInserts.length,1);assert.equal(squadInserts[0].squad_id,SQ);assert.equal(inserted.papel,'designer');assert.equal(inserted.criado_por,'caller');checks++;
memberRole='dono';assert.equal(await call({...valid,papel:'head'}),200);assert.equal(creates,2);assert.equal(squadInserts.length,1);checks++;
mode='admin';memberRole=null;assert.equal(await call({...valid,papel:'dono'}),200);assert.equal(creates,3);checks++;
mode='dbfail';memberRole='dono';assert.equal(await call(valid),400);assert.equal(deletes,1);checks++;
// redefinir senha
mode='ok';const s={acao:'codigo',agencia_id:AG,usuario_id:ALVO};
memberRole='designer';assert.equal(await call(s),403);checks++;
memberRole='head';alvoRole='head';assert.equal(await call(s),403);checks++;
alvoRole='dono';assert.equal(await call(s),403);checks++;
alvoRole=null;assert.equal(await call(s),403);checks++;
alvoRole='designer';
alvoCount=2;assert.equal(await call(s),403);checks++;
alvoCount=1;alvoAdmin=true;assert.equal(await call(s),403);checks++;
alvoAdmin=false;assert.equal(await call({...s,usuario_id:'x'}),400);checks++;
assert.equal(updates,0);checks++;
meus=['S1'];deles=['S2'];assert.equal(await call(s),403);checks++;
deles=['S2','S1'];{const r=await res(s);assert.equal(r.status,200);assert.match(r.body.codigo,/^\d{6}$/);}assert.equal(updates,1);checks++;
memberRole='dono';deles=[];assert.equal(await call(s),200);assert.equal(updates,2);checks++;memberRole='head';
mode='admin';memberRole=null;alvoRole='dono';alvoCount=2;assert.equal(await call(s),200);assert.equal(updates,3);checks++;
mode='ok';
// agência sem squads: Head cria e redefine sem squad; squad é recusado
usaSquads=false;memberRole='head';meus=[];deles=[];alvoRole='designer';alvoCount=1;
{const n=creates;assert.equal(await call(valid),200);assert.equal(creates,n+1);checks++;}
assert.equal(await call({...valid,squad_id:'50000000-0000-4000-8000-000000000001'}),400);checks++;
assert.equal(await call(s),200);checks++;
usaSquads=true;
// primeiro acesso
{
 const {createHash}=await import('node:crypto');
 const h=t=>createHash('sha256').update(t).digest('hex');
 const U='60000000-0000-4000-8000-000000000001';
 let conv={usuario_id:U,codigo_hash:h(U+':123456'),expira_em:new Date(Date.now()+864e5).toISOString(),tentativas:0};
 let upd=[],del=0,tent=[];
 const pa=load('primeiro-acesso',{rpc:async(n,a)=>({data:a.p_email.trim().toLowerCase()==='p@x.test'&&conv?[conv]:[]}),auth:{admin:{updateUserById:async(id,o)=>{upd.push([id,o]);return {error:null};}}},
   from:()=>{const q={update:v=>{tent.push(v.tentativas);conv={...conv,tentativas:v.tentativas};return q;},delete:()=>{del++;return q;},eq:async()=>({error:null})};return q;}});
 const r=async b=>{const x=await pa(req(b));return {status:x.status,body:await x.json()};};
 assert.equal((await r({email:'p@x.test',codigo:'12345',password:'senhaboa1'})).status,400);checks++;
 assert.match((await r({email:'p@x.test',codigo:'123456',password:'curta'})).body.error,/8/);checks++;
 assert.equal((await r({email:'outro@x.test',codigo:'123456',password:'senhaboa1'})).status,400);checks++;
 assert.equal((await r({email:'p@x.test',codigo:'654321',password:'senhaboa1'})).status,400);assert.deepEqual(tent,[1]);assert.equal(upd.length,0);checks++;
 conv.tentativas=5;assert.equal((await r({email:'p@x.test',codigo:'123456',password:'senhaboa1'})).status,400);assert.equal(upd.length,0);checks++;
 conv.tentativas=0;conv.expira_em=new Date(Date.now()-1000).toISOString();assert.equal((await r({email:'p@x.test',codigo:'123456',password:'senhaboa1'})).status,400);checks++;
 conv.expira_em=new Date(Date.now()+864e5).toISOString();
 const ok=await r({email:'P@x.test',codigo:' 123456 ',password:'senhaboa1'});
 assert.equal(ok.status,200);assert.equal(upd[0][0],U);assert.equal(upd[0][1].password,'senhaboa1');assert.equal(upd[0][1].user_metadata.trocar_senha,false);assert.equal(del,1);checks++;
}
let signed=[];let calls=0;
const customer=load('cliente',{rpc:async(name,args)=>{calls++;return {data:args.p_token==='a'.repeat(24)?{cliente:{nome:'Cliente',avatar_url:null},posts:[{slides:['midia:agency/a.jpg'],video_url:null,capa_url:null}],destaques:[]}:null};},storage:{from:()=>({createSignedUrl:async p=>{signed.push(p);return {data:{signedUrl:'https://test/signed/'+p}};}})}});
assert.equal(await (await customer(req({token:'invalid'}))).json(),null);assert.equal(calls,0);checks++;
assert.equal(await (await customer(req({token:'b'.repeat(24)}))).json(),null);assert.equal(signed.length,0);checks++;
const result=await (await customer(req({token:'a'.repeat(24)}))).json();assert.equal(result.posts[0].slides[0],'https://test/signed/agency/a.jpg');assert.deepEqual(signed,['agency/a.jpg']);checks++;
assert.equal((await customer(req({token:'a'.repeat(24),mes:'malformed'}))).status,400);checks++;
console.log('PASS:',checks,'server function authorization and media checks.');
