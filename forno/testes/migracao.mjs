/* Teste da migração (4-migrar-dados/migrar.mjs) de ponta a ponta, sem nada de verdade:
   - projeto antigo: PGlite com o supabase/schema.sql original, as duas agências e artes nos três formatos
     (R2, Storage antigo por "midia:" e por URL pública, e link externo);
   - projeto novo: PGlite com o 01-instalar-vistto.sql do pacote, ao lado de um taskmanager no public;
   - REST (PostgREST), Auth admin e Storage imitados por um servidor HTTP local;
   - os dois Workers de verdade (o antigo do repositório e o novo do pacote) com buckets em memória. */
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACOTE = path.join(RAIZ, 'forno/dist/vistto-forno');
const { migrar, destinoDaArte, FORNO } = await import(pathToFileURL(path.join(PACOTE, '4-migrar-dados/migrar.mjs')).href);
const workerAntigo = (await import(pathToFileURL(path.join(RAIZ, 'worker/index.js')).href)).default;
const workerNovo = (await import(pathToFileURL(path.join(PACOTE, '3-cloudflare-r2/worker/index.js')).href)).default;
const OUTRA = '10000000-0000-4000-8000-000000000001';
let checks = 0; const ok = () => checks++;

/* ---------- bancos ---------- */
const BASE = `create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key default gen_random_uuid(),email text,email_confirmed_at timestamptz,invited_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),4),'hex')::bytea $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`;
const semExt = s => s.replace('create extension if not exists pgcrypto with schema extensions;', '');
const A = new PGlite(), B = new PGlite();
await A.exec(BASE); await A.exec(semExt(fs.readFileSync(path.join(RAIZ, 'supabase/schema.sql'), 'utf8')));
await B.exec(BASE);
await B.exec(`create table public.pessoas(id uuid primary key references auth.users(id),email text,situacao text);
create table public.clientes(id bigserial primary key,nome text unique);
insert into public.clientes(nome) values ('Cliente do taskmanager');
create function public.fn_nova_pessoa() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin insert into pessoas(id,email,situacao) values(new.id,new.email,case when new.invited_at is not null then 'ativo' else 'inativo' end) on conflict(id) do nothing; return new; end $$;
create trigger trg_nova_pessoa after insert on auth.users for each row execute function public.fn_nova_pessoa();`);
await B.exec(semExt(fs.readFileSync(path.join(PACOTE, '1-supabase/01-instalar-vistto.sql'), 'utf8')));

/* ---------- servidor: REST, Auth, Storage, Workers e um site externo ---------- */
const memoria = () => {
  const m = new Map();
  return { m, MIDIA: {
    async get(k) { const v = m.get(k); return v ? { body: v.body, size: v.body.length, httpMetadata: { contentType: v.tipo } } : null; },
    async head(k) { return m.has(k) ? { size: m.get(k).body.length } : null; },
    async put(k, body, opt) { m.set(k, { body: Buffer.from(await new Response(body).arrayBuffer()), tipo: opt?.httpMetadata?.contentType }); },
    async delete(k) { m.delete(k); },
    async list() { return { objects: [...m.keys()].map(key => ({ key, size: 1 })), truncated: false }; }
  } };
};
const r2Antigo = memoria(), r2Novo = memoria();
const SEG_ANTIGO = 'segredo-antigo', SEG_NOVO = 'segredo-novo';
const storageAntigo = new Map();
const externo = new Map();

const pks = async (db, s, t) => (await db.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=$1::regclass and i.indisprimary order by a.attnum`, [`${s}.${t}`])).rows.map(r => r.attname);
function filtros(url, inicio = 1) {
  const onde = [], valores = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) { valores.push(v.slice(3)); onde.push(`"${k}"::text = $${inicio + valores.length - 1}`); }
    else if (v.startsWith('in.(')) { valores.push(v.slice(4, -1).split(',').filter(Boolean)); onde.push(`"${k}"::text = any($${inicio + valores.length - 1}::text[])`); }
    else throw new Error('filtro não imitado: ' + k + '=' + v);
  }
  return { onde: onde.length ? 'where ' + onde.join(' and ') : '', valores };
}
let pedidosEscrita = 0;
async function rest(db, req, url, corpo) {
  const s = req.headers[req.method === 'GET' ? 'accept-profile' : 'content-profile'] || 'public';
  const t = url.pathname.split('/').pop();
  await db.exec(`set role service_role; set search_path to ${s};`);
  try {
    if (req.method === 'GET') {
      const { onde, valores } = filtros(url);
      const ordem = (url.searchParams.get('order') || '').split(',').filter(Boolean).map(c => `"${c}"`).join(',');
      const r = await db.query(`select coalesce(json_agg(x),'[]'::json) j from (select * from "${s}"."${t}" ${onde} ${ordem ? 'order by ' + ordem : ''} limit ${+url.searchParams.get('limit') || 1000} offset ${+url.searchParams.get('offset') || 0}) x`, valores);
      return [200, r.rows[0].j];
    }
    pedidosEscrita++;
    const dados = JSON.parse(corpo);
    if (req.method === 'POST') {
      const linhas = Array.isArray(dados) ? dados : [dados];
      const cols = Object.keys(linhas[0]);
      const alvo = url.searchParams.get('on_conflict')?.split(',') || await pks(db, s, t);
      const lista = cols.map(c => `"${c}"`).join(',');
      await db.query(`insert into "${s}"."${t}" (${lista}) select ${lista} from json_populate_recordset(null::"${s}"."${t}", $1::json)
        on conflict (${alvo.map(c => `"${c}"`).join(',')}) do update set ${cols.map(c => `"${c}"=excluded."${c}"`).join(',')}`, [JSON.stringify(linhas)]);
      return [201, null];
    }
    if (req.method === 'PATCH') {
      const cols = Object.keys(dados);
      const { onde, valores } = filtros(url, 2);
      await db.query(`update "${s}"."${t}" set (${cols.map(c => `"${c}"`).join(',')}) = (select ${cols.map(c => `"${c}"`).join(',')} from json_populate_record(null::"${s}"."${t}", $1::json)) ${onde}`, [JSON.stringify(dados), ...valores]);
      return [204, null];
    }
  } catch (e) { return [400, { message: e.message }]; } finally { await db.exec('reset role; reset search_path;'); }
}
const usuarioJson = u => ({ id: u.id, email: u.email, user_metadata: u.raw_user_meta_data || {} });
async function auth(db, req, url, corpo) {
  const id = url.pathname.split('/admin/users/')[1];
  if (req.method === 'GET' && id) { const r = (await db.query('select * from auth.users where id=$1', [id])).rows[0]; return r ? [200, usuarioJson(r)] : [404, { msg: 'not found' }]; }
  if (req.method === 'GET') {
    const por = +url.searchParams.get('per_page') || 50, pag = +url.searchParams.get('page') || 1;
    return [200, { users: (await db.query('select * from auth.users order by email limit $1 offset $2', [por, (pag - 1) * por])).rows.map(usuarioJson) }];
  }
  const b = JSON.parse(corpo);
  pedidosEscrita++;
  const r = (await db.query('insert into auth.users(email,email_confirmed_at,raw_user_meta_data) values($1,now(),$2) returning *', [b.email, b.user_metadata])).rows[0];
  return [200, usuarioJson(r)];
}
async function worker(w, env, req, url, corpo) {
  const resp = await w.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['PUT', 'POST'].includes(req.method) ? corpo : undefined }), env);
  return [resp.status, Buffer.from(await resp.arrayBuffer()), Object.fromEntries(resp.headers)];
}
const servidor = http.createServer(async (req, res) => {
  const partes = []; for await (const p of req) partes.push(p);
  const corpo = Buffer.concat(partes);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const [, lado, ...resto] = url.pathname.split('/');
  const sub = new URL('/' + resto.join('/') + url.search, url);
  const chave = req.headers.apikey;
  let r;
  try {
    if (lado === 'r2antigo') r = await worker(workerAntigo, { SIGN_SECRET: SEG_ANTIGO, MIDIA: r2Antigo.MIDIA }, req, sub, corpo);
    else if (lado === 'r2novo') r = await worker(workerNovo, { SIGN_SECRET: SEG_NOVO, ORIGENS: 'https://forno.example', MIDIA: r2Novo.MIDIA }, req, sub, corpo);
    else if (lado === 'externo') r = externo.has(sub.pathname) ? [200, externo.get(sub.pathname), { 'content-type': 'image/png' }] : [404, Buffer.from('')];
    else {
      const db = lado === 'antigo' ? A : B;
      if (chave !== `chave-${lado}`) r = [401, { message: 'chave errada' }];
      else if (sub.pathname.startsWith('/rest/v1/')) r = await rest(db, req, sub, corpo.toString());
      else if (sub.pathname.startsWith('/auth/v1/admin/users')) r = await auth(db, req, sub, corpo.toString());
      else if (lado === 'antigo' && sub.pathname.startsWith('/storage/v1/object/midia/')) {
        const c = decodeURIComponent(sub.pathname.slice('/storage/v1/object/midia/'.length));
        r = storageAntigo.has(c) ? [200, storageAntigo.get(c), { 'content-type': 'image/jpeg' }] : [404, { message: 'not found' }];
      } else r = [404, { message: 'rota' }];
    }
  } catch (e) { r = [500, { message: e.message }]; }
  const [status, body, headers = {}] = r;
  const buf = Buffer.isBuffer(body) ? body : body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...headers, 'content-length': buf.length, ...(Buffer.isBuffer(body) ? {} : { 'content-type': 'application/json' }) });
  res.end(buf);
});
await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
const H = `http://127.0.0.1:${servidor.address().port}`;

/* ---------- dados do projeto antigo ---------- */
const u = { felipe: crypto.randomUUID(), dono: crypto.randomUUID(), designer: crypto.randomUUID(), gestor: crypto.randomUUID(), head2: crypto.randomUUID(), saiu: crypto.randomUUID() };
const bytes = n => crypto.randomBytes(n);
const arquivos = {
  [`${FORNO}/a.jpg`]: bytes(300), [`${FORNO}/b.jpg`]: bytes(200), [`${FORNO}/v.mp4`]: bytes(900), [`${FORNO}/avatar.png`]: bytes(50), [`${OUTRA}/x.jpg`]: bytes(10)
};
for (const [k, v] of Object.entries(arquivos)) r2Antigo.m.set(k, { body: v, tipo: k.endsWith('mp4') ? 'video/mp4' : k.endsWith('png') ? 'image/png' : 'image/jpeg' });
storageAntigo.set('antigo/capa reel.jpg', bytes(120));
storageAntigo.set(`${FORNO}/destaque.jpg`, bytes(80));
externo.set('/foto.png', bytes(70));
const PUBLICA = `${H}/antigo/storage/v1/object/public/midia/`;
const C1 = crypto.randomUUID(), C2 = crypto.randomUUID(), C3 = crypto.randomUUID(), SQ = crypto.randomUUID();
const M1 = crypto.randomUUID(), M2 = crypto.randomUUID(), M3 = crypto.randomUUID();
const P1 = crypto.randomUUID(), P2 = crypto.randomUUID(), P3 = crypto.randomUUID(), P4 = crypto.randomUUID();
await A.exec(`set session_replication_role = replica;
insert into auth.users(id,email,email_confirmed_at) values
 ('${u.felipe}','felipe@x.test',now()),('${u.dono}','Dono@Forno.test',now()),('${u.designer}','designer@forno.test',now()),
 ('${u.gestor}','gestor@forno.test',now()),('${u.head2}','head@outra.test',now()),('${u.saiu}','saiu@forno.test',now());
insert into administradores values ('${u.felipe}');
update agencias set nome='Forno', usa_squads=true where id='${FORNO}';
insert into agencia_usuarios(agencia_id,usuario_id,papel,nome,criado_por) values
 ('${FORNO}','${u.dono}','dono','Dono','${u.felipe}'),('${FORNO}','${u.designer}','designer','Designer','${u.dono}'),
 ('${FORNO}','${u.gestor}','gestor_trafego','Gestor','${u.dono}'),('${OUTRA}','${u.head2}','head','Head da outra',null);
insert into squads(id,agencia_id,nome) values ('${SQ}','${FORNO}','Squad A');
insert into squad_membros(squad_id,usuario_id) values ('${SQ}','${u.designer}'),('${SQ}','${u.gestor}');
insert into clientes(id,agencia_id,squad_id,slug,nome,handle,avatar_url,token,codigo) values
 ('${C1}','${FORNO}','${SQ}','padaria','Padaria','@padaria','r2:${FORNO}/avatar.png','${'a'.repeat(24)}','abcdefgh'),
 ('${C2}','${FORNO}',null,'clinica','Clínica','@clinica',null,'${'b'.repeat(24)}','bcdefghj'),
 ('${C3}','${OUTRA}',null,'outra','Cliente da outra agência',null,null,'${'c'.repeat(24)}','cdefghjk');
insert into cliente_gestores(cliente_id,usuario_id,criado_por) values ('${C1}','${u.gestor}','${u.dono}');
insert into destaques(cliente_id,ordem,nome,capa_url) values ('${C1}',0,'Cardápio','${PUBLICA}${FORNO}/destaque.jpg');
insert into meses(id,cliente_id,ano_mes,titulo,publicado,publicado_em,canal,created_at) values
 ('${M1}','${C1}','2026-09','Setembro 2026',true,'2026-09-01T12:00:00Z','instagram','2026-08-20T10:00:00Z'),
 ('${M2}','${C1}','2026-10','LinkedIn outubro',false,null,'linkedin','2026-09-20T10:00:00Z'),
 ('${M3}','${C3}','2026-09','Outra',true,'2026-09-02T12:00:00Z','instagram',now());
insert into posts(id,mes_id,ordem,numero,tema,titulo,tipo,legenda,slides,video_url,capa_url,status,responsavel,interno) values
 ('${P1}','${M1}',1,'01','Pão','Pão quente','carousel','Legenda 1','["r2:${FORNO}/a.jpg","r2:${FORNO}/b.jpg"]',null,null,'aprovado','${u.designer}',null),
 ('${P2}','${M1}',2,'02','Reel','Forno','reel','Legenda 2','[]','r2:${FORNO}/v.mp4','midia:antigo/capa reel.jpg','ajuste','${u.saiu}',null),
 ('${P3}','${M2}',1,'01','Externo','Foto','image','Legenda 3','["${H}/externo/foto.png"]',null,null,'pendente',null,'revisao'),
 ('${P4}','${M3}',1,'01','Outra','Outra','image','Outra','["r2:${OUTRA}/x.jpg"]',null,null,'pendente',null,null);
insert into aprovacoes(post_id,acao,comentario,autor,origem,created_at) values
 ('${P1}','aprovado',null,'Cliente','cliente','2026-09-02T09:00:00Z'),('${P2}','ajuste','Mais claro','Cliente','cliente','2026-09-03T09:00:00Z'),
 ('${P4}','aprovado',null,'Cliente','cliente',now());
set session_replication_role = origin;`);

/* ---------- projeto novo: o dono já tem login no taskmanager (outro id, mesmo e-mail) ---------- */
const donoNovo = crypto.randomUUID();
await B.exec(`insert into auth.users(id,email,email_confirmed_at,invited_at) values ('${donoNovo}','dono@forno.test',now(),now());`);

const cfg = executar => ({
  executar,
  antigo: { url: `${H}/antigo`, chave: 'chave-antigo', r2: `${H}/r2antigo`, segredo: SEG_ANTIGO },
  novo: { url: `${H}/novo`, chave: 'chave-novo', r2: `${H}/r2novo`, segredo: SEG_NOVO }
});
const quieto = { log: () => {} };
const contarB = async () => (await B.query(`select (select count(*) from vistto.clientes)::int c, (select count(*) from vistto.posts)::int p, (select count(*) from auth.users)::int u, (select count(*) from vistto.aprovacoes)::int a`)).rows[0];

/* ---------- referência de arte ---------- */
assert.deepEqual(destinoDaArte(`r2:${FORNO}/a.jpg`, H), { origem: 'r2', caminho: `${FORNO}/a.jpg`, novo: `${FORNO}/a.jpg` }); ok();
assert.equal(destinoDaArte('midia:antigo/capa reel.jpg', H).novo, `${FORNO}/legado/antigo/capa_reel.jpg`); ok();
assert.equal(destinoDaArte(`${H}/storage/v1/object/public/midia/x%20y.png`, H).caminho, 'x y.png'); ok();
assert.match(destinoDaArte('https://site.com/a/b.PNG?x=1', H).novo, new RegExp(`^${FORNO}/legado/externo/[0-9a-f]{20}\\.png$`)); ok();
assert.equal(destinoDaArte('', H), null); ok();
assert.equal(destinoDaArte('qualquer', H).novo, null); ok();

/* ---------- 1. simulação: lê tudo, não grava nada ---------- */
const antes = await contarB();
pedidosEscrita = 0;
const sim = await migrar(cfg(false), quieto);
assert.equal(sim.modo, 'SIMULAÇÃO'); ok();
assert.deepEqual(sim.tabelas, { squads: 1, agencia_usuarios: 3, squad_membros: 2, clientes: 2, cliente_gestores: 1, destaques: 1, meses: 2, posts: 3, aprovacoes: 2 }); ok();
assert.deepEqual(sim.pessoas, { mesmas: 1, novas: 2, sem_conta: 2 }); ok();   // sem conta: Felipe e quem saiu
assert.deepEqual({ ...sim.artes }, { total: 7, r2: 4, storage: 2, url: 1, ja_estavam: 0, copiadas: 0, falhas: 0 }); ok();
assert.equal(pedidosEscrita, 0); ok();
assert.deepEqual(await contarB(), antes); ok();
assert.equal(r2Novo.m.size, 0); ok();

/* ---------- 2. executar ---------- */
const r = await migrar(cfg(true), quieto);
assert.equal(r.artes.copiadas, 7); assert.equal(r.artes.falhas, 0); ok();
assert.equal(r.codigos.length, 2); ok();
const q = async (sql, p = []) => (await B.query(sql, p)).rows;

// só a Forno, com os mesmos ids, tokens e códigos do link
const clientes = await q('select id, slug, token, codigo, avatar_url, squad_id from vistto.clientes order by slug');
assert.deepEqual(clientes.map(c => c.id).sort(), [C1, C2].sort()); ok();
assert.equal(clientes.find(c => c.id === C1).token, 'a'.repeat(24)); assert.equal(clientes.find(c => c.id === C1).codigo, 'abcdefgh'); ok();
assert.equal((await q(`select count(*)::int n from vistto.posts where id=$1`, [P4]))[0].n, 0); ok();
assert.equal((await q(`select count(*)::int n from vistto.aprovacoes`))[0].n, 2); ok();
assert.equal((await q(`select count(*)::int n from public.clientes`))[0].n, 1); ok();   // taskmanager intacto

// pessoas: o dono usa o login que já existia; os outros ganharam login novo com código de primeiro acesso
const equipe = await q(`select u.email, a.papel from vistto.agencia_usuarios a join auth.users u on u.id=a.usuario_id order by u.email`);
assert.deepEqual(equipe, [{ email: 'designer@forno.test', papel: 'designer' }, { email: 'dono@forno.test', papel: 'dono' }, { email: 'gestor@forno.test', papel: 'gestor_trafego' }]); ok();
assert.equal((await q(`select usuario_id from vistto.agencia_usuarios where papel='dono'`))[0].usuario_id, donoNovo); ok();
for (const c of r.codigos) {
  const [cv] = await q(`select c.usuario_id, c.codigo_hash from vistto.convites c join auth.users u on u.id=c.usuario_id where u.email=$1`, [c.email]);
  assert.equal(cv.codigo_hash, crypto.createHash('sha256').update(`${cv.usuario_id}:${c.codigo}`).digest('hex')); ok();
}
assert.equal((await q(`select situacao from public.pessoas where email='designer@forno.test'`))[0].situacao, 'inativo'); ok();   // aparece inativo no taskmanager
assert.equal((await q(`select count(*)::int n from vistto.squad_membros`))[0].n, 2); ok();
assert.equal((await q(`select count(*)::int n from vistto.cliente_gestores g join auth.users u on u.id=g.usuario_id where u.email='gestor@forno.test'`))[0].n, 1); ok();
assert.equal((await q(`select usa_squads from vistto.agencias`))[0].usa_squads, true); ok();

// posts: status, responsável (quem saiu da equipe fica sem), revisão interna e datas
const posts = Object.fromEntries((await q(`select p.id, p.status, p.interno, p.slides, p.video_url, p.capa_url, u.email resp from vistto.posts p left join auth.users u on u.id=p.responsavel`)).map(p => [p.id, p]));
assert.equal(posts[P1].status, 'aprovado'); assert.equal(posts[P1].resp, 'designer@forno.test'); ok();
assert.equal(posts[P2].status, 'ajuste'); assert.equal(posts[P2].resp, null); ok();
assert.equal(posts[P3].interno, 'revisao'); ok();
const meses = Object.fromEntries((await q(`select id, publicado, publicado_em, created_at from vistto.meses`)).map(m => [m.id, m]));
assert.equal(meses[M1].publicado, true); assert.equal(+meses[M1].publicado_em, +new Date('2026-09-01T12:00:00Z')); ok();
assert.equal(meses[M2].publicado_em, null); assert.equal(+meses[M2].created_at, +new Date('2026-09-20T10:00:00Z')); ok();

// artes: tudo no R2 novo, em r2:<Forno>/..., com os mesmos bytes
const refs = [...clientes.map(c => c.avatar_url), ...Object.values(posts).flatMap(p => [...p.slides, p.video_url, p.capa_url]), ...(await q('select capa_url from vistto.destaques')).map(x => x.capa_url)].filter(Boolean);
assert.equal(refs.length, 7); ok();
for (const ref of refs) { assert.ok(ref.startsWith(`r2:${FORNO}/`), ref); assert.ok(r2Novo.m.has(ref.slice(3)), ref); }
ok();
assert.ok(r2Novo.m.get(`${FORNO}/a.jpg`).body.equals(arquivos[`${FORNO}/a.jpg`])); ok();
assert.equal(posts[P2].capa_url, `r2:${FORNO}/legado/antigo/capa_reel.jpg`); assert.ok(r2Novo.m.get(`${FORNO}/legado/antigo/capa_reel.jpg`).body.equals(storageAntigo.get('antigo/capa reel.jpg'))); ok();
assert.equal(r2Novo.m.get(`${FORNO}/v.mp4`).tipo, 'video/mp4'); ok();
assert.ok(![...r2Novo.m.keys()].some(k => k.startsWith(OUTRA))); ok();

// o painel e o link do cliente funcionam com os dados migrados
await B.exec(`set role service_role; set search_path to vistto;`);
const pag = (await B.query(`select get_mes($1,'2026-09','instagram',null) j`, ['a'.repeat(24)])).rows[0].j;
assert.equal(pag.posts.length, 2); assert.equal(pag.agencia.id, FORNO); ok();
assert.equal((await B.query(`select resolver_link('padaria','abcdefgh') t`)).rows[0].t, 'a'.repeat(24)); ok();
await B.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${donoNovo}';`);
assert.equal((await B.query(`select pode_ref($1) ok`, [`r2:${FORNO}/legado/antigo/capa_reel.jpg`])).rows[0].ok, true); ok();
assert.equal((await B.query(`select meu_contexto() c`)).rows[0].c.agencias[0].nivel, 3); ok();
await B.exec("reset role; reset search_path; set request.jwt.claim.sub='';");

/* ---------- 3. rodar de novo não duplica nada ---------- */
const meio = await contarB();
const r2x = await migrar(cfg(true), quieto);
assert.deepEqual(await contarB(), meio); ok();
assert.equal(r2x.codigos.length, 0); assert.equal(r2x.pessoas.novas, 0); ok();
assert.equal(r2x.artes.ja_estavam, 7); ok();

/* ---------- 4. arte que não copia: para antes de gravar ---------- */
storageAntigo.delete(`${FORNO}/destaque.jpg`); r2Novo.m.delete(`${FORNO}/legado/${FORNO}/destaque.jpg`);
await B.exec(`delete from vistto.destaques`);
await assert.rejects(migrar(cfg(true), quieto), /Parei antes de gravar/); ok();
assert.equal((await q('select count(*)::int n from vistto.destaques'))[0].n, 0); ok();

servidor.close(); await A.close(); await B.close();
console.log(`PASS: ${checks} checks da migração: simulação sem gravar, só a Forno, mesmos ids e links, logins casados por e-mail, códigos de primeiro acesso, artes do R2/Storage/externas no R2 novo, datas preservadas, painel e link funcionando, repetível.`);
