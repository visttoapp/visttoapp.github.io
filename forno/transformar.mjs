/* Vistto · Forno — transforma o Vistto (duas agências, schema public) na versão só da Forno,
   instalada no schema "vistto" para conviver com o taskmanager no mesmo projeto do Supabase.
   Cada troca confere quantas vezes aconteceu: se o código de origem mudar, o pacote não sai torto. */

export const FORNO = '10000000-0000-4000-8000-000000000002';
export const OUTRA = '10000000-0000-4000-8000-000000000001';
export const SCHEMA = 'vistto';
export const FUNCOES = ['cliente', 'acessos', 'primeiro-acesso', 'midia', 'limpeza'];
export const nomeFuncao = f => `vistto-${f}`;

// troca exata, com a contagem conferida
export function trocar(texto, de, para, vezes = 1, onde = '') {
  const achou = typeof de === 'string' ? texto.split(de).length - 1 : (texto.match(new RegExp(de.source, de.flags.includes('g') ? de.flags : de.flags + 'g')) || []).length;
  if (vezes !== '*' && achou !== vezes) throw new Error(`${onde}: esperava ${vezes} ocorrência(s) de ${de}, achei ${achou}`);
  if (typeof de === 'string') return texto.split(de).join(para);
  return texto.replace(new RegExp(de.source, de.flags.includes('g') ? de.flags : de.flags + 'g'), para);
}

/* ---------- SQL ---------- */

// Só o nome do schema: public.x → vistto.x e search_path = public → vistto. "to public"/"from public" (o papel PUBLIC) ficam.
export function sqlParaSchema(sql, onde = 'sql') {
  let s = sql.replace(/\bpublic\.(?=[a-z_"%])/g, `${SCHEMA}.`);
  s = s.replace(/search_path\s*=\s*public\b/g, `search_path = ${SCHEMA}`);
  s = s.replace(/search_path\s*=\s*'public'/g, `search_path='${SCHEMA}'`);
  if (/\bpublic\.[a-z_"%]/.test(s)) throw new Error(`${onde}: sobrou referência a public.`);
  return s;
}

// Mesmas permissões padrão que o Supabase dá ao schema public, agora no schema vistto.
export const PREAMBULO = `create schema if not exists ${SCHEMA};
grant usage on schema ${SCHEMA} to anon, authenticated, service_role;
alter default privileges in schema ${SCHEMA} grant all on tables to anon, authenticated, service_role;
alter default privileges in schema ${SCHEMA} grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema ${SCHEMA} grant all on functions to anon, authenticated, service_role;
-- nomes sem schema caem no vistto; o public (taskmanager) fica fora do caminho de propósito
set search_path to ${SCHEMA}, extensions;
`;

export const CABECALHO = `-- =====================================================================
--  VISTTO · FORNO — instalação completa do banco (rode uma vez só)
--  Supabase › SQL Editor › New query › cole este arquivo inteiro › Run
--
--  Tudo fica no schema "${SCHEMA}", separado das tabelas do taskmanager (schema public).
--  Nada do public é criado, alterado ou apagado. Os logins (auth.users) são os mesmos.
--  Só existe uma agência: a Forno (id ${FORNO}).
--  Depois de rodar: Project Settings › Data API › Exposed schemas › acrescente "${SCHEMA}".
-- =====================================================================
`;

export function montarSchema(schemaSql) {
  let s = schemaSql;
  // primeira linha era um aviso para o projeto antigo
  s = s.replace(/^-- INSTALAÇÃO NOVA APENAS\.[^\n]*\n/, '');
  // só a Forno
  s = trocar(s, ` ('${OUTRA}','agencia-1','Agência 1'),\n ('${FORNO}','agencia-2','Agência 2');`,
    ` ('${FORNO}','forno','Forno Lab');`, 1, 'agências');
  s = trocar(s, `'${OUTRA}'`, `'${FORNO}'`, 2, 'id da outra agência');
  if (s.includes(OUTRA)) throw new Error('sobrou o id da outra agência');
  s = sqlParaSchema(s, 'schema.sql');
  return CABECALHO + PREAMBULO + s.replace(/\s*$/, '\n') + 'reset search_path;\n';
}

/* ---------- funções do Supabase (Deno) ---------- */
export function montarFuncao(nome, ts) {
  const onde = `função ${nome}`;
  const clientes = { cliente: 1, acessos: 1, 'primeiro-acesso': 1, midia: 1, limpeza: 2 }[nome];
  let s = trocar(ts, '{auth:{persistSession:false}', `{db:{schema:'${SCHEMA}'},auth:{persistSession:false}`, clientes, onde);
  const R2 = `(Deno.env.get('R2_BASE')||'https://vistto-midia.felipelabmor.workers.dev')`;
  if (nome === 'cliente') {
    s = trocar(s, R2, `(Deno.env.get('R2_BASE')||'')`, 1, onde);
    s = trocar(s, `if(!segredo)throw new Error('sem segredo');`, `if(!segredo||!base)throw new Error('sem segredo ou R2_BASE');`, 1, onde);
  }
  if (nome === 'limpeza') {
    s = trocar(s, R2, `(Deno.env.get('R2_BASE')||'')`, 1, onde);
    s = trocar(s, `if(!segredo)throw new Error('Servidor sem segredo configurado.');`, `if(!segredo||!base)throw new Error('Servidor sem SIGN_SECRET ou R2_BASE configurado.');`, 1, onde);
  }
  if (nome === 'midia') {
    s = trocar(s, R2, `(Deno.env.get('R2_BASE')||'')`, 1, onde);
    s = trocar(s, `if(!Deno.env.get('SIGN_SECRET'))return reply({error:'Servidor sem segredo configurado.'},500);`,
      `if(!Deno.env.get('SIGN_SECRET')||!BASE)return reply({error:'Servidor sem SIGN_SECRET ou R2_BASE configurado.'},500);`, 1, onde);
  }
  if (s.includes('felipelabmor')) throw new Error(`${onde}: sobrou o Worker antigo`);
  return s;
}

export const CONFIG_TOML = `# As cinco funções do Vistto conferem o login (ou o link do cliente) por conta própria.
# vistto-cliente e vistto-primeiro-acesso são chamadas sem login; as outras validam o token de quem chamou.
# Por isso todas ficam com verify_jwt = false (também evita problema com as chaves JWT novas do Supabase).
${FUNCOES.map(f => `[functions.${nomeFuncao(f)}]\nverify_jwt = false\n`).join('\n')}`;

/* ---------- site (GitHub Pages) ---------- */
export const VERSAO = '20261014f';

export function montarSite(arq, texto, cfg) {
  const onde = `site ${arq}`;
  let s = texto;
  if (arq === 'js/config.js') {
    return `/* Vistto · Forno — projeto do Supabase e schema onde o Vistto foi instalado.
   A chave publicável é pública por natureza (vai para o navegador). Nunca coloque aqui a service_role/secret. */
window.CONFIG = { SUPABASE_URL: "${cfg.url}", SUPABASE_ANON_KEY: "${cfg.chave}", DB_SCHEMA: "${SCHEMA}" };
`;
  }
  if (arq === 'js/admin.js') {
    s = trocar(s, `window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);`,
      `window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { db: { schema: cfg.DB_SCHEMA || 'public' } });`, 1, onde);
    for (const f of ['primeiro-acesso', 'acessos', 'midia', 'limpeza']) s = trocar(s, `/functions/v1/${f}'`, `/functions/v1/${nomeFuncao(f)}'`, 1, onde);
  }
  if (arq === 'js/media.js') s = trocar(s, `/functions/v1/midia'`, `/functions/v1/${nomeFuncao('midia')}'`, 1, onde);
  if (arq === 'js/client-api.js') {
    s = trocar(s, `/functions/v1/cliente'`, `/functions/v1/${nomeFuncao('cliente')}'`, 1, onde);
    // a resposta do cliente vai direto ao banco: o schema vistto precisa ir no cabeçalho
    s = trocar(s, `method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.SUPABASE_ANON_KEY},\n      body:JSON.stringify({p_token`,
      `method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.SUPABASE_ANON_KEY,'Content-Profile':cfg.DB_SCHEMA||'public'},\n      body:JSON.stringify({p_token`, 1, onde);
  }
  if (arq === 'js/brand.js') {
    s = trocar(s, `    '${OUTRA}': { tema: 'classico', logo: 'assets/marcas/m1/horizontal.svg', icone: 'assets/marcas/m1/icone.svg' },\n`, '', 1, onde);
    s = trocar(s, `'${FORNO}': { tema: 'escuro', logo: 'assets/marcas/m2/marca.svg', icone: 'assets/marcas/m2/marca.svg' }`,
      `'${FORNO}': { tema: 'escuro', logo: 'assets/marcas/forno/marca.svg', icone: 'assets/marcas/forno/marca.svg' }`, 1, onde);
  }
  if (arq === 'css/agencies.css') {
    s = trocar(s, /\/\* Clássico:[^]*?body\[data-tema="classico"\] \.dots i\.on\{background:#c3ad7e\}\n\n/, '', 1, onde);
    if (s.includes('classico')) throw new Error(`${onde}: sobrou o tema da outra agência`);
  }
  if (arq === 'index.html' || arq === 'c.html') {
    s = trocar(s, '&family=Cormorant+Garamond:wght@500', '', 1, onde);
    s = trocar(s, /\?v=20261009d/, `?v=${VERSAO}`, '*', onde);
    if (s.includes('20261009d')) throw new Error(`${onde}: versão antiga no cache`);
  }
  if (arq === 'js/link.js') s = trocar(s, 'visttoapp.github.io/c#', 'seu-site/c#', 1, onde);
  return s;
}

/* ---------- Worker (Cloudflare) ---------- */
export function montarWorker(js) {
  const onde = 'worker';
  let s = trocar(js, `const ORIGENS = ['https://visttoapp.github.io'];`,
    `// Sites que podem pedir as artes direto do navegador. Vem da variável ORIGENS (wrangler.jsonc), separada por vírgula.\nlet ORIGENS = [];`, 1, onde);
  s = trocar(s, `  async fetch(req, env) {\n`,
    `  async fetch(req, env) {\n    ORIGENS = String(env.ORIGENS || '').split(',').map(o => o.trim().replace(/\\/+$/, '')).filter(Boolean);\n`, 1, onde);
  s = trocar(s, `Vistto · porta de entrada`, `Vistto · Forno · porta de entrada`, 1, onde);
  return s;
}

export const WRANGLER = `{
  // Worker que serve as artes do Vistto (Forno) a partir do bucket R2 privado.
  // O segredo SIGN_SECRET NÃO fica aqui: Cloudflare › Workers › forno-vistto-midia › Settings › Variables and Secrets.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "forno-vistto-midia",
  "main": "worker/index.js",
  "compatibility_date": "2026-09-01",
  "observability": { "enabled": true },
  "vars": {
    // endereço do site (GitHub Pages ou domínio próprio), sem barra no fim. Mais de um: separe por vírgula.
    "ORIGENS": "https://TROQUE-PELO-SITE.github.io"
  },
  "r2_buckets": [
    { "binding": "MIDIA", "bucket_name": "forno-vistto-midia" }
  ]
}
`;
