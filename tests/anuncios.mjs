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
for (const f of ['multi-agencias', 'hierarquia', 'squads', 'convites', 'divisoes', 'gestores', 'espaco', 'r2', 'endurecer', 'espaco-r2', 'anuncios']) await db.exec(rd(`../supabase/${f}.sql`));

const A = { a: '10000000-0000-4000-8000-000000000001', b: '10000000-0000-4000-8000-000000000002' };
const P = { admin: null, dono: ['b', 'dono'], head: ['b', 'head'], des: ['b', 'designer'], edi: ['b', 'editor_video'], traf: ['b', 'gestor_trafego'], des2: ['b', 'designer'], fora: null };
const id = {}; let i = 1; for (const k in P) id[k] = `80000000-0000-4000-8000-${String(i++).padStart(12, '0')}`;
await db.exec(`insert into auth.users values ${Object.keys(P).map(k => `('${id[k]}','${k}@x.test',now())`).join(',')};
insert into administradores values('${id.admin}');
insert into agencia_usuarios(agencia_id,usuario_id,papel) values ${Object.entries(P).filter(([, v]) => v).map(([k, [g, p]]) => `('${A[g]}','${id[k]}','${p}')`).join(',')};`);
const q = (s, p) => db.query(s, p), rows = async (s, p) => (await q(s, p)).rows;
let checks = 0; const ok = () => checks++;
async function as(who, fn) { await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`); try { return await fn(); } finally { await db.exec(`reset role;set request.jwt.claim.sub='';`); } }

const S1 = (await rows(`insert into squads(agencia_id,nome) values($1,'Squad 1') returning id`, [A.b]))[0].id;
const S2 = (await rows(`insert into squads(agencia_id,nome) values($1,'Squad 2') returning id`, [A.b]))[0].id;
await q(`insert into squad_membros values($1,$2),($1,$3),($1,$4),($1,$5),($6,$7)`, [S1, id.head, id.des, id.edi, id.traf, S2, id.des2]);
const TOKEN = 'ab'.repeat(16);
const c1 = (await rows(`insert into clientes(agencia_id,squad_id,nome,slug,token) values($1,$2,'Padaria','padaria',$3) returning id`, [A.b, S1, TOKEN]))[0].id;
await as('head', () => q('select definir_gestor_cliente($1,$2,true)', [c1, id.traf]));

/* ---------- quem enxerga cada canal ---------- */
const canal = async (who, k) => (await as(who, () => rows('select pode_canal($1,$2) v', [A.b, k])))[0].v;
for (const w of ['dono', 'head', 'des', 'edi', 'traf']) { assert.equal(await canal(w, 'instagram'), true, w); ok(); }
for (const k of ['meta', 'google']) {
  for (const w of ['admin', 'dono', 'head', 'traf']) { assert.equal(await canal(w, k), true, w + ' ' + k); ok(); }
  for (const w of ['des', 'edi', 'fora']) { assert.equal(await canal(w, k), false, w + ' ' + k); ok(); }
}

/* ---------- o mês do feed continua único; campanha pode repetir o mês ---------- */
const mFeed = (await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-09','Setembro',true) returning id`, [c1]))[0].id;
assert.equal((await rows(`select canal from meses where id=$1`, [mFeed]))[0].canal, 'instagram'); ok();
await assert.rejects(q(`insert into meses(cliente_id,ano_mes,titulo) values($1,'2026-09','Outro')`, [c1])); ok();
const cam1 = (await rows(`insert into meses(cliente_id,ano_mes,titulo,canal,objetivo,publicado) values($1,'2026-09','Black Friday','meta','Vendas',true) returning id`, [c1]))[0].id;
const cam2 = (await rows(`insert into meses(cliente_id,ano_mes,titulo,canal,objetivo,publicado) values($1,'2026-09','Sempre ativo','meta','Tráfego',true) returning id`, [c1]))[0].id;
const camG = (await rows(`insert into meses(cliente_id,ano_mes,titulo,canal,objetivo,publicado) values($1,'2026-09','Pesquisa marca','google','Pesquisa',true) returning id`, [c1]))[0].id;
const camRas = (await rows(`insert into meses(cliente_id,ano_mes,titulo,canal) values($1,'2026-10','Rascunho','meta') returning id`, [c1]))[0].id;
assert.equal((await rows(`select count(*)::int n from meses where cliente_id=$1`, [c1]))[0].n, 5); ok();
await assert.rejects(q(`insert into meses(cliente_id,ano_mes,titulo,canal) values($1,'2026-11','X','tiktok')`, [c1])); ok();

/* ---------- anúncios ---------- */
const R = { arte: `r2:${A.b}/criativo.jpg`, feed: `r2:${A.b}/post.jpg` };
await q(`insert into posts(mes_id,titulo,slides) values($1,'Post do feed',$2)`, [mFeed, JSON.stringify([R.feed])]);
const an1 = (await rows(`insert into posts(mes_id,numero,tema,titulo,tipo,conjunto,publico,legenda,descricao,cta,destino,slides)
  values($1,'01','Oferta','Leve 3 pague 2','image','Conjunto · Remarketing','Quem visitou o site em 30 dias','Texto principal','Descrição curta','Comprar agora','https://loja.exemplo.com/oferta',$2) returning id`,
  [cam1, JSON.stringify([R.arte])]))[0].id;
await q(`insert into posts(mes_id,numero,titulo,tipo,conjunto,descricao,destino) values($1,'01','Padaria perto de você','texto','Grupo · Marca','Pães quentes todo dia','https://padaria.exemplo.com')`, [camG]); ok();
// endereço precisa ser https e sem espaço
await assert.rejects(q(`update posts set destino='javascript:alert(1)' where id=$1`, [an1])); ok();
await assert.rejects(q(`update posts set destino='http://loja.exemplo.com' where id=$1`, [an1])); ok();
await assert.rejects(q(`update posts set tipo='banner' where id=$1`, [an1])); ok();
await q(`update posts set destino='https://loja.exemplo.com/nova' where id=$1`, [an1]); ok();

/* ---------- painel: designer não vê campanha nem criativo ---------- */
const vejoMeses = async who => (await as(who, () => rows('select canal, titulo from meses where cliente_id=$1 order by titulo', [c1]))).map(r => r.canal + ':' + r.titulo);
assert.deepEqual(await vejoMeses('des'), ['instagram:Setembro']); ok();
assert.deepEqual(await vejoMeses('edi'), ['instagram:Setembro']); ok();
assert.deepEqual((await vejoMeses('traf')).sort(), ['google:Pesquisa marca', 'instagram:Setembro', 'meta:Black Friday', 'meta:Rascunho', 'meta:Sempre ativo']); ok();
assert.equal((await vejoMeses('head')).length, 5); ok();
assert.equal((await vejoMeses('dono')).length, 5); ok();
assert.equal((await vejoMeses('des2')).length, 0, 'outro squad'); ok();
// posts: a regra passa pela entrega, então o designer também não alcança o anúncio
assert.equal((await as('des', () => rows('select id from posts where id=$1', [an1]))).length, 0); ok();
assert.equal((await as('traf', () => rows('select id from posts where id=$1', [an1]))).length, 1); ok();
// e não consegue criar anúncio numa campanha
await as('des', async () => { await assert.rejects(q(`insert into posts(mes_id,titulo) values($1,'tentativa')`, [cam1])); ok(); });
await as('des', async () => { await assert.rejects(q(`insert into meses(cliente_id,ano_mes,titulo,canal) values($1,'2026-12','Minha','meta')`, [c1])); ok(); });
await as('traf', async () => { await q(`insert into meses(cliente_id,ano_mes,titulo,canal) values($1,'2026-12','Minha','meta')`, [c1]); ok(); });

/* ---------- a arte do anúncio segue a mesma fechadura ---------- */
const ve = async (who, ref) => (await as(who, () => rows('select pode_ref($1) v', [ref])))[0].v;
assert.equal(await ve('des', R.feed), true); ok();
assert.equal(await ve('des', R.arte), false, 'designer não abre criativo de anúncio'); ok();
assert.equal(await ve('edi', R.arte), false); ok();
assert.equal(await ve('traf', R.arte), true); ok();
assert.equal(await ve('head', R.arte), true); ok();
assert.equal(await ve('dono', R.arte), true); ok();
assert.equal(await ve('des2', R.arte), false); ok();

/* ---------- excluir: só Head+ do squad ---------- */
await as('traf', async () => { await q('delete from meses where id=$1', [camRas]); ok(); });
assert.equal((await rows('select count(*)::int n from meses where id=$1', [camRas]))[0].n, 1, 'gestor não exclui'); ok();
await as('head', async () => { await q('delete from meses where id=$1', [camRas]); ok(); });
assert.equal((await rows('select count(*)::int n from meses where id=$1', [camRas]))[0].n, 0); ok();

/* ---------- página do cliente ---------- */
const pg = async (...args) => (await rows(`select get_mes($1,$2,$3,$4) j`, args))[0].j;
let j = await pg(TOKEN, null, null, null);
assert.equal(j.canal, 'instagram'); ok();
assert.deepEqual(j.canais.map(x => x.canal), ['instagram', 'meta', 'google']); ok();
assert.deepEqual(j.canais.map(x => Number(x.entregas)), [1, 2, 1]); ok();
assert.equal(j.mes.titulo, 'Setembro'); ok();
assert.equal(j.posts.length, 1); ok();
assert.equal(j.meses.length, 1); ok();
j = await pg(TOKEN, null, 'meta', null);
assert.equal(j.canal, 'meta'); ok();
assert.equal(j.meses.length, 2, 'as duas campanhas do Meta'); ok();
assert.ok(j.meses.every(m => m.id)); ok();
assert.equal(j.mes.titulo, 'Sempre ativo', 'a campanha mais nova abre primeiro'); ok();
j = await pg(TOKEN, null, null, cam1);
assert.equal(j.canal, 'meta'); ok();
assert.equal(j.mes.objetivo, 'Vendas'); ok();
assert.equal(j.posts[0].conjunto, 'Conjunto · Remarketing'); ok();
assert.equal(j.posts[0].cta, 'Comprar agora'); ok();
assert.equal(j.posts[0].destino, 'https://loja.exemplo.com/nova'); ok();
assert.equal(j.posts[0].publico, 'Quem visitou o site em 30 dias'); ok();
j = await pg(TOKEN, null, 'google', null);
assert.equal(j.posts[0].tipo, 'texto'); ok();
assert.equal(j.posts[0].slides.length, 0); ok();
// campanha de outro cliente ou não publicada não abre pelo link
const rasc = (await rows(`insert into meses(cliente_id,ano_mes,titulo,canal) values($1,'2027-01','Fechada','meta') returning id`, [c1]))[0].id;
j = await pg(TOKEN, null, null, rasc);
assert.equal(j.mes.titulo, 'Setembro', 'campanha fechada cai para o feed'); ok();
assert.equal(await pg('00'.repeat(16), null, null, null), null); ok();
// cliente sem nada publicado no canal pedido
const c2 = (await rows(`insert into clientes(agencia_id,squad_id,nome,slug,token) values($1,$2,'Vazio','vazio',$3) returning id`, [A.b, S1, 'cd'.repeat(16)]))[0].id;
j = await pg('cd'.repeat(16), null, 'meta', null);
assert.equal(j.mes, null); ok();
assert.deepEqual(j.canais, []); ok();
// o cliente aprova o anúncio pelo mesmo caminho
const r = await rows(`select registrar_aprovacao($1,$2,'ajuste','Trocar a foto','Cliente') j`, [TOKEN, an1]);
assert.equal(r[0].j.status, 'ajuste'); ok();
assert.equal((await pg(TOKEN, null, null, cam1)).posts[0].historico.length, 1); ok();

/* ---------- anônimo não alcança nada disso ---------- */
await db.exec('set role anon');
await assert.rejects(q('select pode_canal($1,$2)', [A.b, 'meta'])); ok();
await assert.rejects(q('select get_mes($1)', [TOKEN])); ok();
await db.exec('reset role');

console.log('PASS:', checks, 'checks de anúncios: canal por papel, campanha por mês, campos do anúncio, arte fechada e abas do cliente.');
await db.close();
