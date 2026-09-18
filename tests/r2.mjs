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
for (const f of ['multi-agencias', 'hierarquia', 'squads', 'convites', 'divisoes', 'gestores', 'espaco', 'r2', 'endurecer']) await db.exec(rd(`../supabase/${f}.sql`));

const A = { a: '10000000-0000-4000-8000-000000000001', b: '10000000-0000-4000-8000-000000000002' };
const P = { admin: null, dono: ['b', 'dono'], head1: ['b', 'head'], head2: ['b', 'head'], des1: ['b', 'designer'], des2: ['b', 'designer'], traf: ['b', 'gestor_trafego'], desA: ['a', 'designer'], fora: null };
const id = {}; let i = 1; for (const k in P) id[k] = `70000000-0000-4000-8000-${String(i++).padStart(12, '0')}`;
await db.exec(`insert into auth.users values ${Object.keys(P).map(k => `('${id[k]}','${k}@x.test',now())`).join(',')};
insert into administradores values('${id.admin}');
insert into agencia_usuarios(agencia_id,usuario_id,papel) values ${Object.entries(P).filter(([, v]) => v).map(([k, [g, p]]) => `('${A[g]}','${id[k]}','${p}')`).join(',')};`);
const q = (s, p) => db.query(s, p), rows = async (s, p) => (await q(s, p)).rows;
let checks = 0; const ok = () => checks++;
async function as(who, fn) { await db.exec(`set role authenticated;set request.jwt.claim.sub='${id[who]}';`); try { return await fn(); } finally { await db.exec('reset role;'); } }

const S1 = (await rows(`insert into squads(agencia_id,nome) values($1,'Squad 1') returning id`, [A.b]))[0].id;
const S2 = (await rows(`insert into squads(agencia_id,nome) values($1,'Squad 2') returning id`, [A.b]))[0].id;
await q(`insert into squad_membros values($1,$2),($1,$3),($1,$4),($5,$6),($5,$7)`, [S1, id.head1, id.des1, id.traf, S2, id.head2, id.des2]);

// referências do R2
const R = { slide: `r2:${A.b}/slide.jpg`, video: `r2:${A.b}/reel.mp4`, capa: `r2:${A.b}/capa.jpg`, avatar: `r2:${A.b}/avatar.jpg`, destaque: `r2:${A.b}/destaque.jpg`, outroSquad: `r2:${A.b}/outro.jpg`, outraAg: `r2:${A.a}/dela.jpg`, solto: `r2:${A.b}/ninguem.jpg` };
const c1 = (await rows(`insert into clientes(agencia_id,squad_id,nome,slug,token,avatar_url) values($1,$2,'c1','c1',$3,$4) returning id`, [A.b, S1, 'c1'.repeat(12), R.avatar]))[0].id;
const c2 = (await rows(`insert into clientes(agencia_id,squad_id,nome,slug,token) values($1,$2,'c2','c2',$3) returning id`, [A.b, S2, 'c2'.repeat(12)]))[0].id;
const ca = (await rows(`insert into clientes(agencia_id,nome,slug,token) values($1,'ca','ca',$2) returning id`, [A.a, 'ca'.repeat(12)]))[0].id;
await q(`insert into destaques(cliente_id,nome,capa_url,ordem) values($1,'d',$2,0)`, [c1, R.destaque]);
const m1 = (await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-10','Out',true) returning id`, [c1]))[0].id;
const m2 = (await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-10','Out',true) returning id`, [c2]))[0].id;
const ma = (await rows(`insert into meses(cliente_id,ano_mes,titulo,publicado) values($1,'2026-10','Out',true) returning id`, [ca]))[0].id;
const p1 = (await rows(`insert into posts(mes_id,titulo,tipo,slides,video_url,capa_url) values($1,'p','reel',$2,$3,$4) returning id`, [m1, JSON.stringify([R.slide]), R.video, R.capa]))[0].id;
await q(`insert into posts(mes_id,titulo,slides) values($1,'p',$2)`, [m2, JSON.stringify([R.outroSquad])]);
await q(`insert into posts(mes_id,titulo,slides) values($1,'p',$2)`, [ma, JSON.stringify([R.outraAg])]);

// caminho sai igual para as duas formas de guardar
assert.equal((await rows(`select midia_path($1) p`, [R.slide]))[0].p, `${A.b}/slide.jpg`); ok();
assert.equal((await rows(`select midia_path($1) p`, [`midia:${A.b}/x.jpg`]))[0].p, `${A.b}/x.jpg`); ok();
assert.equal((await rows(`select midia_path('nada') p`))[0].p, null); ok();

const ve = async (who, ref) => (await as(who, () => rows('select pode_ref($1) v', [ref])))[0].v;
// quem está no squad do cliente vê as artes dele
for (const ref of [R.slide, R.video, R.capa, R.avatar, R.destaque]) {
  assert.equal(await ve('head1', ref), true, 'head1 ' + ref); ok();
  assert.equal(await ve('des1', ref), true, 'des1 ' + ref); ok();
  assert.equal(await ve('dono', ref), true, 'dono ' + ref); ok();
  assert.equal(await ve('des2', ref), false, 'des2 ' + ref); ok();
  assert.equal(await ve('desA', ref), false, 'desA ' + ref); ok();
  assert.equal(await ve('fora', ref), false, 'fora ' + ref); ok();
}
// gestor de tráfego: só depois de receber o cliente
assert.equal(await ve('traf', R.slide), false); ok();
await as('head1', async () => { await q('select definir_gestor_cliente($1,$2,true)', [c1, id.traf]); ok(); });
assert.equal(await ve('traf', R.slide), true); ok();
assert.equal(await ve('traf', R.outroSquad), false); ok();
// arte de outro squad e de outra agência
assert.equal(await ve('head1', R.outroSquad), false); ok();
assert.equal(await ve('dono', R.outroSquad), true); ok();
assert.equal(await ve('dono', R.outraAg), false); ok();
assert.equal(await ve('admin', R.outraAg), true); ok();
// arte que não está em nenhum post: só dono, sócio e admin (é quem enxerga a agência inteira)
assert.equal(await ve('des1', R.solto), false); ok();
assert.equal(await ve('dono', R.solto), true); ok();
assert.equal(await ve('admin', R.solto), true); ok();
// caminho inventado não passa
assert.equal(await ve('dono', 'r2:../segredo'), false); ok();
assert.equal(await ve('dono', 'r2:'), false); ok();
assert.equal(await ve('dono', 'midia:' + A.b + '/x.jpg'), true); ok();

// enviar: qualquer pessoa da equipe da agência; de fora, não
const env = async (who, ag) => (await as(who, () => rows('select pode_enviar($1) v', [A[ag]])))[0].v;
for (const w of ['dono', 'head1', 'des1', 'traf']) { assert.equal(await env(w, 'b'), true, w); ok(); }
assert.equal(await env('desA', 'b'), false); ok();
assert.equal(await env('fora', 'b'), false); ok();
assert.equal(await env('des1', 'a'), false); ok();
assert.equal(await env('admin', 'b'), true); ok();

// o post aceita referência do R2 da própria agência e recusa a de outra
await as('des1', async () => {
  await q(`update posts set slides=$1 where id=$2`, [JSON.stringify([R.slide, `r2:${A.b}/nova.jpg`]), p1]); ok();
  await assert.rejects(q(`update posts set slides=$1 where id=$2`, [JSON.stringify([R.outraAg]), p1])); ok();
});
// número do post é texto simples: nada de código na página do cliente
await as('des1', async () => {
  await assert.rejects(q(`update posts set numero=$1 where id=$2`, ['<img src=x onerror=alert(1)>', p1])); ok();
  await assert.rejects(q(`update posts set numero=$1 where id=$2`, ['0123456789012345', p1])); ok();
  await q(`update posts set numero=$1 where id=$2`, ['01', p1]); ok();
  await q(`update posts set numero=$1 where id=$2`, ['1-2 A', p1]); ok();
  await assert.rejects(q(`update posts set data=$1 where id=$2`, ['x'.repeat(20), p1])); ok();
});

// código de primeiro acesso: a tentativa é contada antes da conferência
const uConv = id.des2;
await q(`insert into convites(usuario_id,codigo_hash,expira_em) values($1,'hash',now()+interval '2 days')`, [uConv]);
const tentar = async () => (await rows(`select * from tentar_convite($1)`, ['des2@x.test'])).length;
for (let n = 1; n <= 5; n++) { assert.equal(await tentar(), 1, 'tentativa ' + n); ok(); }
assert.equal(await tentar(), 0); ok();
assert.equal((await rows('select tentativas from convites where usuario_id=$1', [uConv]))[0].tentativas, 5); ok();
// convite vencido não devolve nada
await q(`update convites set tentativas=0, expira_em=now()-interval '1 hour' where usuario_id=$1`, [uConv]);
assert.equal(await tentar(), 0); ok();
// e a equipe não alcança a função
await as('des1', async () => { await assert.rejects(q(`select * from tentar_convite($1)`, ['des2@x.test'])); ok(); });

// o Storage do Supabase não aceita mais envio novo
assert.equal((await rows(`select count(*)::int n from pg_policies where tablename='objects' and policyname='midia_agencia_insert'`))[0].n, 0); ok();

// anônimo não usa nenhuma das duas funções
await db.exec('set role anon');
await assert.rejects(q('select pode_ref($1)', [R.slide])); ok();
await assert.rejects(q('select pode_enviar($1)', [A.b])); ok();
await db.exec('reset role');

console.log('PASS:', checks, 'checks do R2 e das fechaduras: caminho, quem vê cada arte, quem envia, número sem código, tentativa atômica e Storage fechado.');
await db.close();
