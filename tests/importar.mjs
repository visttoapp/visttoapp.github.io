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

// ---------- roteiro.txt ----------
const texto = `Linha editorial de outubro

# 01
data: 06/10
tema: Lançamento da coleção
título: Chegou a <em>coleção</em>
legenda:
Primeira linha da legenda.

Segunda linha, com data: no meio e #hashtag

## Post 2
dia: 08/10
legenda: Legenda curta na mesma linha

# 03
Só o texto, sem campos.

# 09
tema: Sem arte
legenda: sobra
`;
let blocos = PASTA.lerRoteiro(texto);
assert.deepEqual([...blocos.keys()], ['01', '02', '03', '09']); ok();
assert.equal(blocos.get('01').titulo, 'Chegou a <em>coleção</em>'); ok();
assert.equal(blocos.get('01').legenda, 'Primeira linha da legenda.\n\nSegunda linha, com data: no meio e #hashtag'); ok();
assert.equal(blocos.get('02').data, '08/10'); ok();
assert.equal(blocos.get('02').legenda, 'Legenda curta na mesma linha'); ok();
assert.equal(blocos.get('03').legenda, 'Só o texto, sem campos.'); ok();

// o roteiro não vira post nem "formato não aceito", e casa pelo número
const pasta = arq(['Cliente/10/roteiro.txt', 'Cliente/10/carrosseis/01 lancamento/1@2x.png', 'Cliente/10/carrosseis/01 lancamento/2@2x.png',
  'Cliente/10/esteticos/2 aviso@2x.png', 'Cliente/10/esteticos/03 frase.png', 'Cliente/10/esteticos/04 extra.png']);
r = PASTA.analisar(pasta);
assert.equal(r.ignorados.length, 0); ok();
assert.equal(PASTA.acharRoteiro(pasta).caminho, 'Cliente/10/roteiro.txt'); ok();
assert.equal(r.posts[1].tema, 'Aviso'); ok(); // sem o @2x
let sobra = PASTA.aplicarRoteiro(r.posts, blocos);
assert.deepEqual(sobra, ['09']); ok();
assert.equal(r.posts.map(p => `${p.numero}|${p.data}|${p.tema}`).join(' / '), '01|06/10|Lançamento da coleção / 02|08/10|Aviso / 03|null|Frase / 04|null|Extra'); ok();
assert.deepEqual(r.posts[3].avisos, ['sem texto no roteiro']); ok();
// legenda longa, data longa e bloco sem legenda avisam
blocos = PASTA.lerRoteiro(`# 01\ndata: segunda-feira, 06 de outubro\nlegenda:\n${'a'.repeat(2300)}\n# 02\ntema: so tema`);
r = PASTA.analisar(arq(['01.png', '02.png']));
PASTA.aplicarRoteiro(r.posts, blocos);
assert.equal(r.posts[0].data, null); ok();
assert.ok(r.posts[0].avisos.some(a => a.startsWith('data longa'))); ok();
assert.ok(r.posts[0].avisos.some(a => a.startsWith('legenda com 2300'))); ok();
assert.deepEqual(r.posts[1].avisos, ['roteiro sem legenda']); ok();
// hashtag que começa com número, no começo da linha, continua na legenda
blocos = PASTA.lerRoteiro('# 12\nlegenda:\nTexto.\n#32anos #primeplus\n#2026');
assert.deepEqual([...blocos.keys()], ['12']); ok();
assert.equal(blocos.get('12').legenda, 'Texto.\n#32anos #primeplus\n#2026'); ok();
// nomes aceitos para o roteiro; dentro de pasta de trabalho não conta
assert.ok(PASTA.acharRoteiro(arq(['x/Legendas.txt']))); ok();
assert.ok(PASTA.acharRoteiro(arq(['x/linha-editorial.md']))); ok();
assert.equal(PASTA.acharRoteiro(arq(['x/briefing/roteiro.txt'])), null); ok();

// ---------- subir ajustes ----------
const post = (numero, tipo, n) => ({ numero, tipo, slides: tipo === 'reel' || tipo === 'texto' ? [] : Array.from({ length: n }, (_, i) => `r2:a/${numero}-${i + 1}.jpg`), capa_url: tipo === 'reel' ? 'r2:a/capa.jpg' : null });
const numeros = ['01', '02', '03', '05', '7'];
const ajustar = caminhos => PASTA.analisar(PASTA.prepararAjustes(arq(caminhos), numeros)).posts;
const refs = n => Array.from({ length: n }, (_, i) => `novo${i + 1}`);

// exportação do Figma: frames "03/1", "03/3" viram a pasta 03; "05" vira arte solta. A pasta escolhida não vira post.
let g = ajustar(['GBEX ajustes/03/1.png', 'GBEX ajustes/03/3@2x.png', 'GBEX ajustes/05.png']);
assert.equal(g.map(x => `${x.numero}|${x.arquivos.length}`).join(' '), '03|2 05|1'); ok();
// a pasta escolhida é o próprio post
g = ajustar(['03/1.png', '03/2.png']);
assert.equal(g.length, 1); ok();
assert.equal(g[0].numero, '03'); ok();
// número com ou sem zero à esquerda
assert.ok(PASTA.mesmoNumero('7', '07')); ok();
assert.ok(!PASTA.mesmoNumero('', '')); ok();
// lâmina: último número do nome, sem o @2x
assert.equal(PASTA.laminaDe('3@2x.png'), 3); ok();
assert.equal(PASTA.laminaDe('lamina 12.jpg'), 12); ok();
assert.equal(PASTA.laminaDe('capa.jpg'), null); ok();

// carrossel de 5, vieram as lâminas 1 e 3: troca só elas, na posição certa
g = ajustar(['x/03/1.png', 'x/03/3@2x.png']);
let plano = PASTA.planejarAjuste(g[0], post('03', 'carousel', 5));
assert.equal(plano.modo, 'laminas'); ok();
assert.equal(plano.texto, 'troca as lâminas 1 e 3 (as outras 3 continuam)'); ok();
assert.deepEqual(plano.montar(refs(2)).slides, ['novo1', 'r2:a/03-2.jpg', 'novo2', 'r2:a/03-4.jpg', 'r2:a/03-5.jpg']); ok();
// a pessoa escolhe substituir o carrossel inteiro
plano = PASTA.planejarAjuste(g[0], post('03', 'carousel', 5), 'tudo');
assert.deepEqual(plano.montar(refs(2)), { slides: ['novo1', 'novo2'], tipo: 'carousel' }); ok();
assert.deepEqual(plano.avisos, ['o carrossel passa de 5 para 2 lâminas']); ok();
// lâmina que não existe
g = ajustar(['x/03/7.png']);
plano = PASTA.planejarAjuste(g[0], post('03', 'carousel', 5));
assert.equal(plano.ok, false); ok();
assert.match(plano.erro, /não existe a lâmina 7/); ok();
// todas as lâminas de novo: substitui o conjunto
g = ajustar(['x/03/1.png', 'x/03/2.png', 'x/03/3.png']);
plano = PASTA.planejarAjuste(g[0], post('03', 'carousel', 3));
assert.equal(plano.modo, 'tudo'); ok();
assert.equal(plano.texto, 'substitui as 3 lâminas por 3 lâminas novas'); ok();
assert.deepEqual(plano.avisos, []); ok();
// arte única
g = ajustar(['x/05.png']);
plano = PASTA.planejarAjuste(g[0], post('05', 'image', 1));
assert.equal(plano.texto, 'troca a arte'); ok();
assert.deepEqual(plano.montar(['n']), { slides: ['n'], tipo: 'image' }); ok();
// arte solta num carrossel: troca a lâmina 1, não apaga as outras
plano = PASTA.planejarAjuste(g[0], post('05', 'carousel', 4));
assert.deepEqual(plano.montar(['n']).slides, ['n', 'r2:a/05-2.jpg', 'r2:a/05-3.jpg', 'r2:a/05-4.jpg']); ok();
// reel: imagem troca só a capa; vídeo troca o vídeo e mantém a capa
plano = PASTA.planejarAjuste(g[0], post('05', 'reel'));
assert.deepEqual(plano.montar(['n']), { capa_url: 'n' }); ok();
g = ajustar(['x/07 reel.mp4']);
plano = PASTA.planejarAjuste(g[0], post('7', 'reel'));
assert.deepEqual(plano.montar(['v']), { video_url: 'v' }); ok();
// vídeo em post que não é reel, anúncio de texto e post não escolhido são recusados
assert.equal(PASTA.planejarAjuste(g[0], post('7', 'image', 1)).ok, false); ok();
assert.equal(PASTA.planejarAjuste(ajustar(['x/05.png'])[0], post('05', 'texto')).ok, false); ok();
assert.equal(PASTA.planejarAjuste(g[0], null).ok, false); ok();

console.log('PASS:', checks, 'checks do leitor de pasta: carrosséis, estéticos, reels, ordem, número, descartes e ajustes.');
