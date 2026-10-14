/* Vistto · Forno — confere a instalação (01 + 02) num Postgres de mentira (PGlite) que imita o Supabase
   com um taskmanager já instalado no schema public. Roda em segundos, sem tocar em nada de verdade.
   cd verificar && npm install && npm test */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const FORNO = '10000000-0000-4000-8000-000000000002';
const ler = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
let checks = 0; const ok = () => checks++;
const db = new PGlite();

/* ---------- Supabase de mentira + taskmanager no public ---------- */
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,invited_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex')::bytea $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- taskmanager: mesmos nomes que o Vistto usaria no public
create table public.pessoas(id uuid primary key references auth.users(id),nome text,email text,papel text default 'colaborador',situacao text default 'convidado');
create table public.clientes(id bigserial primary key,nome text unique,situacao text default 'Ativo');
create table public.comentarios(id bigserial primary key,texto text);
create function public.fn_nova_pessoa() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin insert into pessoas(id,nome,email,situacao) values(new.id,split_part(new.email,'@',1),new.email,case when new.invited_at is not null then 'ativo' else 'inativo' end) on conflict(id) do nothing; return new; end $$;
create trigger trg_nova_pessoa after insert on auth.users for each row execute function public.fn_nova_pessoa();
insert into public.clientes(nome) values ('Cliente do taskmanager A'),('Cliente do taskmanager B');
insert into public.comentarios(texto) values ('comentário do taskmanager');
`);
const ids = { dante: '20000000-0000-4000-8000-0000000000d1', socio: '20000000-0000-4000-8000-0000000000d2', designer: '20000000-0000-4000-8000-0000000000d3', fora: '20000000-0000-4000-8000-0000000000d4' };
await db.exec(`insert into auth.users(id,email,email_confirmed_at,invited_at) values ${Object.entries(ids).map(([k, v]) => `('${v}','${k}@forno.test',now(),now())`).join(',')};`);
const antes = (await db.query(`select (select count(*) from public.clientes)::int c, (select count(*) from public.comentarios)::int m, (select count(*) from pg_class where relnamespace='public'::regnamespace)::int obj, (select count(*) from pg_proc where pronamespace='public'::regnamespace)::int fn`)).rows[0];

/* ---------- instalação ---------- */
await db.exec(ler('../1-supabase/01-instalar-vistto.sql').replace('create extension if not exists pgcrypto with schema extensions;', ''));
await db.exec(ler('../1-supabase/02-primeiro-administrador.sql').replace('TROQUE-PELO-EMAIL@forno.com.br', 'Dante@Forno.test'));
await assert.rejects(db.exec(ler('../1-supabase/02-primeiro-administrador.sql')), /Não existe login/); ok();

/* ---------- o taskmanager ficou intacto ---------- */
const depois = (await db.query(`select (select count(*) from public.clientes)::int c, (select count(*) from public.comentarios)::int m, (select count(*) from pg_class where relnamespace='public'::regnamespace)::int obj, (select count(*) from pg_proc where pronamespace='public'::regnamespace)::int fn`)).rows[0];
assert.deepEqual(depois, antes); ok();
assert.equal((await db.query(`select count(*)::int n from vistto.clientes`)).rows[0].n, 0); ok();
assert.deepEqual((await db.query(`select id, slug from vistto.agencias`)).rows, [{ id: FORNO, slug: 'forno' }]); ok();

/* ---------- como o PostgREST chama: papel, usuário e schema vistto ---------- */
async function como(quem, fn) {
  await db.exec(quem === 'anon' ? `set role anon; set request.jwt.claim.sub=''; set search_path to vistto;`
    : `set role authenticated; set request.jwt.claim.sub='${ids[quem]}'; set search_path to vistto;`);
  try { return await fn(); } finally { await db.exec('reset role; reset search_path;'); }
}
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

// administrador geral (do 02) entra direto na Forno
await como('dante', async () => {
  const ctx = (await q('select meu_contexto() c'))[0].c;
  assert.equal(ctx.superadmin, true); assert.equal(ctx.agencias.length, 1); assert.equal(ctx.agencias[0].id, FORNO); ok();
  await q(`select autorizar_acesso($1,'socio@forno.test','socio')`, [FORNO]); ok();
});
// quem não foi autorizado não vê nada
await como('fora', async () => {
  assert.equal((await q('select meu_contexto() c'))[0].c.agencias.length, 0); ok();
  assert.equal((await q('select id, nome from clientes')).length, 0); ok();
});

let cli, mes, post;
const ARTE = `r2:${FORNO}/arte-01.jpg`;
await como('socio', async () => {
  const ctx = (await q('select meu_contexto() c'))[0].c;
  assert.equal(ctx.agencias[0].nivel, 3); ok();
  await q(`select autorizar_acesso($1,'designer@forno.test','designer','Designer')`, [FORNO]); ok();
  cli = (await q(`insert into clientes(agencia_id,nome,slug,handle) values($1,'Cliente Teste','cliente-teste','@teste') returning id`, [FORNO]))[0].id; ok();
  mes = (await q(`insert into meses(cliente_id,ano_mes,titulo,canal) values($1,'2026-11','Novembro 2026','instagram') returning id`, [cli]))[0].id; ok();
  post = (await q(`insert into posts(mes_id,numero,tema,titulo,tipo,legenda,slides) values($1,'01','Lançamento','Chegou','image','Legenda',$2) returning id`, [mes, JSON.stringify([ARTE])]))[0].id; ok();
  // arte de fora da Forno não entra
  await assert.rejects(q(`insert into posts(mes_id,numero,tipo,slides) values($1,'02','image',$2)`, [mes, JSON.stringify(['r2:outra-agencia/x.jpg'])]), /mídia/); ok();
  await q(`update meses set publicado=true where id=$1`, [mes]); ok();
  assert.match((await q('select link_curto($1) c', [cli]))[0].c, /^[a-z2-9]{8}$/); ok();
  assert.equal((await q('select pode_ref($1) ok', [ARTE]))[0].ok, true); ok();
});
await como('designer', async () => {
  assert.equal((await q('select id, nome from clientes')).length, 1); ok();
  await assert.rejects(q('select link_curto($1)', [cli])); ok();                      // equipe não vê o link do cliente
  await assert.rejects(q('select token from clientes')); ok();                        // nem o token
  await assert.rejects(q(`update meses set publicado=false where id=$1`, [mes])); ok(); // nem publica
  assert.equal((await q('select pode_ref($1) ok', [ARTE]))[0].ok, true); ok();
  assert.equal((await q('select pode_enviar($1) ok', [FORNO]))[0].ok, true); ok();
});
await como('fora', async () => {
  assert.equal((await q('select pode_ref($1) ok', [ARTE]))[0].ok, false); ok();
  assert.equal((await q('select pode_enviar($1) ok', [FORNO]))[0].ok, false); ok();
});

/* ---------- link do cliente e aprovação (a função vistto-cliente usa a service_role) ---------- */
const { token, codigo, slug } = (await q('select token, codigo, slug from vistto.clientes where id=$1', [cli]))[0];
await db.exec('set role service_role; set search_path to vistto;');
assert.equal((await q('select resolver_link($1,$2) t', [slug, codigo]))[0].t, token); ok();
const pagina = (await q(`select get_mes($1,'2026-11','instagram',null) j`, [token]))[0].j;
assert.equal(pagina.agencia.id, FORNO); assert.equal(pagina.posts.length, 1); assert.deepEqual(pagina.posts[0].slides, [ARTE]); ok();
await db.exec('reset role; reset search_path;');
await como('anon', async () => {
  await assert.rejects(q('select id from clientes')); ok();
  await assert.rejects(q('select resolver_link($1,$2)', [slug, codigo])); ok();
  const r = (await q(`select registrar_aprovacao($1,$2,'ajuste','Trocar a cor','Cliente') r`, [token, post]))[0].r;
  assert.equal(r.status, 'ajuste'); ok();
  await assert.rejects(q(`select registrar_aprovacao($1,$2,'aprovado',null,'Cliente')`, ['f'.repeat(24), post])); ok();
});
await como('designer', async () => {
  await q('select marcar_ajustado($1)', [post]); ok();
  assert.equal((await q('select status from posts where id=$1', [post]))[0].status, 'pendente'); ok();
});
await como('anon', async () => {
  assert.equal((await q(`select registrar_aprovacao($1,$2,'aprovado',null,'Cliente') r`, [token, post]))[0].r.status, 'aprovado'); ok();
});
// novo link derruba o antigo
await como('socio', async () => { await q('select renovar_link($1)', [cli]); ok(); });
await como('anon', async () => { await assert.rejects(q(`select registrar_aprovacao($1,$2,'comentario','oi','Cliente')`, [token, post])); ok(); });

// o taskmanager continua igual depois de tudo
assert.deepEqual((await db.query(`select (select count(*) from public.clientes)::int c, (select count(*) from public.comentarios)::int m, (select count(*) from pg_class where relnamespace='public'::regnamespace)::int obj, (select count(*) from pg_proc where pronamespace='public'::regnamespace)::int fn`)).rows[0], antes); ok();

console.log(`PASS: ${checks} checks da instalação: schema vistto ao lado do taskmanager sem mexer no public, só a Forno, administrador, papéis, link do cliente, aprovação e artes.`);
await db.close();
