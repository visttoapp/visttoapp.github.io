/* Vistto · lê uma pasta do mês e monta os posts.
   Espera caminhos relativos, como "carrosseis/01 tema/1.jpg" ou "esteticos/03 tema.jpg".
   Pasta com vários arquivos = um carrossel. Arquivo solto = um post. .mp4 = reel.
   Do nome saem só o número e a ordem. Data, título e legenda vêm do roteiro.txt, se a pasta tiver um;
   sem ele, ficam vazios para preencher na mão.
   Não faz upload nem toca no banco: só interpreta os nomes e o texto. */
window.PASTA = (() => {
  const CATEGORIA = /^(carross?[ei]is?|carrossel|carroseis|est[ae]ticos?|est[áa]ticos?|estetico|[uú]nicos?|singles?|posts?|feed|artes?|finais?|final|entregas?|aprova[cç][ãa]o|aprovacao|reels?|v[íi]deos?|videos?|stories|story)$/;
  const IGNORAR = /^(brutos?|raw|psd|psds?|ai|editaveis?|edit[áa]veis?|fontes?|refer[êe]ncias?|refs?|backup|antigos?|old|logos?|briefing|__macosx)$/;
  const IMAGEM = /\.(jpe?g|png|webp|gif)$/i;
  const VIDEO = /\.mp4$/i;
  const CAPA = /(capa|thumb|cover)/;
  const ROTEIRO = /^(roteiro|legendas?|linha[ _-]?editorial|textos?)\.(txt|md)$/;

  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chave = s => semAcento(s).toLowerCase().trim();
  // sem a extensão e sem o "@2x" que o Figma acrescenta na exportação
  const base = nome => nome.replace(/\.[^.]+$/, '').replace(/@\d+(\.\d+)?x$/i, '');
  const natural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });

  function numeroDe(nome) {
    const m = chave(nome).match(/^(\d{1,3})(?!\d)\s*[-_.)º°]*\s*/);
    return m ? { numero: String(+m[1]).padStart(2, '0'), resto: nome.slice(m[0].length) } : { numero: null, resto: nome };
  }
  function tituloDe(texto) {
    const limpo = String(texto || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return limpo ? limpo.charAt(0).toUpperCase() + limpo.slice(1) : '';
  }

  function analisar(arquivos) {
    const ignorados = [];
    const uteis = [];
    for (const a of arquivos) {
      const partes = String(a.caminho || a.nome).split('/').filter(Boolean);
      const nome = partes.pop();
      if (nome.startsWith('.')) { ignorados.push({ caminho: a.caminho, motivo: 'arquivo oculto' }); continue; }
      if (ROTEIRO.test(chave(nome))) continue; // o roteiro é lido à parte, por lerRoteiro
      const barrada = partes.find(p => IGNORAR.test(chave(p)) || p.startsWith('.'));
      if (barrada) { ignorados.push({ caminho: a.caminho, motivo: `pasta "${barrada}"` }); continue; }
      const video = VIDEO.test(nome), imagem = IMAGEM.test(nome);
      if (!video && !imagem) { ignorados.push({ caminho: a.caminho, motivo: 'formato não aceito' }); continue; }
      uteis.push({ arquivo: a.arquivo, caminho: a.caminho, nome, pastas: partes, video, imagem });
    }

    // Uma pasta que não é categoria (carrosseis, esteticos…) vira um post.
    const grupos = new Map();
    const soltos = [];
    for (const f of uteis) {
      const pai = f.pastas[f.pastas.length - 1] || '';
      if (pai && !CATEGORIA.test(chave(pai))) {
        const id = f.pastas.join('/');
        if (!grupos.has(id)) grupos.set(id, { nome: pai, caminho: id, itens: [] });
        grupos.get(id).itens.push(f);
      } else soltos.push(f);
    }

    const posts = [];
    for (const g of [...grupos.values()]) {
      g.itens.sort((a, b) => natural(a.nome, b.nome));
      posts.push(montar(g.nome, g.itens, g.caminho));
    }
    // Arquivos soltos: o .mp4 puxa a capa de mesmo número ou com "capa" no nome.
    const usados = new Set();
    for (const f of soltos.filter(x => x.video)) {
      const irmaos = soltos.filter(x => x.imagem && x.pastas.join('/') === f.pastas.join('/') && !usados.has(x));
      const nb = numeroDe(base(f.nome));
      const capa = irmaos.find(x => chave(base(x.nome)) === chave(base(f.nome)))
        || irmaos.find(x => CAPA.test(chave(x.nome)) && (!nb.numero || numeroDe(base(x.nome)).numero === nb.numero))
        || irmaos.find(x => nb.numero && numeroDe(base(x.nome)).numero === nb.numero && CAPA.test(chave(x.nome)));
      if (capa) usados.add(capa);
      posts.push(montar(base(f.nome), capa ? [f, capa] : [f], f.caminho));
    }
    for (const f of soltos.filter(x => x.imagem && !usados.has(x))) posts.push(montar(base(f.nome), [f], f.caminho));

    posts.sort((a, b) => {
      const na = a.numero ? +a.numero : 999, nb = b.numero ? +b.numero : 999;
      return na - nb || natural(a.origem, b.origem);
    });
    const usadosNum = new Set(posts.map(p => p.numero).filter(Boolean));
    let proximo = 1;
    posts.forEach((p, i) => {
      p.ordem = i;
      if (p.numero) return;
      while (usadosNum.has(String(proximo).padStart(2, '0'))) proximo++;
      p.numero = String(proximo).padStart(2, '0');
      usadosNum.add(p.numero);
      p.avisos.push('número deduzido da ordem');
    });
    return { posts, ignorados };
  }

  function montar(nomeBruto, itens, origem) {
    const n = numeroDe(nomeBruto);
    const video = itens.find(x => x.video);
    const imagens = itens.filter(x => x.imagem);
    const avisos = [];
    let tipo, arquivos;
    if (video) {
      tipo = 'reel';
      const capa = imagens.find(x => CAPA.test(chave(x.nome))) || imagens[0];
      arquivos = capa ? [video, capa] : [video];
      if (!capa) avisos.push('reel sem capa');
      if (imagens.length > 1) avisos.push('mais de uma imagem: usei só a capa');
    } else {
      arquivos = imagens;
      tipo = imagens.length > 1 ? 'carousel' : 'image';
      if (imagens.length > 20) avisos.push('mais de 20 lâminas');
    }
    return {
      numero: n.numero, data: null, tema: tituloDe(n.resto), titulo: '', legenda: '', tipo,
      arquivos, origem: origem || nomeBruto, avisos
    };
  }

  /* ---------- roteiro.txt: data, tema, título e legenda de cada post, pelo número ----------
     # 01
     data: 06/10
     tema: Lançamento
     titulo: Chegou a <em>coleção</em>
     legenda:
     Texto da legenda, quantas linhas precisar, até o próximo "# 02". */
  const CAMPOS = { data: 'data', dia: 'data', tema: 'tema', titulo: 'titulo', legenda: 'legenda' };
  const LIMITE_LEGENDA = 2200; // o Instagram corta acima disso
  const LIMITE_DATA = 16;      // posts_data_curta, no banco

  // Entre os arquivos da pasta, o roteiro (o mais perto da raiz, se houver mais de um).
  function acharRoteiro(arquivos) {
    return arquivos
      .map(a => ({ a, partes: String(a.caminho || a.nome).split('/').filter(Boolean) }))
      .filter(x => ROTEIRO.test(chave(x.partes[x.partes.length - 1])) && !x.partes.slice(0, -1).some(p => IGNORAR.test(chave(p))))
      .sort((x, y) => x.partes.length - y.partes.length)
      .map(x => x.a)[0] || null;
  }

  function lerRoteiro(texto) {
    const blocos = new Map();
    let atual = null, campo = null;
    for (const linha of String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      // "# 01" abre um post; "#32anos" no começo da linha é hashtag e fica na legenda
      const cab = linha.match(/^\s*#+\s*(?:post\s*)?(\d{1,3})(?![\d\p{L}_])/iu);
      if (cab) {
        const numero = String(+cab[1]).padStart(2, '0');
        atual = { numero, data: '', tema: '', titulo: '', legenda: [] };
        blocos.set(numero, atual); campo = null; continue;
      }
      if (!atual) continue;
      const kv = campo !== 'legenda' && linha.match(/^\s*([A-Za-zÀ-ÿ]+)\s*:\s*(.*)$/);
      const k = kv && CAMPOS[chave(kv[1])];
      if (k === 'legenda') { campo = 'legenda'; if (kv[2].trim()) atual.legenda.push(kv[2]); continue; }
      if (k) { atual[k] = kv[2].trim(); continue; }
      if (campo === 'legenda' || linha.trim()) { campo = 'legenda'; atual.legenda.push(linha); }
    }
    for (const b of blocos.values()) b.legenda = b.legenda.join('\n').trim();
    return blocos;
  }

  // Preenche os posts com o roteiro. Devolve os números do roteiro que não têm arte.
  function aplicarRoteiro(posts, blocos) {
    const usados = new Set();
    for (const p of posts) {
      const b = [...blocos.values()].find(x => mesmoNumero(x.numero, p.numero));
      if (!b) { p.avisos.push('sem texto no roteiro'); continue; }
      usados.add(b.numero);
      if (b.tema) p.tema = b.tema;
      if (b.titulo) p.titulo = b.titulo;
      p.legenda = b.legenda;
      if (b.data.length > LIMITE_DATA) p.avisos.push(`data longa demais (até ${LIMITE_DATA} caracteres)`);
      else if (b.data) p.data = b.data;
      if (!b.legenda) p.avisos.push('roteiro sem legenda');
      if (b.legenda.length > LIMITE_LEGENDA) p.avisos.push(`legenda com ${b.legenda.length} caracteres (o Instagram corta em ${LIMITE_LEGENDA})`);
    }
    return [...blocos.keys()].filter(n => !usados.has(n));
  }

  /* ---------- subir ajustes: casar a pasta de artes corrigidas com os posts que já existem ---------- */
  const mesmoNumero = (a, b) => {
    const k = v => { const t = String(v == null ? '' : v).trim(); return /^\d+$/.test(t) ? String(+t) : chave(t); };
    return k(a) !== '' && k(a) === k(b);
  };
  // O navegador põe a pasta escolhida no começo de cada caminho. Arte solta nela é um post solto,
  // não um carrossel com o nome da pasta, a não ser que a própria pasta seja um post ("03").
  function prepararAjustes(arquivos, numeros) {
    const partes = arquivos.map(a => String(a.caminho || a.nome).split('/').filter(Boolean));
    const raiz = partes[0] && partes[0].length > 1 ? partes[0][0] : '';
    const n = numeroDe(raiz).numero;
    if (n && partes.every(p => p.length === 2) && numeros.some(x => mesmoNumero(x, n))) return arquivos;
    return arquivos.map((a, i) => partes[i].length === 2 ? { ...a, caminho: partes[i][1] } : a);
  }
  // Número da lâmina: o último número do nome, ignorando o "@2x" que o Figma acrescenta.
  function laminaDe(nome) {
    const m = base(nome).replace(/@\d+(\.\d+)?x$/i, '').match(/(\d+)(?!.*\d)/);
    return m ? +m[1] : null;
  }
  const juntar = ns => ns.length < 2 ? String(ns[0]) : ns.slice(0, -1).join(', ') + ' e ' + ns[ns.length - 1];

  // O que acontece com o post se estas artes entrarem. modo: 'laminas' troca só as lâminas com
  // aquele número; 'tudo' substitui o conjunto inteiro. Sem modo, escolhe o mais seguro.
  // montar(refs) recebe as referências já enviadas, na ordem de envios, e devolve o que gravar.
  function planejarAjuste(grupo, post, modo) {
    const erro = t => ({ ok: false, erro: t, avisos: [] });
    if (!post) return erro('escolha o post que recebe estas artes');
    const video = grupo.arquivos.find(a => a.video), imagens = grupo.arquivos.filter(a => a.imagem);
    if (post.tipo === 'texto') return erro('anúncio só de texto não tem arte');
    if (video && post.tipo !== 'reel') return erro('tem vídeo, mas o post não é reel');
    if (post.tipo === 'reel') {
      const avisos = imagens.length > 1 ? ['mais de uma imagem: usei só a primeira como capa'] : [];
      if (video) return { ok: true, modo: 'reel', avisos, texto: imagens.length ? 'troca o vídeo e a capa' : 'troca o vídeo (a capa continua)',
        envios: [video, ...imagens.slice(0, 1)], montar: r => (imagens.length ? { video_url: r[0], capa_url: r[1] } : { video_url: r[0] }) };
      return { ok: true, modo: 'reel', avisos, texto: 'troca a capa do vídeo', envios: imagens.slice(0, 1), montar: r => ({ capa_url: r[0] }) };
    }
    const atuais = (post.slides || []).length;
    const solta = grupo.arquivos.length === 1 && grupo.arquivos[0].caminho === grupo.origem;
    const indices = solta ? [1] : imagens.map(a => laminaDe(a.nome));
    const podeLaminas = atuais > 1 && imagens.length < atuais && indices.every(Boolean) && new Set(indices).size === indices.length;
    const m = modo || (podeLaminas ? 'laminas' : 'tudo');
    if (m === 'laminas') {
      if (!podeLaminas) return { ...erro('para trocar só algumas lâminas, cada arquivo precisa do número da lâmina no nome'), podeLaminas };
      const fora = indices.filter(n => n > atuais);
      if (fora.length) return { ...erro(`o post tem ${atuais} lâminas; não existe a lâmina ${juntar(fora)}`), podeLaminas };
      const ordem = [...indices].sort((a, b) => a - b), resto = atuais - indices.length;
      return { ok: true, modo: 'laminas', podeLaminas, avisos: [],
        texto: `troca ${ordem.length > 1 ? 'as lâminas' : 'a lâmina'} ${juntar(ordem)} (${resto > 1 ? `as outras ${resto} continuam` : 'a outra continua'})`,
        envios: imagens, montar: r => { const s = [...post.slides]; indices.forEach((n, i) => { s[n - 1] = r[i]; }); return { slides: s }; } };
    }
    const avisos = atuais > 1 && imagens.length !== atuais ? [`o carrossel passa de ${atuais} para ${imagens.length} lâmina${imagens.length > 1 ? 's' : ''}`]
      : atuais <= 1 && imagens.length > 1 ? [`vira carrossel de ${imagens.length} lâminas`] : [];
    return { ok: true, modo: 'tudo', podeLaminas, avisos,
      texto: atuais <= 1 && imagens.length === 1 ? 'troca a arte' : `substitui ${atuais > 1 ? `as ${atuais} lâminas` : 'a arte atual'} por ${imagens.length > 1 ? `${imagens.length} lâminas novas` : '1 arte nova'}`,
      envios: imagens, montar: r => ({ slides: r, tipo: r.length > 1 ? 'carousel' : 'image' }) };
  }

  return { analisar, acharRoteiro, lerRoteiro, aplicarRoteiro, prepararAjustes, planejarAjuste, mesmoNumero, laminaDe };
})();
