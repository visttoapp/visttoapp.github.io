(async function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const rich = s => String(s == null ? '' : s).replace(/<(?!\/?em>)/g, '&lt;');
  const pad = n => String(n == null ? '' : n).padStart(2, '0');
  const $ = id => document.getElementById(id);

  const I = {
    carousel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="14" height="14" rx="1"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/></svg>',
    reel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M8 3l3 6M14 3l3 6M10 13l5 2.5-5 2.5z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    close: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 2l8 8M10 2l-8 8"/></svg>',
    prev: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2 4 6l4 4"/></svg>',
    next: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2l4 4-4 4"/></svg>'
  };
  const LABEL = { carousel: 'Carrossel', reel: 'Reel · Vídeo', image: 'Imagem', texto: 'Texto' };
  const LABEL_ADS = { carousel: 'Carrossel', reel: 'Vídeo', image: 'Imagem', texto: 'Texto' };
  const STATUS = { pendente: 'Aguardando', aprovado: 'Aprovado', ajuste: 'Ajuste solicitado' };
  const CANAL = { instagram: 'Feed', meta: 'Meta Ads', google: 'Google Ads' };

  const params = new URLSearchParams(location.hash.slice(1) || location.search);
  if(location.search.includes('t=')) history.replaceState(null,'',location.pathname+'#'+params.toString());
  const token = params.get('t') || '';
  let agency = { name: 'Vistto' };

  $('agencyLogo').textContent=agency.name;

  let data, posts = [], canal = 'instagram', ads = false;
  const cover = p => p.capa_url || (p.slides && p.slides[0]) || '';

  async function load(alvo) {
    try { data = await window.API.carregar(token, alvo); }
    catch (e) { return fail('Não foi possível carregar. ' + (e.message || '')); }
    if (!data) return fail('Link inválido ou expirado. Peça um novo link para a agência.');
    agency.name=data.agencia?.nome || 'Vistto'; BRAND.apply(data.agencia);
    canal = data.canal || 'instagram'; ads = canal !== 'instagram';
    document.body.dataset.canal = canal;
    abas();
    if (!data.mes) return fail(ads
      ? `Ainda não há ${CANAL[canal]} publicado para ${data.cliente.nome}.`
      : `Ainda não há conteúdo publicado para ${data.cliente.nome}.`);
    posts = (data.posts || []).map((p, i) => ({ ...p, idx: i, numero: pad(p.numero || i + 1) }));
    render();
  }
  // Uma aba por canal com conteúdo publicado. Cliente sem anúncio nem vê a barra.
  function abas() {
    const lista = data.canais || [];
    const box = $('canais');
    box.hidden = lista.length < 2;
    box.innerHTML = lista.map(c => `<button role="tab" data-canal="${esc(c.canal)}" aria-selected="${c.canal === canal}" class="${c.canal === canal ? 'on' : ''}">${esc(CANAL[c.canal] || c.canal)}</button>`).join('');
    box.querySelectorAll('[data-canal]').forEach(b => b.onclick = () => { if (b.dataset.canal !== canal) load({ canal: b.dataset.canal }); });
  }
  function fail(msg) {
    $('title').textContent = ads ? CANAL[canal] : 'Prévia do feed';
    $('empty').textContent = msg; $('empty').hidden = false;
    $('feed').innerHTML = ''; $('hl').innerHTML = ''; $('profile').innerHTML = ''; $('calList').innerHTML = ''; $('summary').innerHTML = '';
    $('months').hidden = true; $('intro').textContent = ''; $('legend').innerHTML = '';
  }

  const nomeDe = p => p.tema || (p.titulo || '').replace(/<[^>]+>/g, '') || 'Sem título';
  const dominio = v => { try { return new URL(v).host.replace(/^www\./, ''); } catch { return ''; } };
  // Anúncio de pesquisa do Google: sem arte, só o bloco de texto como aparece na busca.
  const anuncioTexto = p => `<span class="txtad">
      <span class="txtad-top"><span class="txtad-tag">Anúncio</span>${p.destino ? `<span class="txtad-url">${esc(dominio(p.destino))}</span>` : ''}</span>
      <b>${esc((p.titulo || '').replace(/<[^>]+>/g, ''))}</b>
      ${p.descricao ? `<span class="txtad-desc">${esc(p.descricao)}</span>` : ''}</span>`;

  function render() {
    const C = data.cliente, M = data.mes;
    $('clientName').textContent = C.nome;
    $('clientMonth').textContent = M.titulo;
    $('clientMeta').textContent = ads
      ? [M.objetivo, `${posts.length} anúncio${posts.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
      : `${C.handle || ''} · ${posts.length} publicações`;
    $('title').textContent = M.titulo;
    $('eyebrow').textContent = ads ? `${CANAL[canal]} · aprovação de criativos` : 'Prévia do feed · Aprovação';
    $('calTitle').textContent = ads ? 'Anúncios da campanha' : 'Calendário do mês';
    $('intro').textContent = M.intro || (ads
      ? 'Toque em qualquer anúncio para ver o criativo e os textos. Aprove ou peça ajustes direto por aqui.'
      : 'Toque em qualquer post para ver o conteúdo completo. Aprove ou peça ajustes direto por aqui.');
    $('foot').textContent = `Prévia de aprovação · ${agency.name} · ${M.titulo}`;
    $('empty').hidden = true;

    const sel = $('months');
    sel.hidden=true;
    if ((data.meses || []).length > 1) {
      sel.hidden = false;
      sel.innerHTML = data.meses.map(m => `<option value="${esc(m.id)}" ${m.id === M.id ? 'selected' : ''}>${esc(m.titulo)}</option>`).join('');
      sel.onchange = () => load({ entrega: sel.value });
    }

    const approved = posts.filter(p => p.status === 'aprovado').length;
    const adjust = posts.filter(p => p.status === 'ajuste').length;
    $('summary').innerHTML =
      `<div><b>${posts.length}</b><span>${ads ? 'anúncios' : 'posts'}</span></div>` +
      `<div><b>${approved}</b><span>aprovados</span></div>` +
      `<div><b>${adjust}</b><span>ajustes</span></div>`;

    const counts = posts.reduce((a, p) => { a[p.tipo] = (a[p.tipo] || 0) + 1; return a; }, {});
    $('legend').innerHTML = ['carousel', 'reel', 'image', 'texto'].filter(t => counts[t])
      .map(t => `<span>${I[t] || I.image}${(ads ? LABEL_ADS[t] : LABEL[t]).split(' ')[0]}</span>`).join('');

    $('calList').innerHTML = posts.map(p => `
      <li><button data-post="${p.idx}">
        <span class="num">${esc(p.numero)}</span>
        <span class="thumb">${cover(p) ? `<img src="${esc(cover(p))}" alt="">` : ''}</span>
        <span class="topic">${esc(nomeDe(p))}${p.data || p.conjunto ? `<small>${esc(ads ? (p.conjunto || p.data || '') : p.data)}</small>` : ''}</span>
        <span class="dot ${esc(p.status)}" title="${STATUS[p.status] || ''}"></span>
      </button></li>`).join('');

    const isSvg = C.avatar_url && /\.svg$/i.test(C.avatar_url);
    $('profile').innerHTML = ads ? '' : `
      <div class="av ${isSvg ? '' : 'photo'}">${C.avatar_url ? `<img src="${esc(C.avatar_url)}" alt="">` : ''}</div>
      <div><b>${esc(C.handle || C.nome)}</b><div class="bio">${esc(C.bio || '')}</div></div>`;

    $('hl').innerHTML = ads ? '' : (data.destaques || []).map((s, i) => `
      <button data-story="${i}"><span class="ring"><div>${s.capa_url ? `<img src="${esc(s.capa_url)}" alt="">` : ''}</div></span><span>${esc(s.nome)}</span></button>`).join('');

    if (ads) return renderAnuncios();
    $('feed').className = 'feed';
    const order = [...posts].reverse(); // mais recente primeiro, como no Instagram
    $('feed').innerHTML = order.map(p => `
      <button class="tile" data-post="${p.idx}" aria-label="Post ${esc(p.numero)}: ${esc(p.tema)}">
        ${p.video_url && !cover(p) ? `<video src="${esc(p.video_url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(cover(p))}" alt="" loading="lazy">`}
        <span class="badge">${esc(p.numero)}</span>
        <span class="kind">${I[p.tipo] || I.image}</span>
        ${p.status !== 'pendente' ? `<span class="st ${esc(p.status)}">${STATUS[p.status]}</span>` : ''}
        <span class="ver"><span>Ver post</span></span>
      </button>`).join('');
  }

  // Campanha → conjunto (ou grupo de anúncios) → anúncio, na mesma divisão do gerenciador.
  function renderAnuncios() {
    const grupos = [];
    posts.forEach(p => {
      const nome = p.conjunto || '';
      let g = grupos.find(x => x.nome === nome);
      if (!g) grupos.push(g = { nome, itens: [] });
      g.itens.push(p);
    });
    $('feed').className = 'ads';
    $('feed').innerHTML = grupos.map(g => `
      <section class="adgroup">
        ${g.nome ? `<div class="adgroup-head"><span class="label">${esc(g.nome)}</span><small>${g.itens.length} anúncio${g.itens.length > 1 ? 's' : ''}</small></div>` : ''}
        <div class="adlist">${g.itens.map(p => `
          <button class="adcard" data-post="${p.idx}" aria-label="Anúncio ${esc(p.numero)}: ${esc(nomeDe(p))}">
            <span class="adthumb">${p.tipo === 'texto' ? anuncioTexto(p)
              : p.video_url && !cover(p) ? `<video src="${esc(p.video_url)}" muted playsinline preload="metadata"></video>`
              : `<img src="${esc(cover(p))}" alt="" loading="lazy">`}</span>
            <span class="adbody">
              <span class="adnum">${esc(p.numero)} · ${esc(LABEL_ADS[p.tipo] || 'Imagem')}</span>
              <b>${esc(nomeDe(p))}</b>
              ${p.legenda ? `<span class="adtext">${esc(p.legenda)}</span>` : ''}
              <span class="adfoot">${p.cta ? `<span class="adcta">${esc(p.cta)}</span>` : '<span></span>'}<span class="st ${esc(p.status)}">${STATUS[p.status]}</span></span>
            </span>
          </button>`).join('')}</div>
      </section>`).join('');
  }

  /* ---------- modal ---------- */
  const backdrop = $('backdrop'), modal = $('modal');
  let cur = null, idx = 0, total = 1;

  function slidesFor(p) {
    if (p.tipo === 'texto') return [`<div class="slide slide-texto">${anuncioTexto(p)}</div>`];
    if (p.tipo === 'reel') return [`<div class="slide"><video src="${esc(p.video_url)}" controls autoplay playsinline ${p.capa_url ? `poster="${esc(p.capa_url)}"` : ''}></video></div>`];
    return (p.slides || []).map(s => `<div class="slide"><img src="${esc(s)}" alt=""></div>`);
  }
  const fmtDate = d => { try { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } };

  function reviewHTML(p) {
    const name = localStorage.getItem('aprov_nome') || '';
    const h = (p.historico || []).filter(a => a.comentario || a.acao !== 'comentario');
    return `
      <div class="review" id="review">
        <div class="label">Sua avaliação</div>
        <div class="status-line ${esc(p.status)}">${STATUS[p.status]}</div>
        <textarea id="comment" rows="3" placeholder="Comentário ou o que precisa ajustar (obrigatório para pedir ajuste)"></textarea>
        <input id="author" placeholder="Seu nome" value="${esc(name)}">
        <div class="actions">
          <button class="btn success" id="btnOk">Aprovar</button>
          <button class="btn warn" id="btnAdj">Pedir ajuste</button>
          <button class="btn ghost" id="btnCom">Só comentar</button>
        </div>
        <div class="msg" id="msg"></div>
        ${h.length ? `<div class="label" style="margin-top:18px">Histórico</div><ul class="hist">${h.map(a => `
          <li class="${esc(a.acao)}"><b>${a.acao === 'aprovado' ? 'Aprovado' : a.acao === 'ajuste' ? 'Ajuste' : 'Comentário'}</b>${a.autor ? ` · ${esc(a.autor)}` : ''}${a.created_at ? ` · ${fmtDate(a.created_at)}` : ''}${a.comentario ? `<p>${esc(a.comentario)}</p>` : ''}</li>`).join('')}</ul>` : ''}
      </div>`;
  }
  function bindReview() {
    $('btnOk').onclick = () => send('aprovado');
    $('btnAdj').onclick = () => send('ajuste');
    $('btnCom').onclick = () => send('comentario');
  }

  function openPost(i) {
    cur = posts[i]; idx = 0;
    const slides = slidesFor(cur); total = slides.length; const multi = total > 1;
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="media" id="media">
        ${multi ? `<span class="counter" id="counter">1 / ${total}</span>` : ''}
        <button class="close" id="close" aria-label="Fechar">${I.close}</button>
        <div class="track" id="track">${slides.join('')}</div>
        ${multi ? `<button class="arrow prev" id="prev" aria-label="Anterior">${I.prev}</button><button class="arrow next" id="next" aria-label="Próximo">${I.next}</button>` : ''}
      </div>
      <div class="info">
        ${multi ? `<div class="dots" id="dots">${slides.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        ${ads ? infoAnuncio(cur, multi, total) : `
        <div class="label">Post ${esc(cur.numero)} &nbsp;·&nbsp; ${LABEL[cur.tipo] || 'Imagem'}${multi ? ` · ${total} imagens` : ''}${cur.data ? ` &nbsp;·&nbsp; ${esc(cur.data)}` : ''}</div>
        <h3>${rich(cur.titulo)}</h3>
        <div class="label">Legenda</div>
        <div class="cap">${esc(cur.legenda)}</div>`}
        ${reviewHTML(cur)}
      </div>`;
    show();
    document.querySelectorAll('.cal button').forEach(b => b.classList.toggle('active', +b.dataset.post === i));
    if (multi) { $('prev').onclick = () => go(idx - 1); $('next').onclick = () => go(idx + 1); swipe($('media')); go(0); }
    bindReview();
  }

  function infoAnuncio(p, multi, total) {
    return `
      <div class="label">${p.conjunto ? esc(p.conjunto) + ' &nbsp;·&nbsp; ' : ''}Anúncio ${esc(p.numero)} &nbsp;·&nbsp; ${esc(LABEL_ADS[p.tipo] || 'Imagem')}${multi ? ` · ${total} imagens` : ''}${p.data ? ` &nbsp;·&nbsp; ${esc(p.data)}` : ''}</div>
      <h3>${rich(p.titulo)}</h3>
      ${p.legenda ? `<div class="label">Texto principal</div><div class="cap">${esc(p.legenda)}</div>` : ''}
      ${p.descricao ? `<div class="label">Descrição</div><div class="cap">${esc(p.descricao)}</div>` : ''}
      ${p.cta || p.destino ? `<div class="label">Botão e destino</div><div class="cap">${p.cta ? `<span class="adcta">${esc(p.cta)}</span> ` : ''}${p.destino ? `<a href="${esc(p.destino)}" target="_blank" rel="noopener noreferrer nofollow">${esc(dominio(p.destino))}</a>` : ''}</div>` : ''}
      ${p.publico ? `<div class="label">${canal === 'google' ? 'Palavras-chave e segmentação' : 'Público'}</div><div class="cap">${esc(p.publico)}</div>` : ''}`;
  }

  async function send(acao) {
    const comentario = $('comment').value.trim(), autor = $('author').value.trim(), msg = $('msg');
    if ((acao === 'ajuste' || acao === 'comentario') && !comentario) {
      msg.textContent = acao === 'ajuste' ? 'Descreva o que precisa ajustar.' : 'Escreva o comentário.';
      msg.className = 'msg err'; $('comment').focus(); return;
    }
    if (autor) localStorage.setItem('aprov_nome', autor);
    ['btnOk', 'btnAdj', 'btnCom'].forEach(id => $(id).disabled = true);
    msg.textContent = 'Enviando…'; msg.className = 'msg';
    try {
      const r = await window.API.responder(token, cur.id, acao, comentario, autor);
      if (r && r.status) cur.status = r.status;
      cur.historico = [...(cur.historico || []), { acao, comentario, autor, origem: 'cliente', created_at: new Date().toISOString() }];
      const text = r && r.demo ? 'Modo demonstração: nada foi salvo.' : acao === 'aprovado' ? 'Aprovado. Obrigado!' : acao === 'ajuste' ? 'Ajuste registrado no painel da agência.' : 'Comentário enviado.';
      render();
      $('review').outerHTML = reviewHTML(cur); bindReview();
      $('msg').textContent = text; $('msg').className = 'msg ok';
    } catch (e) {
      msg.textContent = 'Não deu certo: ' + (e.message || 'tente de novo.'); msg.className = 'msg err';
      ['btnOk', 'btnAdj', 'btnCom'].forEach(id => $(id).disabled = false);
    }
  }

  function openStory(i) {
    const s = data.destaques[i]; cur = { story: true }; total = 1;
    modal.className = 'modal story';
    modal.innerHTML = `
      <div class="media"><button class="close" id="close" aria-label="Fechar">${I.close}</button>
        <div class="track"><div class="slide">${s.capa_url ? `<img src="${esc(s.capa_url)}" alt="">` : ''}</div></div></div>
      <div class="info"><div class="label">Destaque</div><h3>${esc(s.nome)}</h3></div>`;
    show();
  }
  function show() { backdrop.classList.add('open'); document.body.style.overflow = 'hidden'; $('close').onclick = close; $('close').focus(); }
  function swipe(el) {
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1)); x0 = null; });
  }
  function go(i) {
    idx = Math.max(0, Math.min(total - 1, i));
    $('track').style.transform = `translateX(-${idx * 100}%)`;
    $('counter').textContent = `${idx + 1} / ${total}`;
    $('prev').disabled = idx === 0; $('next').disabled = idx === total - 1;
    document.querySelectorAll('#dots i').forEach((d, k) => d.classList.toggle('on', k === idx));
  }
  function close() {
    backdrop.classList.remove('open'); document.body.style.overflow = '';
    modal.querySelectorAll('video').forEach(v => v.pause());
    modal.innerHTML = ''; cur = null;
    document.querySelectorAll('.cal button').forEach(b => b.classList.remove('active'));
  }

  document.addEventListener('click', e => {
    const p = e.target.closest('[data-post]'); if (p) return openPost(+p.dataset.post);
    const s = e.target.closest('[data-story]'); if (s) return openStory(+s.dataset.story);
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => {
    if (!cur) return;
    if (e.key === 'Escape') return close();
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (total > 1 && e.key === 'ArrowRight') go(idx + 1);
    if (total > 1 && e.key === 'ArrowLeft') go(idx - 1);
  });

  load({ m: params.get('m'), entrega: params.get('e'), canal: params.get('k') });
})();
