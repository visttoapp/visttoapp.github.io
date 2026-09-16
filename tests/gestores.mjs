import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function public.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex')::bytea $$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select public.gen_random_bytes(n) $$;`);
const rd=f=>fs.readFileSync(new URL(f,import.meta.url),'utf8');
await db.exec(rd('./fixtures/schema-v1.sql').replace('create extension if not exists pgcrypto;',''));
for(const f of ['multi-agencias','hierarquia','squads','convites','divisoes','gestores']) await db.exec(rd(`../supabase/${f}.sql`));
const A={a:'10000000-0000-4000-8000-000000000001',b:'10000000-0000-4000-8000-000000000002'};
const P={admin:null,dono:['b','dono'],head1:['b','head'],head2:['b','head'],des1:['b','designer'],des2:['b','designer'],traf:['b','gestor_trafego'],traf2:['b','gestor_trafego'],headA:['a','head'],trafA:['a','gestor_trafego'],desA:['a','designer']};
const id={};let i=1;for(const k in P)id[k]=`50000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
await db.exec(`insert into auth.users values ${Object.keys(P).map(k=>`('${id[k]}','${k}@x.test',now())`).join(',')};
insert into administradores values('${id.admin}');
insert into agencia_usuarios(agencia_id,usuario_id,papel) values ${Object.entries(P).filter(([,v])=>v).map(([k,[g,p]])=>`('${A[g]}','${id[k]}','${p}')`).join(',')};`);
const q=(s,p)=>db.query(s,p), rows=async(s,p)=>(await q(s,p)).rows;
const S1=(await rows(`insert into squads(agencia_id,nome) values($1,'Squad 1') returning id`,[A.b]))[0].id;
const S2=(await rows(`insert into squads(agencia_id,nome) values($1,'Squad 2') returning id`,[A.b]))[0].id;
await q(`insert into squad_membros values($1,$2),($1,$3),($1,$4),($1,$5),($6,$7),($6,$8),($6,$4)`,[S1,id.head1,id.des1,id.traf,id.traf2,S2,id.head2,id.des2]);
const C={};const PO={};
for(const [k,s,g] of [['c1',S1,'b'],['c1b',S1,'b'],['c2',S2,'b'],['c0',null,'b'],['ca1',null,'a'],['ca2',null,'a']]){
  C[k]=(await rows(`insert into clientes(agencia_id,squad_id,nome,slug,token) values($1,$2,$3,$3,$4) returning id`,[A[g],s,k,k.repeat(12)]))[0].id;
  const m=(await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-10','Out',true) returning id`,[C[k]]))[0].id;
  PO[k]=(await rows(`insert into posts(mes_id,titulo,slides) values($1,'P',$2) returning id`,[m,JSON.stringify([`midia:${A[g]}/${k}.jpg`])]))[0].id;
  await q(`insert into storage.objects(bucket_id,name) values('midia',$1)`,[`${A[g]}/${k}.jpg`]);
}
let checks=0;const ok=()=>checks++;
async function as(who,fn){await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`);try{return await fn();}finally{await db.exec('reset role;');}}
const nomes=async()=>(await rows('select nome from clientes order by nome')).map(r=>r.nome).join(',');
const midias=async()=>(await rows('select name from storage.objects')).map(r=>r.name.split('/')[1]).sort().join(',');
const posts=async()=>(await rows('select count(*)::int n from posts'))[0].n;
const lista=async(who,ag)=>(await rows('select clientes_do_gestor($1,$2) l',[A[ag],id[who]]))[0].l;
const qtd=async(who,ag)=>(await rows('select listar_acessos($1) l',[A[ag]]))[0].l.find(x=>x.email===who+'@x.test')?.clientes;

// sem atribuição, gestor não vê nada
for(const w of ['traf','traf2','trafA']) await as(w,async()=>{assert.equal(await nomes(),'',w);ok();assert.equal(await posts(),0);ok();assert.equal(await midias(),'');ok();});
// demais papéis seguem os squads
const base={admin:'c0,c1,c1b,c2,ca1,ca2',dono:'c0,c1,c1b,c2',head1:'c1,c1b',head2:'c2',des1:'c1,c1b',des2:'c2',headA:'ca1,ca2',desA:'ca1,ca2'};
for(const [w,e] of Object.entries(base)) await as(w,async()=>{assert.equal(await nomes(),e,w);ok();});

await as('head1',async()=>{
  assert.equal((await lista('traf','b')).map(x=>x.nome).join(),'c1,c1b');ok();
  assert.ok((await lista('traf','b')).every(x=>!x.marcado));ok();
  await q('select definir_gestor_cliente($1,$2,true)',[C.c1,id.traf]);ok();
  assert.equal((await lista('traf','b')).filter(x=>x.marcado).map(x=>x.nome).join(),'c1');ok();
  await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c2,id.traf]));ok();
  await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c1,id.des1]));ok();
  await assert.rejects(q('select clientes_do_gestor($1,$2)',[A.b,id.des1]));ok();
  await assert.rejects(q('select * from cliente_gestores'));ok();
  assert.equal(await qtd('traf','b'),1);ok();
  assert.equal(await qtd('des1','b'),null);ok();
});
await as('traf',async()=>{
  assert.equal(await nomes(),'c1');ok();
  assert.equal(await posts(),1);ok();
  assert.equal(await midias(),'c1.jpg');ok();
  await q(`update posts set titulo='ok' where id=$1`,[PO.c1]);ok();
  assert.equal((await rows(`update posts set titulo='x' where id=$1 returning id`,[PO.c1b])).length,0);ok();
  await q('select marcar_ajustado($1)',[PO.c1]);ok();
  await assert.rejects(q('select marcar_ajustado($1)',[PO.c1b]));ok();
  await assert.rejects(q('select link_cliente($1)',[C.c1]));ok();
  await assert.rejects(q('select clientes_do_gestor($1,$2)',[A.b,id.traf]));ok();
  await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c1b,id.traf]));ok();
  await assert.rejects(q('select * from cliente_gestores'));ok();
  await assert.rejects(q(`insert into meses(cliente_id,ano_mes,titulo) values($1,'2026-11','N')`,[C.c1b]));ok();
  await q(`insert into meses(cliente_id,ano_mes,titulo) values($1,'2026-11','N')`,[C.c1]);ok();
});
// gestor em dois squads: cada Head atribui os próprios clientes
await as('head2',async()=>{
  assert.equal((await lista('traf','b')).map(x=>x.nome).join(),'c2');ok();
  await q('select definir_gestor_cliente($1,$2,true)',[C.c2,id.traf]);ok();
  assert.equal(await qtd('traf','b'),1);ok();
  await assert.rejects(q('select definir_gestor_cliente($1,$2,false)',[C.c1,id.traf]));ok();
});
await as('traf',async()=>{assert.equal(await nomes(),'c1,c2');ok();assert.equal(await midias(),'c1.jpg,c2.jpg');ok();});
await as('traf2',async()=>{assert.equal(await nomes(),'');ok();});
await as('des1',async()=>{assert.equal(await nomes(),'c1,c1b');ok();});
await as('dono',async()=>{
  assert.equal((await lista('traf','b')).map(x=>x.nome).join(),'c1,c1b,c2');ok();
  assert.equal(await qtd('traf','b'),2);ok();
  await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c0,id.traf]));ok();
  await q('select definir_gestor_cliente($1,$2,true)',[C.c1b,id.traf2]);ok();
});
await as('headA',async()=>{
  await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c1,id.traf]));ok();
  await assert.rejects(q('select clientes_do_gestor($1,$2)',[A.b,id.traf]));ok();
  // agência sem squads: Head escolhe entre todos os clientes
  assert.equal((await lista('trafA','a')).map(x=>x.nome).join(),'ca1,ca2');ok();
  await q('select definir_gestor_cliente($1,$2,true)',[C.ca1,id.trafA]);ok();
  await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c1,id.trafA]));ok();
});
await as('trafA',async()=>{assert.equal(await nomes(),'ca1');ok();assert.equal(await midias(),'ca1.jpg');ok();});
await as('desA',async()=>{assert.equal(await nomes(),'ca1,ca2');ok();});
await as('traf2',async()=>{assert.equal(await nomes(),'c1b');ok();});
// saiu do papel: perde as atribuições e passa a seguir o squad
await as('dono',async()=>{await q(`select alterar_papel($1,$2,'designer')`,[A.b,id.traf2]);ok();});
assert.equal((await rows('select count(*)::int n from cliente_gestores where usuario_id=$1',[id.traf2]))[0].n,0);ok();
await as('traf2',async()=>{assert.equal(await nomes(),'c1,c1b');ok();});
// saiu do squad 1: perde c1, mantém c2
await as('head1',async()=>{await q('select revogar_acesso($1,$2)',[A.b,id.traf]);ok();});
await as('traf',async()=>{assert.equal(await nomes(),'c2');ok();});
// cliente mudou de squad: gestor fora do novo squad perde o cliente
await as('dono',async()=>{await q('update clientes set squad_id=$1 where id=$2',[S1,C.c2]);ok();});
await as('traf',async()=>{assert.equal(await nomes(),'');ok();});
// saiu da agência
await as('headA',async()=>{await q('select revogar_acesso($1,$2)',[A.a,id.trafA]);ok();});
assert.equal((await rows('select count(*)::int n from cliente_gestores where usuario_id=$1',[id.trafA]))[0].n,0);ok();
await as('admin',async()=>{assert.equal(await nomes(),'c0,c1,c1b,c2,ca1,ca2');ok();});
await db.exec('set role anon');
await assert.rejects(q('select clientes_do_gestor($1,$2)',[A.b,id.traf]));ok();
await assert.rejects(q('select definir_gestor_cliente($1,$2,true)',[C.c1,id.traf]));ok();
await assert.rejects(q('select * from cliente_gestores'));ok();
await db.exec('reset role');
console.log('PASS:',checks,'gestor checks: assigned clients only, shared squads, head/owner scope, cleanup, no-squad agency.');
await db.close();
