/* Vistto · lê uma pasta do mês e monta os posts.
   Espera caminhos relativos, como "carrosseis/01 tema/1.jpg" ou "esteticos/03 tema.jpg".
   Pasta com vários arquivos = um carrossel. Arquivo solto = um post. .mp4 = reel.
   Tira do nome só o número e a ordem. Data, legenda e título ficam vazios, para preencher na mão.
   Não faz upload nem toca no banco: só interpreta os nomes. */
window.PASTA = (() => {
  const CATEGORIA = /^(carross?[ei]is?|carrossel|carroseis|est[ae]ticos?|est[áa]ticos?|estetico|[uú]nicos?|singles?|posts?|feed|artes?|finais?|final|entregas?|aprova[cç][ãa]o|aprovacao|reels?|v[íi]deos?|videos?|stories|story)$/;
  const IGNORAR = /^(brutos?|raw|psd|psds?|ai|editaveis?|edit[áa]veis?|fontes?|refer[êe]ncias?|refs?|backup|antigos?|old|logos?|briefing|__macosx)$/;
  const IMAGEM = /\.(jpe?g|png|webp|gif)$/i;
  const VIDEO = /\.mp4$/i;
  const CAPA = /(capa|thumb|cover)/;

  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chave = s => semAcento(s).toLowerCase().trim();
  const base = nome => nome.replace(/\.[^.]+$/, '');
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
      numero: n.numero, data: null, tema: tituloDe(n.resto), tipo,
      arquivos, origem: origem || nomeBruto, avisos
    };
  }

  return { analisar };
})();
