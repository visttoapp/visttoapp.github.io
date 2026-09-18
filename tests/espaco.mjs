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
for (const f of ['multi-agencias', 'hierarquia', 'squads', 'convites', 'divisoes', 'gestores', 'espaco', 'r2']) await db.exec(rd(`../supabase/${f}.sql`));

const A = { a: '10000000-0000-4000-8000-000000000001', b: '10000000-0000-4000-8000-000000000002' };
const P = { admin: null, dono: ['b', 'dono'], head: ['b', 'head'], des: ['b', 'designer'], donoA: ['a', 'dono'] };
const id = {}; let i = 1; for (const k in P) id[k] = `60000000-0000-4000-8000-${String(i++).padStart(12, '0')}`;
await db.exec(`insert into auth.users values ${Object.keys(P).map(k => `('${id[k]}','${k}@x.test',now())`).join(',')};
insert into administradores values('${id.admin}');
insert into agencia_usuarios(agencia_id,usuario_id,papel) values ${Object.entries(P).filter(([, v]) => v).map(([k, [g, p]]) => `('${A[g]}','${id[k]}','${p}')`).join(',')};`);
const q = (s, p) => db.query(s, p), rows = async (s, p) => (await q(s, p)).rows;
let checks = 0; const ok = () => checks++;
async function as(who, fn) { await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`); try { return await fn(); } finally { await db.exec('reset role;'); } }

const C = (await rows(`insert into clientes(agencia_id,nome,slug,token,avatar_url) values($1,'c1','c1',$2,$3) returning id`, [A.b, 'c1'.repeat(12), `midia:${A.b}/avatar.jpg`]))[0].id;
const mNovo = (await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-09','Set',true) returning id`, [C]))[0].id;
const mVelho = (await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado,created_at) values($1,'2026-01','Jan',true,now()-interval '200 days') returning id`, [C]))[0].id;
await q(`insert into posts(mes_id,titulo,slides,capa_url) values($1,'novo',$2,null),($3,'velho',$4,$5)`,
  [mNovo, JSON.stringify([`midia:${A.b}/novo1.jpg`, `midia:${A.b}/novo2.jpg`]), mVelho, JSON.stringify([`midia:${A.b}/velho1.jpg`]), `midia:${A.b}/velhocapa.jpg`]);
// no bucket: os usados, um sem dono e um legado (que nunca pode ser apagado)
const arqs = [['novo1.jpg', 300], ['novo2.jpg', 300], ['velho1.jpg', 500], ['velhocapa.jpg', 100], ['avatar.jpg', 50], ['solto.jpg', 700]];
for (const [n, kb] of arqs) await q(`insert into storage.objects(bucket_id,name,metadata) values('midia',$1,$2)`, [`${A.b}/${n}`, JSON.stringify({ size: kb * 1024 })]);
await q(`insert into storage.objects(bucket_id,name,metadata) values('midia',$1,$2)`, [`${A.b}/legado.jpg`, JSON.stringify({ size: 1024 })]);
await q(`insert into midia_legada values($1,$2)`, [`${A.b}/legado.jpg`, A.b]);
await q(`insert into storage.objects(bucket_id,name,metadata) values('midia',$1,$2)`, [`${A.a}/outra.jpg`, JSON.stringify({ size: 9 * 1024 * 1024 })]);

// uso: só o administrador geral (a conta mostra o servidor inteiro)
const uso = async who => (await as(who, () => rows('select uso_armazenamento($1) u', [A.b])))[0].u;
let u = await uso('admin');
assert.equal(u.arquivos, 7); ok();
assert.equal(u.bytes, (300 + 300 + 500 + 100 + 50 + 700 + 1) * 1024); ok();
assert.equal(u.orfaos, 1); ok();
assert.equal(u.bytes_orfaos, 700 * 1024); ok();
assert.equal(u.meses_antigos, 1); ok();
assert.equal(u.bytes_bucket, u.bytes + 9 * 1024 * 1024); ok();
for (const w of ['dono', 'head', 'des', 'donoA']) await as(w, async () => {
  await assert.rejects(q('select uso_armazenamento($1)', [A.b]), undefined, w); ok();
  await assert.rejects(q('select plano_limpeza($1)', [A.b]), undefined, w); ok();
});
// prazo configurável
assert.equal((await as('admin', () => rows('select uso_armazenamento($1,$2) u', [A.b, 365])))[0].u.meses_antigos, 0); ok();

// plano: órfão sim, legado não
const plano = async (who, dias) => (await as(who, () => rows('select plano_limpeza($1,$2) p', [A.b, dias ?? 90])))[0].p;
let pl = await plano('admin');
assert.deepEqual(pl.orfaos, [`${A.b}/solto.jpg`]); ok();
assert.equal(pl.meses.length, 1); ok();
assert.equal(pl.meses[0].titulo, 'Jan'); ok();
assert.equal(pl.meses[0].cliente, 'c1'); ok();
assert.deepEqual([...pl.meses[0].arquivos].sort(), [`midia:${A.b}/velho1.jpg`, `midia:${A.b}/velhocapa.jpg`]); ok();
assert.equal((await plano('admin', 365)).meses.length, 0); ok();

// arquivar: limpa as artes do mês, fecha o link e mantém o post
for (const w of ['head', 'dono']) await as(w, async () => { await assert.rejects(q('select arquivar_mes($1)', [mVelho])); ok(); });
await as('admin', async () => { await q('select arquivar_mes($1)', [mVelho]); ok(); });
const velho = (await rows('select publicado, arquivado_em is not null arq from meses where id=$1', [mVelho]))[0];
assert.equal(velho.publicado, false); ok();
assert.equal(velho.arq, true); ok();
const post = (await rows(`select titulo, slides, capa_url, video_url from posts where mes_id=$1`, [mVelho]))[0];
assert.equal(post.titulo, 'velho'); ok();
assert.deepEqual(post.slides, []); ok();
assert.equal(post.capa_url, null); ok();
// o mês novo não foi tocado
assert.equal((await rows('select publicado from meses where id=$1', [mNovo]))[0].publicado, true); ok();
assert.equal((await rows(`select jsonb_array_length(slides) n from posts where mes_id=$1`, [mNovo]))[0].n, 2); ok();
// depois de arquivar, as artes do mês entram na lista de sem dono
pl = await plano('admin');
assert.deepEqual([...pl.orfaos].sort(), [`${A.b}/solto.jpg`, `${A.b}/velho1.jpg`, `${A.b}/velhocapa.jpg`].sort()); ok();
assert.equal(pl.meses.length, 0); ok();
u = await uso('admin');
assert.equal(u.orfaos, 3); ok();
assert.equal(u.bytes_orfaos, (700 + 500 + 100) * 1024); ok();
// arquivar de novo não faz nada de novo
await as('admin', async () => { await q('select arquivar_mes($1)', [mVelho]); ok(); });
assert.equal((await rows('select count(*)::int n from meses where arquivado_em is not null'))[0].n, 1); ok();
// anônimo não chega perto
await db.exec('set role anon');
await assert.rejects(q('select uso_armazenamento($1)', [A.b])); ok();
await assert.rejects(q('select plano_limpeza($1)', [A.b])); ok();
await assert.rejects(q('select arquivar_mes($1)', [mNovo])); ok();
await db.exec('reset role');

console.log('PASS:', checks, 'checks de espaço: só administrador geral, arquivos sem dono, legado protegido, arquivamento de mês antigo.');
await db.close();
