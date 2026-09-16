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
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select public.gen_random_bytes(n) $$;`);
await db.exec(fs.readFileSync(new URL('./fixtures/schema-v1.sql',import.meta.url),'utf8').replace('create extension if not exists pgcrypto;',''));
await db.exec(fs.readFileSync(new URL('../supabase/multi-agencias.sql',import.meta.url),'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/hierarquia.sql',import.meta.url),'utf8'));
const A={a:'10000000-0000-4000-8000-000000000001',b:'10000000-0000-4000-8000-000000000002'};
const people={admin:null,donoB:['b','dono'],socioA:['a','socio'],headB:['b','head'],designerB:['b','designer'],trafegoB:['b','gestor_trafego'],designerA:['a','designer'],livre:null,livre2:null};
const id={};let i=1;
for(const k of Object.keys(people)){id[k]=`30000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;}
await db.exec(`insert into auth.users values ${Object.keys(people).map(k=>`('${id[k]}','${k}@example.test',now())`).join(',')};
insert into administradores values('${id.admin}');
insert into agencia_usuarios(agencia_id,usuario_id,papel) values ${Object.entries(people).filter(([,v])=>v).map(([k,[g,p]])=>`('${A[g]}','${id[k]}','${p}')`).join(',')};`);
const cli={},mes={},post={};
for(const g of ['a','b']){
  cli[g]=(await db.query(`insert into clientes(agencia_id,nome,slug,token) values($1,$2,'x',$3) returning id`,[A[g],'Cliente '+g,g.repeat(24)])).rows[0].id;
  mes[g]=(await db.query(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-10','Out',true) returning id`,[cli[g]])).rows[0].id;
  post[g]=(await db.query(`insert into posts(mes_id,titulo,slides) values($1,'P','[]') returning id`,[mes[g]])).rows[0].id;
}
let checks=0;const ok=()=>checks++;
async function as(who,fn){await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`);try{return await fn();}finally{await db.exec('reset role;');}}
const q=(s,p)=>db.query(s,p);
const rows=async(s,p)=>(await q(s,p)).rows;

// isolamento
for(const [who,n] of [['donoB',1],['designerB',1],['designerA',1],['socioA',1],['livre',0],['admin',2]]) await as(who,async()=>{
  assert.equal((await rows('select id from clientes')).length,n,who);ok();
  assert.equal((await rows('select id from posts')).length,n,who);ok();
  const c=(await rows('select meu_contexto() c'))[0].c;assert.equal(c.agencias.length,n);ok();
});
await as('donoB',async()=>{const c=(await rows('select meu_contexto() c'))[0].c;assert.equal(c.agencias[0].papel,'dono');assert.equal(c.agencias[0].nivel,3);assert.equal(c.superadmin,false);ok();});
await as('admin',async()=>{const c=(await rows('select meu_contexto() c'))[0].c;assert.ok(c.agencias.every(a=>a.nivel===4));ok();});

// equipe
await as('designerB',async()=>{
  await assert.rejects(q('select token from clientes'));ok();
  await assert.rejects(q('select link_cliente($1)',[cli.b]));ok();
  await assert.rejects(q('select renovar_link($1)',[cli.b]));ok();
  await assert.rejects(q(`insert into clientes(agencia_id,nome,slug) values($1,'N','n')`,[A.b]));ok();
  assert.equal((await rows(`update clientes set nome='H' where id=$1 returning id`,[cli.b])).length,0);ok();
  assert.equal((await rows(`update meses set titulo='Outubro' where id=$1 returning id`,[mes.b])).length,1);ok();
  await assert.rejects(q(`update meses set publicado=false where id=$1`,[mes.b]));ok();
  await assert.rejects(q(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-11','Nov',true)`,[cli.b]));ok();
  await q(`insert into meses(cliente_id,ano_mes,titulo) values($1,'2026-11','Nov')`,[cli.b]);ok();
  await q(`insert into posts(mes_id,titulo,slides) values($1,'Novo','[]')`,[mes.b]);ok();
  assert.equal((await rows(`update posts set titulo='Editado' where id=$1 returning id`,[post.b])).length,1);ok();
  await assert.rejects(q(`update posts set status='aprovado' where id=$1`,[post.b]));ok();
  await assert.rejects(q(`insert into posts(mes_id,titulo,slides,status) values($1,'X','[]','aprovado')`,[mes.b]));ok();
  assert.equal((await rows(`delete from posts where id=$1 returning id`,[post.b])).length,0);ok();
  await assert.rejects(q('select listar_acessos($1)',[A.b]));ok();
  await assert.rejects(q(`select autorizar_acesso($1,'livre@example.test','designer')`,[A.b]));ok();
  await assert.rejects(q(`update posts set titulo='X' where id=$1`,[post.a]).then(r=>{if(!r.affectedRows)throw new Error('sem acesso');}));ok();
});
// cliente pede ajuste; equipe marca como ajustado
await db.exec('set role anon');
assert.equal((await rows(`select registrar_aprovacao($1,$2,'ajuste','Trocar cor','Cliente') r`,['b'.repeat(24),post.b]))[0].r.status,'ajuste');ok();
await db.exec('reset role');
await as('designerB',async()=>{await q('select marcar_ajustado($1)',[post.b]);ok();await assert.rejects(q('select marcar_ajustado($1)',[post.a]));ok();});
assert.equal((await rows('select status from posts where id=$1',[post.b]))[0].status,'pendente');ok();

// head
await as('headB',async()=>{
  assert.equal((await rows('select link_cliente($1) t',[cli.b]))[0].t,'b'.repeat(24));ok();
  await q(`update meses set publicado=true where cliente_id=$1`,[cli.b]);ok();
  await q(`insert into clientes(agencia_id,nome,slug) values($1,'Novo','novo')`,[A.b]);ok();
  await assert.rejects(q(`insert into clientes(agencia_id,nome,slug) values($1,'Invasor','inv')`,[A.a]));ok();
  await q(`select autorizar_acesso($1,'livre@example.test','editor_video','Livre')`,[A.b]);ok();
  await assert.rejects(q(`select autorizar_acesso($1,'livre2@example.test','head')`,[A.b]));ok();
  await assert.rejects(q(`select autorizar_acesso($1,'designerA@example.test','designer')`,[A.b]));ok();
  await assert.rejects(q(`select autorizar_acesso($1,'livre2@example.test','designer')`,[A.a]));ok();
  await assert.rejects(q(`select autorizar_acesso($1,'admin@example.test','designer')`,[A.b]));ok();
  await assert.rejects(q('select revogar_acesso($1,$2)',[A.b,id.donoB]));ok();
  await assert.rejects(q(`select alterar_papel($1,$2,'head')`,[A.b,id.designerB]));ok();
  await q(`select alterar_papel($1,$2,'social_media')`,[A.b,id.trafegoB]);ok();
  const l=(await rows('select listar_acessos($1) l',[A.b]))[0].l;
  assert.equal(l.find(x=>x.papel==='dono').pode_gerir,false);assert.equal(l.find(x=>x.email==='livre@example.test').pode_gerir,true);ok();
  await q('select revogar_acesso($1,$2)',[A.b,id.livre]);ok();
  assert.equal((await rows(`delete from posts where titulo='Novo' returning id`)).length,1);ok();
});
// dono
await as('donoB',async()=>{
  await q(`select autorizar_acesso($1,'livre@example.test','head')`,[A.b]);ok();
  await assert.rejects(q(`select autorizar_acesso($1,'livre2@example.test','socio')`,[A.b]));ok();
  await assert.rejects(q(`select autorizar_acesso($1,'socioA@example.test','designer')`,[A.b]));ok();
  await assert.rejects(q('select listar_acessos($1)',[A.a]));ok();
  await q(`select alterar_papel($1,$2,'designer')`,[A.b,id.livre]);ok();
});
await as('headB',async()=>{await q('select revogar_acesso($1,$2)',[A.b,id.livre]);ok();});
// sócio da outra agência não enxerga B
await as('socioA',async()=>{
  assert.equal((await rows('select id from clientes where agencia_id=$1',[A.b])).length,0);ok();
  await assert.rejects(q('select link_cliente($1)',[cli.b]));ok();
  await q(`select autorizar_acesso($1,'livre2@example.test','head')`,[A.a]);ok();
});
// admin
await as('admin',async()=>{
  await q(`select autorizar_acesso($1,'livre@example.test','dono')`,[A.b]);ok();
  await q(`select autorizar_acesso($1,'livre2@example.test','designer')`,[A.b]);ok();
  const c=(await rows('select count(*)::int n from agencia_usuarios where usuario_id=$1',[id.livre2]))[0].n;assert.equal(c,2);ok();
});
await as('livre',async()=>{assert.equal((await rows('select meu_contexto() c'))[0].c.agencias[0].papel,'dono');ok();});
await db.exec('set role anon');await assert.rejects(q('select meu_contexto()'));ok();await db.exec('reset role');
console.log('PASS:',checks,'hierarchy checks: isolation, team limits, hidden client link, publish/delete by Head+, status protection, access management by level.');
await db.close();
