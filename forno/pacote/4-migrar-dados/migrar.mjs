#!/usr/bin/env node
/* Vistto · Forno — leva os dados da Forno do Vistto antigo (projeto do Felipe) para o novo (schema vistto).
   Copia só a agência da Forno: squads, equipe, clientes, meses, posts, destaques, aprovações e gestores,
   com os mesmos ids, tokens e códigos de link. As artes vão para o R2 novo; as antigas do Storage
   do Supabase também vão para o R2 (pasta legado/), e as referências são reescritas.

   Node 18 ou mais novo, sem instalar nada. Por padrão só SIMULA (lê tudo e mostra o que faria).
     node migrar.mjs              → simulação
     node migrar.mjs --executar   → grava de verdade (pode rodar de novo: não duplica)
   Variáveis (veja LEIA-ME.md): ANTIGO_SUPABASE_URL ANTIGO_SERVICE_KEY ANTIGO_R2_BASE ANTIGO_SIGN_SECRET
                                NOVO_SUPABASE_URL NOVO_SERVICE_KEY NOVO_R2_BASE NOVO_SIGN_SECRET */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORNO = '10000000-0000-4000-8000-000000000002';
const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4' };
const ACEITOS = new Set(Object.values(TIPOS));
const LOTE = 200;

const hex = b => Buffer.from(b).toString('hex');
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const semBarra = u => String(u || '').replace(/\/+$/, '');
const caminhoUrl = c => c.split('/').map(encodeURIComponent).join('/');
function assinar(segredo, metodo, caminho, exp) {
  return hex(crypto.createHmac('sha256', segredo).update(`${metodo}:${caminho}:${exp}`).digest());
}
function linkR2(base, segredo, metodo, caminho, segundos = 900) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  return `${semBarra(base)}/m/${caminhoUrl(caminho)}?exp=${exp}&sig=${assinar(segredo, metodo, caminho, exp)}`;
}

/* ---------- conversa com o Supabase (REST e Auth) usando a chave de servidor ---------- */
function cliente(lado) {
  const base = semBarra(lado.url);
  // chave nova (sb_secret_...) vai só no apikey; a antiga (JWT service_role) vai nos dois cabeçalhos
  const cab = lado.chave.startsWith('sb_') ? { apikey: lado.chave } : { apikey: lado.chave, Authorization: `Bearer ${lado.chave}` };
  async function pedir(metodo, caminho, { corpo, extra = {} } = {}) {
    const r = await fetch(base + caminho, { method: metodo, headers: { ...cab, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho.split('?')[0]} (${lado.nome}): ${r.status} ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : null;
  }
  const perfil = { 'Accept-Profile': lado.schema, 'Content-Profile': lado.schema };
  return {
    base,
    // lê a tabela inteira (com filtro), de mil em mil
    async ler(tabela, filtro = '', ordem = 'id') {
      const linhas = [];
      for (let de = 0; ; de += 1000) {
        const pagina = await pedir('GET', `/rest/v1/${tabela}?select=*${filtro ? '&' + filtro : ''}&order=${ordem}&limit=1000&offset=${de}`, { extra: perfil });
        linhas.push(...pagina);
        if (pagina.length < 1000) return linhas;
      }
    },
    // lê com "coluna in (...)", em pedaços, para a URL não ficar enorme
    async lerIn(tabela, coluna, valores, ordem = 'id') {
      const linhas = [];
      const lista = [...new Set(valores)];
      for (let i = 0; i < lista.length; i += 80) linhas.push(...await this.ler(tabela, `${coluna}=in.(${lista.slice(i, i + 80).join(',')})`, ordem));
      return linhas;
    },
    async gravar(tabela, linhas, conflito) {
      for (let i = 0; i < linhas.length; i += LOTE)
        await pedir('POST', `/rest/v1/${tabela}${conflito ? `?on_conflict=${conflito}` : ''}`, { corpo: linhas.slice(i, i + LOTE), extra: { ...perfil, Prefer: 'resolution=merge-duplicates,return=minimal' } });
    },
    async alterar(tabela, filtro, valores) {
      await pedir('PATCH', `/rest/v1/${tabela}?${filtro}`, { corpo: valores, extra: { ...perfil, Prefer: 'return=minimal' } });
    },
    async usuario(id) { return pedir('GET', `/auth/v1/admin/users/${id}`); },
    async usuarios() {
      const todos = [];
      for (let p = 1; ; p++) {
        const r = await pedir('GET', `/auth/v1/admin/users?page=${p}&per_page=1000`);
        const lista = Array.isArray(r) ? r : r.users || [];
        todos.push(...lista);
        if (lista.length < 1000) return todos;
      }
    },
    async criarUsuario(email) {
      const senha = crypto.randomBytes(32).toString('base64');
      const r = await pedir('POST', '/auth/v1/admin/users', { corpo: { email, password: senha, email_confirm: true, user_metadata: { trocar_senha: true } } });
      return r.user || r;
    },
    async baixarStorage(caminho) {
      const r = await fetch(`${base}/storage/v1/object/midia/${caminhoUrl(caminho)}`, { headers: cab });
      if (!r.ok) throw new Error(`Storage antigo sem o arquivo ${caminho} (${r.status})`);
      return { corpo: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') };
    }
  };
}

/* ---------- artes ---------- */
// Para onde vai cada referência no R2 novo. null = não é arte (texto vazio).
export function destinoDaArte(ref, antigoUrl) {
  if (typeof ref !== 'string' || !ref) return null;
  const publica = `${semBarra(antigoUrl)}/storage/v1/object/public/midia/`;
  const limpo = c => c.replace(/[^A-Za-z0-9._/-]/g, '_').replace(/\.{2,}/g, '.').replace(/^\/+/, '');
  if (ref.startsWith('r2:')) return { origem: 'r2', caminho: ref.slice(3), novo: ref.slice(3) };
  if (ref.startsWith('midia:')) return { origem: 'storage', caminho: ref.slice(6), novo: `${FORNO}/legado/${limpo(ref.slice(6))}` };
  if (ref.startsWith(publica)) { const c = decodeURIComponent(ref.slice(publica.length)); return { origem: 'storage', caminho: c, novo: `${FORNO}/legado/${limpo(c)}` }; }
  if (/^https?:\/\//.test(ref)) {
    const ext = (ref.split('?')[0].match(/\.([a-z0-9]{3,4})$/i) || [, 'jpg'])[1].toLowerCase();
    return { origem: 'url', caminho: ref, novo: `${FORNO}/legado/externo/${sha256(ref).slice(0, 20)}.${ext}` };
  }
  return { origem: 'desconhecida', caminho: ref, novo: null };
}
const tipoDe = (caminho, tipo) => {
  const t = String(tipo || '').split(';')[0].trim().toLowerCase();
  if (ACEITOS.has(t)) return t;
  return TIPOS[(caminho.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()] || null;
};

/* ---------- a migração ---------- */
export async function migrar(cfg, { log = console.log } = {}) {
  const exec = !!cfg.executar;
  const antigo = cliente({ ...cfg.antigo, nome: 'antigo', schema: cfg.antigo.schema || 'public' });
  const novo = cliente({ ...cfg.novo, nome: 'novo', schema: cfg.novo.schema || 'vistto' });
  const resumo = { modo: exec ? 'EXECUTAR' : 'SIMULAÇÃO', tabelas: {}, artes: {}, pessoas: {}, codigos: [], avisos: [] };

  /* 1. ler tudo da Forno no projeto antigo */
  const [agOld] = await antigo.ler('agencias', `id=eq.${FORNO}`);
  if (!agOld) throw new Error(`O projeto antigo não tem a agência ${FORNO}.`);
  const [agNovo] = await novo.ler('agencias', `id=eq.${FORNO}`);
  if (!agNovo) throw new Error('O projeto novo não tem a agência da Forno. Rode antes o 1-supabase/01-instalar-vistto.sql e exponha o schema vistto.');
  const d = {};
  d.squads = await antigo.ler('squads', `agencia_id=eq.${FORNO}`);
  d.agencia_usuarios = await antigo.ler('agencia_usuarios', `agencia_id=eq.${FORNO}`, 'usuario_id');
  d.squad_membros = await antigo.lerIn('squad_membros', 'squad_id', d.squads.map(s => s.id), 'squad_id,usuario_id');
  d.clientes = await antigo.ler('clientes', `agencia_id=eq.${FORNO}`);
  const idsCli = d.clientes.map(c => c.id);
  d.cliente_gestores = await antigo.lerIn('cliente_gestores', 'cliente_id', idsCli, 'cliente_id,usuario_id');
  d.destaques = await antigo.lerIn('destaques', 'cliente_id', idsCli);
  d.meses = await antigo.lerIn('meses', 'cliente_id', idsCli);
  d.posts = await antigo.lerIn('posts', 'mes_id', d.meses.map(m => m.id));
  d.aprovacoes = await antigo.lerIn('aprovacoes', 'post_id', d.posts.map(p => p.id));
  for (const [t, l] of Object.entries(d)) resumo.tabelas[t] = l.length;

  /* 2. pessoas: o login é casado pelo e-mail. Quem já tem conta no projeto novo (ex.: taskmanager) usa a mesma. */
  const idsUsados = new Set([...d.agencia_usuarios.flatMap(u => [u.usuario_id, u.criado_por]), ...d.squad_membros.map(s => s.usuario_id),
    ...d.cliente_gestores.flatMap(g => [g.usuario_id, g.criado_por]), ...d.posts.map(p => p.responsavel)].filter(Boolean));
  const emailAntigo = new Map();
  for (const id of idsUsados) { try { const u = await antigo.usuario(id); if (u?.email) emailAntigo.set(id, u.email.toLowerCase()); } catch { /* conta apagada no antigo */ } }
  const porEmailNovo = new Map((await novo.usuarios()).map(u => [String(u.email || '').toLowerCase(), u.id]));
  const membros = new Set(d.agencia_usuarios.map(u => u.usuario_id));
  const mapa = new Map();   // id antigo → id novo
  resumo.pessoas = { mesmas: 0, novas: 0, sem_conta: 0 };
  for (const [idOld, email] of emailAntigo) {
    if (porEmailNovo.has(email)) { mapa.set(idOld, porEmailNovo.get(email)); if (membros.has(idOld)) resumo.pessoas.mesmas++; continue; }
    if (!membros.has(idOld)) { resumo.pessoas.sem_conta++; continue; }   // só autor/criador: fica sem nome
    resumo.pessoas.novas++;
    if (!exec) { mapa.set(idOld, `novo:${email}`); continue; }
    const criado = await novo.criarUsuario(email);
    mapa.set(idOld, criado.id); porEmailNovo.set(email, criado.id);
    // código de primeiro acesso, igual ao que o painel gera (vale 48 h)
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await novo.gravar('convites', [{ usuario_id: criado.id, codigo_hash: sha256(`${criado.id}:${codigo}`), expira_em: new Date(Date.now() + 2 * 864e5).toISOString(), tentativas: 0, criado_por: null }]);
    resumo.codigos.push({ email, codigo });
  }
  for (const u of d.agencia_usuarios) if (!mapa.has(u.usuario_id)) resumo.avisos.push(`Pessoa ${u.usuario_id} (${u.papel}) não tem conta no projeto antigo e ficou de fora.`);
  const pessoa = id => (id && mapa.has(id) ? mapa.get(id) : null);

  /* 3. artes: tudo vira r2:<Forno>/... no R2 novo */
  const refs = new Map();   // ref antiga → ref nova
  const colher = v => { if (typeof v === 'string' && v) refs.set(v, null); };
  d.clientes.forEach(c => colher(c.avatar_url));
  d.destaques.forEach(x => colher(x.capa_url));
  d.posts.forEach(p => { colher(p.capa_url); colher(p.video_url); (Array.isArray(p.slides) ? p.slides : []).forEach(colher); });
  resumo.artes = { total: refs.size, r2: 0, storage: 0, url: 0, ja_estavam: 0, copiadas: 0, falhas: 0 };
  const mesmoR2 = semBarra(cfg.antigo.r2) === semBarra(cfg.novo.r2) && cfg.antigo.segredo === cfg.novo.segredo;
  const fila = [...refs.keys()];
  async function copiar(ref) {
    const alvo = destinoDaArte(ref, cfg.antigo.url);
    if (!alvo?.novo || (alvo.origem === 'r2' && !alvo.caminho.startsWith(`${FORNO}/`))) {
      resumo.artes.falhas++; resumo.avisos.push(`Arte que não dá para levar: ${ref}`); return;
    }
    resumo.artes[alvo.origem]++;
    refs.set(ref, `r2:${alvo.novo}`);
    if (!exec || (alvo.origem === 'r2' && mesmoR2)) return;
    try {
      let corpo, tipo;
      if (alvo.origem === 'r2') {
        const r = await fetch(linkR2(cfg.antigo.r2, cfg.antigo.segredo, 'GET', alvo.caminho));
        if (!r.ok) throw new Error(`R2 antigo respondeu ${r.status}`);
        corpo = Buffer.from(await r.arrayBuffer()); tipo = r.headers.get('content-type');
      } else if (alvo.origem === 'storage') ({ corpo, tipo } = await antigo.baixarStorage(alvo.caminho));
      else { const r = await fetch(alvo.caminho); if (!r.ok) throw new Error(`respondeu ${r.status}`); corpo = Buffer.from(await r.arrayBuffer()); tipo = r.headers.get('content-type'); }
      const ct = tipoDe(alvo.novo, tipo);
      if (!ct) throw new Error(`formato não aceito (${tipo})`);
      const put = await fetch(linkR2(cfg.novo.r2, cfg.novo.segredo, 'PUT', alvo.novo), { method: 'PUT', headers: { 'Content-Type': ct }, body: corpo });
      if (put.status === 409) { resumo.artes.ja_estavam++; return; }   // rodou antes: já está lá
      if (!put.ok) throw new Error(`R2 novo respondeu ${put.status} ${await put.text()}`);
      resumo.artes.copiadas++;
    } catch (e) {
      resumo.artes.falhas++; refs.set(ref, null); resumo.avisos.push(`Falhou ao copiar ${ref}: ${e.message}`);
    }
  }
  for (let i = 0; i < fila.length; i += 4) await Promise.all(fila.slice(i, i + 4).map(copiar));
  if (exec && resumo.artes.falhas) throw new Error(`Parei antes de gravar: ${resumo.artes.falhas} arte(s) não copiaram.\n${resumo.avisos.join('\n')}`);
  const arte = v => (typeof v === 'string' && v ? refs.get(v) : v);

  /* 4. gravar no projeto novo, na ordem que as regras do banco exigem */
  const linhas = {
    squads: d.squads,
    agencia_usuarios: d.agencia_usuarios.filter(u => pessoa(u.usuario_id)).map(u => ({ ...u, usuario_id: pessoa(u.usuario_id), criado_por: pessoa(u.criado_por) })),
    squad_membros: d.squad_membros.filter(s => pessoa(s.usuario_id) && membros.has(s.usuario_id)).map(s => ({ ...s, usuario_id: pessoa(s.usuario_id) })),
    clientes: d.clientes.map(c => ({ ...c, avatar_url: arte(c.avatar_url) })),
    cliente_gestores: d.cliente_gestores.filter(g => pessoa(g.usuario_id) && membros.has(g.usuario_id)).map(g => ({ ...g, usuario_id: pessoa(g.usuario_id), criado_por: pessoa(g.criado_por) })),
    destaques: d.destaques.map(x => ({ ...x, capa_url: arte(x.capa_url) })),
    meses: d.meses,
    posts: d.posts.map(p => ({ ...p, capa_url: arte(p.capa_url), video_url: arte(p.video_url), slides: (Array.isArray(p.slides) ? p.slides : []).map(arte),
      responsavel: membros.has(p.responsavel) ? pessoa(p.responsavel) : null })),
    aprovacoes: d.aprovacoes
  };
  const conflitos = { agencia_usuarios: 'agencia_id,usuario_id', squad_membros: 'squad_id,usuario_id', cliente_gestores: 'cliente_id,usuario_id' };
  if (exec) {
    await novo.alterar('agencias', `id=eq.${FORNO}`, { usa_squads: !!agOld.usa_squads });
    for (const [t, l] of Object.entries(linhas)) await novo.gravar(t, l, conflitos[t]);
    // a data de publicação é carimbada pelo banco ao gravar; devolve a original
    for (const m of d.meses.filter(m => m.publicado_em)) await novo.alterar('meses', `id=eq.${m.id}`, { publicado_em: m.publicado_em });
  }
  resumo.gravadas = Object.fromEntries(Object.entries(linhas).map(([t, l]) => [t, l.length]));
  return resumo;
}

/* ---------- linha de comando ---------- */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const env = k => { const v = process.env[k]; if (!v) { console.error(`Falta a variável ${k}. Veja o LEIA-ME.md.`); process.exit(1); } return v; };
  const cfg = {
    executar: process.argv.includes('--executar'),
    antigo: { url: env('ANTIGO_SUPABASE_URL'), chave: env('ANTIGO_SERVICE_KEY'), r2: env('ANTIGO_R2_BASE'), segredo: env('ANTIGO_SIGN_SECRET') },
    novo: { url: env('NOVO_SUPABASE_URL'), chave: env('NOVO_SERVICE_KEY'), r2: env('NOVO_R2_BASE'), segredo: env('NOVO_SIGN_SECRET') }
  };
  try {
    const r = await migrar(cfg);
    console.log(`\n== ${r.modo} ==`);
    console.log('Lido do projeto antigo:', r.tabelas);
    console.log('Gravado no projeto novo:', r.gravadas, r.modo === 'SIMULAÇÃO' ? '(nada foi gravado)' : '');
    console.log('Pessoas:', r.pessoas, '(mesmas = já tinham login no projeto novo, pelo e-mail)');
    console.log('Artes:', r.artes);
    if (r.avisos.length) console.log('\nAvisos:\n- ' + r.avisos.join('\n- '));
    if (r.codigos.length) {
      const arq = `codigos-primeiro-acesso-${Date.now()}.txt`;
      fs.writeFileSync(arq, r.codigos.map(c => `${c.email}\t${c.codigo}`).join('\n') + '\n', { mode: 0o600 });
      console.log(`\n${r.codigos.length} pessoa(s) ganharam login novo. Os códigos de primeiro acesso (valem 48 h) estão em ${arq}.`);
      console.log('Mande para cada pessoa: o endereço do painel, o e-mail e o código. Ela clica em "Tenho um código de primeiro acesso".');
    }
    if (r.modo === 'SIMULAÇÃO') console.log('\nTudo certo? Rode de novo com --executar.');
  } catch (e) { console.error('\nERRO:', e.message); process.exit(1); }
}
