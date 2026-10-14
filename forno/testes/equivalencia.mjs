/* Confere que 01-instalar-vistto.sql cria exatamente o mesmo banco que supabase/schema.sql,
   só que no schema "vistto": tabelas, colunas, restrições, funções (corpo, search_path, security definer,
   permissões), políticas, triggers e grants. A única diferença aceita é a agência (só a Forno). */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FORNO } from '../transformar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = `create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex')::bytea $$;
-- o que o Supabase faz no schema public
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;
const semExtensao = s => s.replace('create extension if not exists pgcrypto with schema extensions;', '');

async function catalogo(sql, esquema) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(semExtensao(sql));
  await db.exec(`set search_path to ${esquema}`);   // o Postgres mostra nomes sem schema quando estão no caminho
  const n = s => s == null ? s : String(s).replace(new RegExp(`\\b${esquema}\\.(?!status_ok)`, 'g'), 'X.').replaceAll(`search_path=${esquema}`, 'search_path=X').replaceAll(`"${esquema}"`, 'X');
  const q = async (sql) => (await db.query(sql, [esquema])).rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? n(v) : v])));
  const c = {
    colunas: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema=$1 order by 1,2`),
    restricoes: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace=$1::regnamespace order by 1,2`),
    indices: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname=$1 order by 1,2`),
    funcoes: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosrc, p.proconfig::text cfg, p.prosecdef, p.provolatile, p.proacl::text acl, pg_get_function_result(p.oid) res
                       from pg_proc p where p.pronamespace=$1::regnamespace order by 1,2`),
    politicas: await q(`select schemaname=$1 as nosso, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ($1,'storage') order by 2,3`),
    triggers: await q(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal and $1::text is not null order by 1,2`),
    tabelas: await q(`select relname, relrowsecurity, relacl::text acl from pg_class where relnamespace=$1::regnamespace and relkind in ('r','v') order by 1`),
    colunasAcl: await q(`select c.relname, a.attname, a.attacl::text acl from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace=$1::regnamespace and a.attacl is not null order by 1,2`),
    buckets: (await db.query(`select id, public from storage.buckets order by 1`)).rows,
    agencias: (await db.query(`select id, slug, nome from ${esquema}.agencias order by 1`)).rows
  };
  // o public do banco vistto tem que ficar vazio: nada vaza para o schema do taskmanager
  if (esquema === 'vistto') c.publicVazio = (await db.query(`select count(*)::int n from pg_class where relnamespace='public'::regnamespace`)).rows[0].n
    + (await db.query(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace`)).rows[0].n;
  await db.close();
  return c;
}

const original = await catalogo(fs.readFileSync(path.join(RAIZ, 'supabase/schema.sql'), 'utf8'), 'public');
const forno = await catalogo(fs.readFileSync(path.join(RAIZ, 'forno/dist/vistto-forno/1-supabase/01-instalar-vistto.sql'), 'utf8'), 'vistto');

let checks = 0;
for (const k of ['colunas', 'restricoes', 'indices', 'funcoes', 'politicas', 'triggers', 'tabelas', 'colunasAcl', 'buckets']) {
  assert.ok(original[k].length > 0 || k === 'colunasAcl', k);
  assert.deepEqual(forno[k], original[k], `diferença em ${k}`);
  checks += original[k].length;
}
assert.equal(original.agencias.length, 2);
assert.deepEqual(forno.agencias, [{ id: FORNO, slug: 'forno', nome: 'Forno Lab' }]); checks++;
assert.equal(forno.publicVazio, 0); checks++;
console.log(`PASS: ${checks} itens iguais ao schema.sql original (tabelas, colunas, funções, políticas, triggers e permissões), só a Forno, nada no public.`);
