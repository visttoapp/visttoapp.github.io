import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

let checks = 0; const ok = () => checks++;

/* ---------- js/link.js: montar e ler o link ---------- */
const window = {};
new Function('window', fs.readFileSync(new URL('../js/link.js', import.meta.url), 'utf8'))(window);
const L = window.LINK;
const base = 'https://visttoapp.github.io/c';
assert.equal(L.montar(base, 'prime-plus', 'k7f3q2m9', '2026-10', 'instagram'), 'https://visttoapp.github.io/c#prime-plus/k7f3q2m9/outubro-2026'); ok();
assert.equal(L.montar(base, 'prime-plus', 'k7f3q2m9', '2026-10', 'linkedin'), 'https://visttoapp.github.io/c#prime-plus/k7f3q2m9/linkedin-outubro-2026'); ok();
assert.equal(L.montar(base, 'prime-plus', 'k7f3q2m9', null, 'instagram'), 'https://visttoapp.github.io/c#prime-plus/k7f3q2m9'); ok();
assert.equal(L.montar(base, 'prime-plus', null, '2026-10'), null); ok();          // sem código: o painel usa o link antigo
assert.equal(L.montar(base, 'Prime Plus', 'k7f3q2m9', '2026-10'), null); ok();    // identificador fora do padrão
assert.equal(L.mesParaTexto('2027-03', 'instagram'), 'marco-2027'); ok();
assert.deepEqual(L.ler('#prime-plus/k7f3q2m9/outubro-2026'), { cliente: 'prime-plus', codigo: 'k7f3q2m9', m: '2026-10', canal: null }); ok();
assert.deepEqual(L.ler('#prime-plus/k7f3q2m9/linkedin-outubro-2026'), { cliente: 'prime-plus', codigo: 'k7f3q2m9', m: '2026-10', canal: 'linkedin' }); ok();
assert.deepEqual(L.ler('#Prime-Plus/K7F3Q2M9/Março-27'), { cliente: 'prime-plus', codigo: 'k7f3q2m9', m: '2027-03', canal: null }); ok();   // maiúscula, acento, ano curto
assert.deepEqual(L.ler('#prime-plus/k7f3q2m9/out-2026'), { cliente: 'prime-plus', codigo: 'k7f3q2m9', m: '2026-10', canal: null }); ok();
assert.deepEqual(L.ler('#prime-plus/k7f3q2m9'), { cliente: 'prime-plus', codigo: 'k7f3q2m9', m: null, canal: null }); ok();
assert.deepEqual(L.ler('#prime-plus/k7f3q2m9/qualquer-coisa'), { cliente: 'prime-plus', codigo: 'k7f3q2m9', m: null, canal: null }); ok();   // mês ilegível: abre o mais recente
assert.equal(L.ler('#prime-plus/k7f3'), null); ok();            // código curto demais
assert.equal(L.ler('#prime-plus/k7f3q2m0'), null); ok();        // 0 não existe no código
assert.equal(L.ler('#prime-plus'), null); ok();
assert.equal(L.ler('#%E0%A4%A'), null); ok();                   // lixo no endereço não quebra a página
assert.deepEqual(L.ler('#t=abc123&m=2026-10&e=x'), { token: 'abc123', m: '2026-10', canal: null, entrega: 'x' }); ok();   // link antigo continua
assert.equal(L.ler(''), null); ok();
// o que montar gera, ler devolve igual
for (const [am, k] of [['2026-01', 'instagram'], ['2026-12', 'linkedin'], ['2030-07', 'instagram']]) {
  const h = L.montar(base, 'cli-1', 'abcdefgh', am, k).split('#')[1];
  const r = L.ler('#' + h);
  assert.equal(r.m, am); assert.equal(r.canal || 'instagram', k); ok();
}

/* ---------- supabase/historico/link-curto.sql ---------- */
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function public.gen_random_bytes(n integer) returns bytea language sql volatile as $$select substring(decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex') from 1 for n) $$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$select public.gen_random_bytes(n) $$;`);
const rd = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
await db.exec(rd('./fixtures/schema-v1.sql').replace('create extension if not exists pgcrypto;', ''));
for (const f of ['multi-agencias', 'hierarquia', 'squads', 'convites', 'divisoes', 'gestores', 'espaco', 'r2', 'endurecer', 'espaco-r2', 'anuncios']) await db.exec(rd(`../supabase/historico/${f}.sql`));
await db.exec(rd('../supabase/historico/pauta-e-linkedin.sql'));
const B = '10000000-0000-4000-8000-000000000002';
const antes = (await db.query(`insert into clientes(agencia_id,nome,slug,token) values($1,'Antigo','antigo',$2) returning id`, [B, 'ef'.repeat(32)])).rows[0].id;
await db.exec(rd('../supabase/historico/link-curto.sql'));
await db.exec(rd('../supabase/historico/link-curto.sql'));   // rodar de novo não pode quebrar
const q = (s, p) => db.query(s, p), rows = async (s, p) => (await q(s, p)).rows;
const P = { head: 'head', des: 'designer' };
const id = { head: '91000000-0000-4000-8000-000000000001', des: '91000000-0000-4000-8000-000000000002' };
await db.exec(`insert into auth.users values ('${id.head}','head@x.test',now()),('${id.des}','des@x.test',now());
insert into agencia_usuarios(agencia_id,usuario_id,papel) values ('${B}','${id.head}','head'),('${B}','${id.des}','designer');
update agencias set usa_squads=false where id='${B}';`);
async function as(who, fn) { await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`); try { return await fn(); } finally { await db.exec(`reset role;set request.jwt.claim.sub='';`); } }

const codigoDe = async c => (await rows('select codigo from clientes where id=$1', [c]))[0].codigo;
assert.match(await codigoDe(antes), /^[a-z2-9]{8}$/); ok();                       // cliente que já existia ganhou código
const novo = (await rows(`insert into clientes(agencia_id,nome,slug) values($1,'Prime Plus','prime-plus') returning id`, [B]))[0].id;
const cod = await codigoDe(novo);
assert.match(cod, /^[a-z2-9]{8}$/); ok();                                          // cliente novo ganha sozinho
assert.notEqual(cod, await codigoDe(antes)); ok();
const token = (await rows('select token from clientes where id=$1', [novo]))[0].token;
const resolver = async (s, c) => (await rows('select resolver_link($1,$2) t', [s, c]))[0].t;
assert.equal(await resolver('prime-plus', cod), token); ok();
assert.equal(await resolver(' Prime-Plus ', cod.toUpperCase()), token); ok();
assert.equal(await resolver('prime-plus', 'abcdefgh'), null); ok();                // código errado
assert.equal(await resolver('antigo', cod), null); ok();                           // código de outro cliente
await assert.rejects(q(`update clientes set codigo='curto' where id=$1`, [novo])); ok();
// ninguém logado ou da equipe chama resolver_link: só o servidor
await assert.rejects(db.exec(`set role anon; select resolver_link('prime-plus','${cod}')`)); await db.exec('reset role'); ok();
await assert.rejects(as('head', () => q(`select resolver_link('prime-plus',$1)`, [cod]))); ok();
// Head vê o código; designer não, nem pela tabela
assert.equal((await as('head', () => rows('select link_curto($1) c', [novo])))[0].c, cod); ok();
await assert.rejects(as('des', () => q('select link_curto($1)', [novo])), /Acesso negado/); ok();
await assert.rejects(as('des', () => q('select codigo from clientes'))); ok();
assert.equal((await as('des', () => rows('select slug from clientes where id=$1', [novo])))[0].slug, 'prime-plus'); ok();
// gerar novo link troca token e código: os dois links antigos param
const tokenNovo = (await as('head', () => rows('select renovar_link($1) t', [novo])))[0].t;
const codNovo = await codigoDe(novo);
assert.notEqual(codNovo, cod); ok();
assert.equal(await resolver('prime-plus', cod), null); ok();
assert.equal(await resolver('prime-plus', codNovo), tokenNovo); ok();

console.log('PASS:', checks, 'checks do link curto: montar e ler, código por cliente, só o servidor resolve, só Head+ vê e gerar novo link derruba o antigo.');
