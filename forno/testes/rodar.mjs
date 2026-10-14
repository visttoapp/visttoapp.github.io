/* Monta o pacote da Forno e roda todas as conferências. Uso: npm run forno */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const node = (arq, cwd = RAIZ) => execFileSync(process.execPath, ['--no-warnings', arq], { cwd, stdio: 'inherit' });

node('forno/montar.mjs');
node('forno/testes/suite-vistto.mjs');
node('forno/testes/equivalencia.mjs');
node('forno/testes/migracao.mjs');
// os testes que vão dentro do zip, como o Dante vai rodar
const verificar = path.join(RAIZ, 'forno/dist/vistto-forno/verificar');
const link = path.join(verificar, 'node_modules');
fs.symlinkSync(path.join(RAIZ, 'node_modules'), link);
try {
  for (const t of JSON.parse(fs.readFileSync(path.join(verificar, 'package.json'), 'utf8')).scripts.test.split('&&').map(s => s.trim().replace(/^node /, '')))
    node(t, verificar);
} finally { fs.unlinkSync(link); }
fs.copyFileSync(path.join(RAIZ, 'forno/dist/vistto-forno.zip'), path.join(RAIZ, 'forno/vistto-forno.zip'));
console.log('\nTudo certo. Pacote final: forno/vistto-forno.zip');
