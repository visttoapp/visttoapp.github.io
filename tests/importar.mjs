import fs from 'node:fs';
import assert from 'node:assert/strict';

// carrega js/importar.js num "window" de mentira
const src = fs.readFileSync(new URL('../js/importar.js', import.meta.url), 'utf8');
const window = {};
new Function('window', src)(window);
const PASTA = window.PASTA;

let checks = 0; const ok = () => checks++;
const arq = caminhos => caminhos.map(c => ({ caminho: c, nome: c.split('/').pop(), arquivo: { nome: c } }));
const resumo = p => `${p.numero}|${p.tipo}|${p.tema}|${p.arquivos.length}`;

// pasta do mês: carrosseis em subpastas, esteticos soltos
let r = PASTA.analisar(arq([
  'carrosseis/01 lancamento colecao/1.jpg',
  'carrosseis/01 lancamento colecao/2.jpg',
  'carrosseis/01 lancamento colecao/3.jpg',
  'carrosseis/04 promocao 12-10/01.jpg',
  'carrosseis/04 promocao 12-10/02.jpg',
  'esteticos/03 dica da semana.jpg',
  'esteticos/05_frase_do_dia.png'
]));
assert.equal(r.posts.length, 4); ok();
assert.equal(r.posts.map(resumo).join('\n'), [
  '01|carousel|Lancamento colecao|3',
  '03|image|Dica da semana|1',
  '04|carousel|Promocao 12 10|2',
  '05|image|Frase do dia|1'
].join('\n')); ok();
// ordem das lâminas segue o nome, com 2 antes de 10
r = PASTA.analisar(arq(['carrosseis/01 tema/1.jpg', 'carrosseis/01 tema/10.jpg', 'carrosseis/01 tema/2.jpg']));
assert.equal(r.posts[0].arquivos.map(a => a.nome).join(), '1.jpg,2.jpg,10.jpg'); ok();
assert.equal(r.posts[0].tipo, 'carousel'); ok();

// reel com capa, dentro de pasta e solto
r = PASTA.analisar(arq(['reels/02 bastidores.mp4', 'reels/02 bastidores.jpg', 'esteticos/06 oferta.jpg']));
assert.equal(r.posts[0].tipo, 'reel'); ok();
assert.equal(r.posts[0].arquivos.map(a => a.nome).join(), '02 bastidores.mp4,02 bastidores.jpg'); ok();
assert.equal(r.posts.length, 2); ok();
r = PASTA.analisar(arq(['07 reel novo/video.mp4', '07 reel novo/capa.jpg']));
assert.equal(resumo(r.posts[0]), '07|reel|Reel novo|2'); ok();
r = PASTA.analisar(arq(['reels/08 sem capa.mp4']));
assert.deepEqual(r.posts[0].avisos, ['reel sem capa']); ok();
assert.equal(r.posts[0].arquivos.length, 1); ok();
// mp4 com capa por número
r = PASTA.analisar(arq(['09 making of.mp4', '09 capa.jpg']));
assert.equal(r.posts.length, 1); ok();
assert.equal(r.posts[0].tipo, 'reel'); ok();

// arquivos na raiz do mês, sem pasta de categoria
r = PASTA.analisar(arq(['01 abertura.jpg', '02 meio.jpg']));
assert.equal(r.posts.map(p => p.tipo).join(), 'image,image'); ok();

// sem número: entra no fim, com aviso, e ganha número pela ordem
r = PASTA.analisar(arq(['esteticos/02 com numero.jpg', 'esteticos/sem numero.jpg']));
assert.equal(r.posts.map(p => p.numero).join(), '02,01'); ok();
assert.deepEqual(r.posts[1].avisos, ['número deduzido da ordem']); ok();
assert.equal(r.posts[1].tema, 'Sem numero'); ok();
// data nunca vem preenchida: quem escreve é o Head, na revisão
assert.ok(r.posts.every(p => p.data === null)); ok();

// pasta de brutos, arquivo oculto e formato não aceito ficam de fora
r = PASTA.analisar(arq([
  'carrosseis/01 tema/1.jpg', 'carrosseis/01 tema/arte.psd',
  'brutos/raw.jpg', 'psd/01 tema.psd', '.DS_Store', 'esteticos/.thumb.jpg'
]));
assert.equal(r.posts.length, 1); ok();
assert.equal(r.posts[0].arquivos.length, 1); ok();
assert.equal(r.ignorados.length, 5); ok();
assert.ok(r.ignorados.some(x => x.motivo.includes('brutos'))); ok();
assert.ok(r.ignorados.some(x => x.motivo === 'formato não aceito')); ok();
assert.ok(r.ignorados.some(x => x.motivo === 'arquivo oculto')); ok();

// nomes de categoria aceitos com e sem acento
for (const cat of ['carrosseis', 'carrossel', 'esteticos', 'estáticos', 'únicos', 'feed', 'artes', 'reels', 'vídeos', 'stories']) {
  const s = PASTA.analisar(arq([`${cat}/01 tema.jpg`]));
  assert.equal(s.posts.length, 1, cat); ok();
  assert.equal(s.posts[0].tipo, 'image', cat); ok();
}

// caminho com ano e mês antes das categorias
r = PASTA.analisar(arq(['2026/09/carrosseis/01 tema/1.jpg', '2026/09/carrosseis/01 tema/2.jpg', '2026/09/esteticos/02 outro.jpg']));
assert.equal(r.posts.length, 2); ok();
assert.equal(r.posts[0].arquivos.length, 2); ok();

// número com ponto ou traço; o resto do nome vira tema e a data fica vazia
r = PASTA.analisar(arq(['esteticos/1. promo 02.10.jpg', 'esteticos/2 - aviso.jpg', 'esteticos/03.jpg']));
assert.equal(r.posts.map(p => `${p.numero}|${p.tema}|${p.data}`).join(' / '), '01|Promo 02.10|null / 02|Aviso|null / 03||null'); ok();

// mais de 20 lâminas avisa
r = PASTA.analisar(arq(Array.from({ length: 21 }, (_, i) => `carrosseis/01 tema/${i + 1}.jpg`)));
assert.deepEqual(r.posts[0].avisos, ['mais de 20 lâminas']); ok();

// pasta vazia de mídia
r = PASTA.analisar(arq(['carrosseis/01 tema/leia.txt']));
assert.equal(r.posts.length, 0); ok();
assert.equal(r.ignorados.length, 1); ok();

console.log('PASS:', checks, 'checks do leitor de pasta: carrosséis, estéticos, reels, ordem, número e descartes.');
