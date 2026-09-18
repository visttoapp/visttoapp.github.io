import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const SEGREDO = 'segredo-de-teste';
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function assinar(metodo, caminho, exp) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${metodo}:${caminho}:${exp}`)));
}
// bucket de mentira
const bucket = new Map();
const env = {
  SIGN_SECRET: SEGREDO,
  MIDIA: {
    async get(k) { const v = bucket.get(k); return v ? { body: v.body, size: v.body.length, httpMetadata: { contentType: v.tipo }, httpEtag: '"x"' } : null; },
    async head(k) { return bucket.has(k) ? { size: 1 } : null; },
    async put(k, body, opt) { bucket.set(k, { body: 'conteudo', tipo: opt?.httpMetadata?.contentType }); },
    async delete(k) { bucket.delete(k); }
  }
};
const ORIGEM = 'https://visttoapp.github.io';
const futuro = () => Math.floor(Date.now() / 1000) + 600;
const chamar = async (metodo, caminho, { exp, sig, tipo, origem = ORIGEM, corpo } = {}) => {
  const e = exp ?? futuro();
  const s = sig ?? await assinar(metodo, caminho, String(e));
  const h = { Origin: origem };
  if (tipo) h['Content-Type'] = tipo;
  return worker.fetch(new Request(`https://midia.vistto.app/m/${encodeURIComponent(caminho).replace(/%2F/g, '/')}?exp=${e}&sig=${s}`, { method: metodo, headers: h, body: corpo }), env);
};

let checks = 0; const ok = () => checks++;
const CAMINHO = '10000000-0000-4000-8000-000000000002/arte.jpg';

// grava, lê e apaga com assinatura válida
let r = await chamar('PUT', CAMINHO, { tipo: 'image/jpeg', corpo: 'conteudo' });
assert.equal(r.status, 200); ok();
assert.equal(bucket.get(CAMINHO).tipo, 'image/jpeg'); ok();
r = await chamar('GET', CAMINHO);
assert.equal(r.status, 200); ok();
assert.equal(r.headers.get('Content-Type'), 'image/jpeg'); ok();
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGEM); ok();
assert.equal(await r.text(), 'conteudo'); ok();

// assinatura de outro método não vale
r = await chamar('DELETE', CAMINHO, { sig: await assinar('GET', CAMINHO, String(futuro())) });
assert.equal(r.status, 403); ok();
assert.ok(bucket.has(CAMINHO)); ok();
// assinatura de outro caminho não vale
r = await chamar('GET', CAMINHO, { sig: await assinar('GET', 'outro/arquivo.jpg', String(futuro())) });
assert.equal(r.status, 403); ok();
// assinatura vencida não vale
r = await chamar('GET', CAMINHO, { exp: Math.floor(Date.now() / 1000) - 10 });
assert.equal(r.status, 403); ok();
// sem assinatura não vale
r = await worker.fetch(new Request(`https://x/m/${CAMINHO}`), env);
assert.equal(r.status, 403); ok();

// não sobrescreve arquivo existente
r = await chamar('PUT', CAMINHO, { tipo: 'image/jpeg', corpo: 'outro' });
assert.equal(r.status, 409); ok();
// formato barrado
r = await chamar('PUT', 'ag/arquivo.exe', { tipo: 'application/x-msdownload', corpo: 'x' });
assert.equal(r.status, 415); ok();
// caminho suspeito barrado
r = await worker.fetch(new Request('https://x/m/%2E%2E%2Fsegredo?exp=1&sig=1'), env);
assert.equal(r.status, 400); ok();
// arquivo que não existe
r = await chamar('GET', 'ag/nao-existe.jpg');
assert.equal(r.status, 404); ok();
// apaga com a assinatura certa
r = await chamar('DELETE', CAMINHO);
assert.equal(r.status, 200); ok();
assert.equal(bucket.has(CAMINHO), false); ok();

// site de fora não recebe permissão de CORS
r = await chamar('GET', 'ag/nada.jpg', { origem: 'https://site-estranho.com' });
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null); ok();
// preflight do site autorizado
r = await worker.fetch(new Request('https://x/m/a.jpg', { method: 'OPTIONS', headers: { Origin: ORIGEM } }), env);
assert.equal(r.status, 204); ok();
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGEM); ok();
// rota fora do padrão
r = await worker.fetch(new Request('https://x/qualquer', { method: 'GET' }), env);
assert.equal(r.status, 404); ok();
// worker sem segredo não serve nada
r = await worker.fetch(new Request(`https://x/m/${CAMINHO}?exp=${futuro()}&sig=abc`), { ...env, SIGN_SECRET: '' });
assert.equal(r.status, 500); ok();

console.log('PASS:', checks, 'checks do Worker: assinatura por método e caminho, prazo, CORS, tipos e sobrescrita.');
