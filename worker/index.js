/* Vistto · porta de entrada das mídias no Cloudflare R2.
   O bucket é privado e este Worker é a única porta. Ele não sabe quem é quem:
   confia numa assinatura curta (HMAC-SHA256) emitida pelo Supabase, que é quem
   confere o login, o squad e o link do cliente. Assinatura vencida não abre nada.

   GET    /m/<caminho>?exp=<segundos>&sig=<assinatura>   lê o arquivo
   PUT    /m/<caminho>?exp=<segundos>&sig=<assinatura>   grava o arquivo
   DELETE /m/<caminho>?exp=<segundos>&sig=<assinatura>   apaga o arquivo

   Segredo compartilhado: variável SIGN_SECRET (secret do Worker e do Supabase).
   Bucket: binding MIDIA. */

const ORIGENS = ['https://visttoapp.github.io'];
const TIPOS = /^(image\/(jpeg|png|webp|gif)|video\/mp4)$/;
const LIMITE = 100 * 1024 * 1024;

const cabecalhos = (req, extra = {}) => {
  const origem = req.headers.get('Origin') || '';
  const h = { 'Cache-Control': 'no-store', ...extra };
  if (ORIGENS.includes(origem)) {
    h['Access-Control-Allow-Origin'] = origem;
    h['Vary'] = 'Origin';
    h['Access-Control-Allow-Headers'] = 'content-type';
    h['Access-Control-Allow-Methods'] = 'GET, PUT, DELETE, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
};
const erro = (req, texto, status) => new Response(JSON.stringify({ error: texto }), { status, headers: cabecalhos(req, { 'Content-Type': 'application/json' }) });

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function assinatura(segredo, metodo, caminho, exp) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${metodo}:${caminho}:${exp}`)));
}
// comparação de tempo constante, para a assinatura não vazar por tentativa e erro
const iguais = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos(req) });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/saude') return new Response('vistto', { status: 200, headers: cabecalhos(req) });
    if (!url.pathname.startsWith('/m/')) return erro(req, 'Rota inválida.', 404);
    if (!env.SIGN_SECRET) return erro(req, 'Worker sem segredo configurado.', 500);

    const caminho = decodeURIComponent(url.pathname.slice(3));
    if (!caminho || caminho.includes('..') || caminho.length > 300) return erro(req, 'Caminho inválido.', 400);

    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') || '';
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return erro(req, 'Link vencido. Recarregue a página.', 403);
    const esperada = await assinatura(env.SIGN_SECRET, req.method, caminho, String(exp));
    if (!iguais(sig, esperada)) return erro(req, 'Link inválido.', 403);

    if (req.method === 'GET' || req.method === 'HEAD') {
      const obj = await env.MIDIA.get(caminho);
      if (!obj) return erro(req, 'Arquivo não encontrado.', 404);
      const h = cabecalhos(req, { 'Cache-Control': 'private, max-age=3600', 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' });
      if (obj.size != null) h['Content-Length'] = String(obj.size);
      if (obj.httpEtag) h['ETag'] = obj.httpEtag;
      return new Response(req.method === 'HEAD' ? null : obj.body, { headers: h });
    }

    if (req.method === 'PUT') {
      const tipo = req.headers.get('Content-Type') || '';
      if (!TIPOS.test(tipo)) return erro(req, 'Use JPG, PNG, WebP, GIF ou MP4.', 415);
      const tamanho = Number(req.headers.get('Content-Length') || 0);
      if (tamanho > LIMITE) return erro(req, 'Arquivo grande demais.', 413);
      if (await env.MIDIA.head(caminho)) return erro(req, 'Esse arquivo já existe.', 409);
      await env.MIDIA.put(caminho, req.body, { httpMetadata: { contentType: tipo } });
      return new Response(JSON.stringify({ ok: true, caminho }), { headers: cabecalhos(req, { 'Content-Type': 'application/json' }) });
    }

    if (req.method === 'DELETE') {
      await env.MIDIA.delete(caminho);
      return new Response(JSON.stringify({ ok: true }), { headers: cabecalhos(req, { 'Content-Type': 'application/json' }) });
    }

    return erro(req, 'Método inválido.', 405);
  }
};
