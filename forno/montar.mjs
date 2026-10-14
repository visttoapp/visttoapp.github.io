/* Vistto · Forno — monta forno/dist/vistto-forno/ e forno/dist/vistto-forno.zip a partir do código atual.
   Uso: node forno/montar.mjs   (depois: node forno/testes/rodar.mjs para conferir tudo) */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as T from './transformar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AQUI = path.join(RAIZ, 'forno');
const DIST = path.join(AQUI, 'dist');
const PACOTE = path.join(DIST, 'vistto-forno');
// projeto do taskmanager da Forno (forno-task). A chave publicável é pública: é a mesma que vai para o navegador.
const SUPABASE = { url: 'https://pbmyudlawyyqfpnswgqt.supabase.co', chave: 'sb_publishable_GOHvyublV0oaiGqRqlrrvA_t_kKjLsL' };

const ler = p => fs.readFileSync(path.join(RAIZ, p), 'utf8');
function gravar(destino, conteudo) {
  const alvo = path.join(PACOTE, destino);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo);
}
function copiar(origem, destino) {
  const alvo = path.join(PACOTE, destino);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, origem), alvo);
}
// copia uma pasta de arquivos escritos à mão (forno/pacote/...) para o pacote
function copiarPasta(origem, destino) {
  for (const nome of fs.readdirSync(origem, { withFileTypes: true })) {
    const o = path.join(origem, nome.name), d = path.join(destino, nome.name);
    if (nome.isDirectory()) copiarPasta(o, d);
    else { fs.mkdirSync(path.dirname(path.join(PACOTE, d)), { recursive: true }); fs.copyFileSync(o, path.join(PACOTE, d)); }
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(PACOTE, { recursive: true });

/* 1 · Supabase */
gravar('1-supabase/01-instalar-vistto.sql', T.montarSchema(ler('supabase/schema.sql')));
gravar('1-supabase/config.toml', T.CONFIG_TOML);
for (const f of T.FUNCOES) gravar(`1-supabase/functions/${T.nomeFuncao(f)}/index.ts`, T.montarFuncao(f, ler(`supabase/functions/${f}/index.ts`)));

/* 2 · GitHub (site estático) */
const SITE = ['index.html', 'c.html', 'cliente.html', '.nojekyll', 'css/style.css', 'css/agencies.css',
  'js/admin.js', 'js/app.js', 'js/brand.js', 'js/client-api.js', 'js/config.js', 'js/importar.js', 'js/link.js',
  'js/media.js', 'js/painel.js', 'js/ui.js', 'js/vendor/jszip.min.js', 'js/vendor/jszip-LICENSE.md', 'assets/vistto.svg'];
for (const arq of SITE) {
  const binario = !/\.(html|css|js|md|svg)$/.test(arq);
  if (binario) { copiar(arq, `2-github/site/${arq}`); continue; }
  gravar(`2-github/site/${arq}`, T.montarSite(arq, ler(arq), SUPABASE));
}
copiar('assets/marcas/m2/marca.svg', '2-github/site/assets/marcas/forno/marca.svg');
// nada da outra agência pode ir junto
for (const arq of SITE) {
  const p = path.join(PACOTE, '2-github/site', arq);
  const t = fs.readFileSync(p, 'utf8');
  for (const proibido of [T.OUTRA, 'marcas/m1', 'classico', 'vbiebfcbzproffkrkluy', 'felipelabmor'])
    if (t.includes(proibido) && !arq.endsWith('jszip.min.js')) throw new Error(`site ${arq}: contém ${proibido}`);
}

/* 3 · Cloudflare R2 (Worker) */
gravar('3-cloudflare-r2/worker/index.js', T.montarWorker(ler('worker/index.js')));
gravar('3-cloudflare-r2/wrangler.jsonc', T.WRANGLER);

/* verificar: testes que o Dante roda sem nada de verdade (cd verificar && npm install && npm test) */
const testePacote = (origem, destino, trocas) => {
  let t = ler(origem);
  for (const [de, para] of trocas) t = T.trocar(t, de, para, 1, origem);
  gravar(`verificar/${destino}`, t);
};
testePacote('tests/worker.mjs', 'worker.mjs', [["'../worker/index.js'", "'../3-cloudflare-r2/worker/index.js'"], ['SIGN_SECRET: SEGREDO,', "SIGN_SECRET: SEGREDO, ORIGENS: 'https://visttoapp.github.io',"]]);
testePacote('tests/functions.mjs', 'funcoes.mjs', [['`../supabase/functions/${name}/index.ts`', '`../1-supabase/functions/vistto-${name}/index.ts`']]);
testePacote('tests/painel.mjs', 'painel.mjs', [["'../js/painel.js'", "'../2-github/site/js/painel.js'"]]);
testePacote('tests/importar.mjs', 'importar.mjs', [["'../js/importar.js'", "'../2-github/site/js/importar.js'"]]);
gravar('verificar/package.json', JSON.stringify({
  name: 'vistto-forno-verificar', private: true, type: 'module',
  scripts: { test: 'node instalacao.mjs && node worker.mjs && node funcoes.mjs && node painel.mjs && node importar.mjs' },
  devDependencies: { '@electric-sql/pglite': JSON.parse(ler('package.json')).devDependencies['@electric-sql/pglite'] }
}, null, 2) + '\n');

/* textos, migração e verificação escritos à mão */
copiarPasta(path.join(AQUI, 'pacote'), '');

/* zip */
const zip = path.join(DIST, 'vistto-forno.zip');
execFileSync('zip', ['-r', '-X', '-q', zip, 'vistto-forno', '-x', '*/node_modules/*'], { cwd: DIST });
const lista = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').filter(l => !l.endsWith('/'));
console.log(`OK: ${lista.length} arquivos em ${path.relative(RAIZ, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`);
