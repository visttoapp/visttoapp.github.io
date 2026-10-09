import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function public.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex')::bytea $$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select public.gen_random_bytes(n) $$;`);
const rd = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
await db.exec(rd('./fixtures/schema-v1.sql').replace('create extension if not exists pgcrypto;', ''));
for (const f of ['multi-agencias', 'hierarquia', 'squads', 'convites', 'divisoes', 'gestores', 'espaco', 'r2', 'endurecer', 'espaco-r2', 'anuncios']) await db.exec(rd(`../supabase/historico/${f}.sql`));
await db.exec(rd('../supabase/pauta.sql'));
await db.exec(rd('../supabase/pauta.sql'));   // rodar de novo não pode quebrar

const A = { a: '10000000-0000-4000-8000-000000000001', b: '10000000-0000-4000-8000-000000000002' };
const P = { dono: ['b', 'dono'], head: ['b', 'head'], des: ['b', 'designer'], outra: ['a', 'designer'], fora: null };
const id = {}; let i = 1; for (const k in P) id[k] = `90000000-0000-4000-8000-${String(i++).padStart(12, '0')}`;
await db.exec(`insert into auth.users values ${Object.keys(P).map(k => `('${id[k]}','${k}@x.test',now())`).join(',')};
insert into agencia_usuarios(agencia_id,usuario_id,papel,nome) values ${Object.entries(P).filter(([, v]) => v).map(([k, [g, p]]) => `('${A[g]}','${id[k]}','${p}',${k === 'des' ? "'Fernanda Costa'" : 'null'})`).join(',')};`);
const q = (s, p) => db.query(s, p), rows = async (s, p) => (await q(s, p)).rows;
let checks = 0; const ok = () => checks++;
async function as(who, fn) { await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`); try { return await fn(); } finally { await db.exec(`reset role;set request.jwt.claim.sub='';`); } }

await q('update agencias set usa_squads=false where id=$1', [A.b]);   // sem squads: a equipe toda vê os clientes
const TOKEN = 'cd'.repeat(16);
const cli = (await rows(`insert into clientes(agencia_id,nome,slug,token) values($1,'Prime','prime',$2) returning id`, [A.b, TOKEN]))[0].id;
const mes = (await rows(`insert into meses(cliente_id,ano_mes,titulo) values($1,'2026-10','Outubro') returning id`, [cli]))[0].id;
const novo = async (extra = {}) => (await rows(`insert into posts(mes_id,numero,titulo,responsavel,interno) values($1,$2,'Post',$3,$4) returning id`,
  [mes, extra.numero || '01', extra.responsavel || null, extra.interno || null]))[0].id;

/* ---------- publicado_em ---------- */
assert.equal((await rows('select publicado_em from meses where id=$1', [mes]))[0].publicado_em, null); ok();
await q('update meses set publicado=true where id=$1', [mes]);
const pub1 = (await rows('select publicado_em from meses where id=$1', [mes]))[0].publicado_em;
assert.ok(pub1); ok();
await q(`update meses set titulo='Outubro 2026' where id=$1`, [mes]);
assert.equal(+(await rows('select publicado_em from meses where id=$1', [mes]))[0].publicado_em, +pub1); ok();   // editar não muda a data

/* ---------- responsável ---------- */
const p1 = await novo({ numero: '01', responsavel: id.des });
assert.ok(p1); ok();
await assert.rejects(novo({ numero: '02', responsavel: id.outra }), /equipe da agência/); ok();   // de outra agência
await assert.rejects(novo({ numero: '02', responsavel: id.fora }), /equipe da agência/); ok();
await assert.rejects(q(`update posts set interno='rascunho' where id=$1`, [p1])); ok();             // valor inválido

/* ---------- revisão interna: equipe manda, só Head+ libera ---------- */
const p2 = await novo({ numero: '02' });
assert.equal((await as('des', () => q(`update posts set interno='revisao' where id=$1`, [p2]))).affectedRows, 1); ok();
await assert.rejects(as('des', () => q(`update posts set interno=null where id=$1`, [p2])), /Só Head/); ok();
await as('des', () => q(`update posts set interno='reserva' where id=$1`, [p2])); ok();          // da revisão para a gaveta, pode
await as('des', () => q(`update posts set interno='revisao' where id=$1`, [p2]));
await as('head', () => q(`update posts set interno=null where id=$1`, [p2])); ok();
assert.equal((await rows('select interno from posts where id=$1', [p2]))[0].interno, null); ok();
const p3 = await novo({ numero: '03', interno: 'reserva' });
await as('des', () => q(`update posts set interno=null where id=$1`, [p3])); ok();                // gaveta → link, qualquer um
await q(`update posts set interno='reserva' where id=$1`, [p3]);
const p4 = await novo({ numero: '04', interno: 'revisao' });

/* ---------- o link do cliente não vê nem responde a post interno ---------- */
const nums = async () => (await rows(`select jsonb_path_query_array(get_mes($1,null,null,null),'$.posts[*].numero') n`, [TOKEN]))[0].n;
assert.deepEqual(await nums(), ['01', '02']); ok();
await assert.rejects(q(`select registrar_aprovacao($1,$2,'aprovado')`, [TOKEN, p4]), /token inválido/); ok();
await assert.rejects(q(`select registrar_aprovacao($1,$2,'aprovado')`, [TOKEN, p3]), /token inválido/); ok();
await q(`select registrar_aprovacao($1,$2,'aprovado')`, [TOKEN, p1]); ok();
assert.equal((await rows('select status from posts where id=$1', [p1]))[0].status, 'aprovado'); ok();
await q('update posts set interno=null where id=$1', [p4]);
assert.deepEqual(await nums(), ['01', '02', '04']); ok();

/* ---------- membros da agência ---------- */
const membros = async who => (await as(who, () => rows('select membros_agencia($1) m', [A.b])))[0].m;
const m = await membros('des');
assert.deepEqual(m.map(x => x.nome).sort(), ['Fernanda Costa', 'dono', 'head']); ok();   // sem nome: começo do e-mail
assert.ok(m.every(x => x.usuario_id && x.papel)); ok();
assert.deepEqual(await membros('outra'), []); ok();                                     // outra agência não vê
assert.deepEqual(await membros('fora'), []); ok();
await assert.rejects(db.exec(`set role anon; select membros_agencia('${A.b}')`)); ok();
await db.exec('reset role');

console.log('PASS:', checks, 'checks da pauta: responsável da agência, revisão interna só liberada por Head+, gaveta fora do link e membros por agência.');
