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
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function public.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex')::bytea $$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select public.gen_random_bytes(n) $$;
`);
let schema=fs.readFileSync(new URL('./fixtures/schema-v1.sql',import.meta.url),'utf8').replace('create extension if not exists pgcrypto;','');
await db.exec(schema);
await db.exec(fs.readFileSync(new URL('../supabase/multi-agencias.sql',import.meta.url),'utf8'));
const ids={owner:'20000000-0000-4000-8000-000000000001',con:'20000000-0000-4000-8000-000000000002',for:'20000000-0000-4000-8000-000000000003',none:'20000000-0000-4000-8000-000000000004'};
const ag={con:'10000000-0000-4000-8000-000000000001',for:'10000000-0000-4000-8000-000000000002'};
await db.exec(`insert into auth.users(id,email,email_confirmed_at) values ${Object.entries(ids).map(([k,v])=>`('${v}','${k}@example.test',now())`).join(',')};insert into public.administradores values('${ids.owner}');insert into agencia_usuarios values('${ag.con}','${ids.con}'),('${ag.for}','${ids.for}');`);
const clients={};const posts={};
for(const k of ['con','for']){
  const c=(await db.query(`insert into clientes(agencia_id,nome,slug,token) values($1,$2,'mesmo-slug',$3) returning *`,[ag[k],k,k.repeat(24)])).rows[0];clients[k]=c;
  const m=(await db.query(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-09','Setembro',true) returning id`,[c.id])).rows[0];
  const p=(await db.query(`insert into posts(mes_id,titulo,slides) values($1,'Post',$2) returning *`,[m.id,JSON.stringify(['midia:'+ag[k]+'/image.jpg'])])).rows[0];posts[k]=p;
  await db.query(`insert into storage.objects(bucket_id,name) values('midia',$1)`,[ag[k]+'/image.jpg']);
}
async function as(who,fn){await db.exec(`set role authenticated;set request.jwt.claim.sub='${ids[who]}';`);try{return await fn();}finally{await db.exec('reset role;');}}
let checks=0;
for(const who of ['con','for','none','owner']) await as(who,async()=>{
  const expected=who==='owner'?2:who==='none'?0:1;
  for(const table of ['clientes','meses','posts','storage.objects']){assert.equal((await db.query(`select * from ${table}`)).rows.length,expected,who+' '+table);checks++;}
  const ctx=(await db.query('select meu_contexto() as c')).rows[0].c;assert.equal(ctx.agencias.length,expected);checks++;
});
await as('con',async()=>{
  assert.equal((await db.query(`update posts set titulo='HACK' where id=$1 returning *`,[posts.for.id])).rows.length,0);checks++;
  await assert.rejects(db.query(`insert into clientes(agencia_id,nome,slug) values($1,'HACK','hack')`,[ag.for]));checks++;
  await assert.rejects(db.query(`update posts set slides=$1 where id=$2`,[JSON.stringify(['midia:'+ag.for+'/image.jpg']),posts.con.id]));checks++;
  await assert.rejects(db.query(`select autorizar_acesso($1,'none@example.test')`,[ag.con]));checks++;
  await assert.rejects(db.query(`select marcar_ajustado($1)`,[posts.for.id]));checks++;
  await db.query(`select marcar_ajustado($1)`,[posts.con.id]);checks++;
});
await db.exec('set role anon');
await assert.rejects(db.query('select * from clientes'));checks++;
assert.equal((await db.query(`select registrar_aprovacao($1,$2,'aprovado',null,'Cliente') as r`,[clients.con.token,posts.con.id])).rows[0].r.status,'aprovado');checks++;
await assert.rejects(db.query(`select registrar_aprovacao($1,$2,'aprovado',null,'Cliente')`,[clients.con.token,posts.for.id]));checks++;
await db.exec('reset role');
await db.query(`update meses set publicado=false where id=$1`,[posts.con.mes_id]);
await db.exec('set role anon');await assert.rejects(db.query(`select registrar_aprovacao($1,$2,'aprovado',null,'Cliente')`,[clients.con.token,posts.con.id]));checks++;await db.exec('reset role');
await as('owner',async()=>{await db.query(`select autorizar_acesso($1,'none@example.test')`,[ag.for]);checks++;});
await as('none',async()=>{assert.equal((await db.query('select * from clientes')).rows[0].id,clients.for.id);checks++;});
console.log('PASS:',checks,'checks: agency isolation, owner access, unassigned account, private media, approvals, unpublished month and access management.');
await db.close();
