/* Roda a suíte original do Vistto (tests/*.mjs) contra a versão transformada:
   SQL no schema "vistto", funções vistto-*, Worker com ORIGENS por variável e o JS do site do pacote.
   Os testes de banco continuam usando as duas agências de propósito: aqui se confere que a mudança de schema
   não abriu nenhuma fechadura. O "só a Forno" é conferido em instalacao.mjs. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as T from '../transformar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACOTE = path.join(RAIZ, 'forno/dist/vistto-forno');
if (!fs.existsSync(PACOTE)) throw new Error('Rode antes: node forno/montar.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vistto-suite-'));
const gravar = (p, t) => { fs.mkdirSync(path.dirname(path.join(TMP, p)), { recursive: true }); fs.writeFileSync(path.join(TMP, p), t); };
const ler = p => fs.readFileSync(path.join(RAIZ, p), 'utf8');

// SQL de montagem dos testes, no schema vistto
for (const f of fs.readdirSync(path.join(RAIZ, 'supabase/historico'))) gravar(`supabase/historico/${f}`, T.sqlParaSchema(ler(`supabase/historico/${f}`), f));
gravar('tests/fixtures/schema-v1.sql', T.sqlParaSchema(ler('tests/fixtures/schema-v1.sql'), 'schema-v1'));
// funções, Worker e JS: os do pacote
for (const f of T.FUNCOES) gravar(`supabase/functions/${f}/index.ts`, fs.readFileSync(path.join(PACOTE, `1-supabase/functions/${T.nomeFuncao(f)}/index.ts`), 'utf8'));
gravar('worker/index.js', fs.readFileSync(path.join(PACOTE, '3-cloudflare-r2/worker/index.js'), 'utf8'));
for (const f of ['link.js', 'painel.js', 'importar.js']) gravar(`js/${f}`, fs.readFileSync(path.join(PACOTE, `2-github/site/js/${f}`), 'utf8'));
gravar('package.json', JSON.stringify({ type: 'module' }));
fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(TMP, 'node_modules'));

const testes = ['access', 'hierarquia', 'squads', 'gestores', 'importar', 'painel', 'pauta', 'link', 'espaco', 'worker', 'r2', 'anuncios', 'functions'];
for (const t of testes) {
  let s = ler(`tests/${t}.mjs`);
  if (s.includes('create schema auth;')) {
    // banco de mentira com o schema vistto na frente do caminho, como o PostgREST faz com Accept-Profile: vistto
    s = T.trocar(s, 'create schema auth;', 'create schema vistto;grant usage on schema vistto to anon,authenticated,service_role;set search_path to vistto,public;create schema auth;', 1, t);
    s = s.replace(/\bpublic\.(?!gen_random_bytes)(?=[a-z_])/g, 'vistto.');
  }
  if (t === 'worker') s = T.trocar(s, 'SIGN_SECRET: SEGREDO,', `SIGN_SECRET: SEGREDO, ORIGENS: 'https://visttoapp.github.io',`, 1, t);
  gravar(`tests/${t}.mjs`, s);
}
fs.copyFileSync(path.join(RAIZ, 'tests/fixtures/schema-v1.sql'), path.join(TMP, 'tests/fixtures/original.sql'));

let falhas = 0;
for (const t of testes) {
  try {
    const out = execFileSync(process.execPath, ['--no-warnings', `tests/${t}.mjs`], { cwd: TMP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(`[vistto] ${out.trim().split('\n').pop()}\n`);
  } catch (e) { falhas++; console.error(`[vistto] FALHOU ${t}: ` + (e.stderr || e.stdout || e.message).toString().split("\n").filter(l => /^(error|Error|AssertionError)|message:|  (actual|expected|where):/.test(l.trim()) || /^\s*(error|message|where)/i.test(l)).slice(0, 12).join("\n")); }
}
fs.rmSync(TMP, { recursive: true, force: true });
if (falhas) { console.error(`${falhas} teste(s) falharam`); process.exit(1); }
console.log(`PASS: suíte original inteira (${testes.length} arquivos) no schema vistto, com funções, Worker e JS do pacote.`);
