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
  const LABEL = { carousel: 'Carrossel', reel: 'Reel · Vídeo', image: 'Imagem' };
  const LABEL_LINKEDIN = { carousel: 'Carrossel', reel: 'Vídeo', image: 'Imagem' };
  const STATUS = { pendente: 'Aguardando', aprovado: 'Aprovado', ajuste: 'Ajuste solicitado' };
  const CANAL = { instagram: 'Instagram', linkedin: 'LinkedIn' };

  // link antigo (#t=...) ou curto (#prime-plus/k7f3q2m9/outubro-2026); ?t= vira # para o token não ir ao servidor
  if (location.search.includes('t=')) history.replaceState(null, '', location.pathname + '#' + new URLSearchParams(location.search).toString());
  const chave = LINK.ler(location.hash);
  let token = (chave && chave.token) || '';   // no link curto, o token chega na resposta e serve para responder
  let agency = { name: 'Vistto' };

  $('agencyLogo').textContent=agency.name;

  let data, posts = [], canal = 'instagram', li = false;   // li: prévia no formato do LinkedIn
  // grade (miniaturas, o post abre por cima) ou post (um embaixo do outro, com legenda e aprovação ao lado)
  const VISTA_PADRAO = { instagram: 'grade', linkedin: 'post' };
  const lerVista = c => { try { const v = localStorage.getItem('aprov_vista_' + c); if (v === 'grade' || v === 'post') return v; } catch { } return VISTA_PADRAO[c]; };
  let vista = 'grade';
  const cover = p => p.capa_url || (p.slides && p.slides[0]) || '';

  async function load(alvo) {
    try { data = await window.API.carregar(chave, alvo); }
    catch (e) { return fail('Não foi possível carregar. ' + (e.message || '')); }
    if (!data) return fail('Link inválido ou expirado. Peça um novo link para a agência.');
    if (data.token) token = data.token;
    agency.name=data.agencia?.nome || 'Vistto'; BRAND.apply(data.agencia);
    canal = data.canal === 'linkedin' ? 'linkedin' : 'instagram'; li = canal === 'linkedin';
    document.body.dataset.canal = canal;
    vista = lerVista(canal);
    abas();
    if (!data.mes) return fail(`Ainda não há conteúdo publicado para ${data.cliente.nome}.`);
    posts = (data.posts || []).map((p, i) => ({ ...p, idx: i, numero: pad(p.numero || i + 1) }));
    // no link curto, a barra de endereço acompanha o mês aberto
    if (chave && chave.codigo) history.replaceState(null, '', '#' + [chave.cliente, chave.codigo, LINK.mesParaTexto(data.mes.ano_mes, canal)].filter(Boolean).join('/'));
    render();
  }
  // Uma aba por canal com conteúdo publicado. Cliente só com Instagram nem vê a barra.
  function abas() {
    const lista = data.canais || [];
    const box = $('canais');
    box.hidden = lista.length < 2;
    box.innerHTML = lista.map(c => `<button role="tab" data-canal="${esc(c.canal)}" aria-selected="${c.canal === canal}" class="${c.canal === canal ? 'on' : ''}">${esc(CANAL[c.canal] || c.canal)}</button>`).join('');
    box.querySelectorAll('[data-canal]').forEach(b => b.onclick = () => { if (b.dataset.canal !== canal) load({ canal: b.dataset.canal }); });
  }
  function fail(msg) {
    $('title').textContent = li ? 'Prévia do LinkedIn' : 'Prévia do feed';
    $('empty').textContent = msg; $('empty').hidden = false;
    $('feed').innerHTML = ''; $('hl').innerHTML = ''; $('profile').innerHTML = ''; $('calList').innerHTML = ''; $('summary').innerHTML = '';
    $('months').hidden = true; $('intro').textContent = ''; $('legend').innerHTML = ''; $('vistas').hidden = true;
  }

  const nomeDe = p => p.tema || (p.titulo || '').replace(/<[^>]+>/g, '') || 'Sem título';
  function render() {
    const C = data.cliente, M = data.mes;
    $('clientName').textContent = C.nome;
    $('clientMonth').textContent = M.titulo;
    $('clientMeta').textContent = li ? `${posts.length} publicações no LinkedIn` : `${C.handle || ''} · ${posts.length} publicações`;
    $('title').textContent = M.titulo;
    $('eyebrow').textContent = li ? 'Prévia do LinkedIn · Aprovação' : 'Prévia do feed · Aprovação';
    $('calTitle').textContent = 'Calendário do mês';
    $('foot').textContent = `Prévia de aprovação · ${agency.name} · ${M.titulo}`;
    $('empty').hidden = true;

    const sel = $('months');
    sel.hidden=true;
    if ((data.meses || []).length > 1) {
      sel.hidden = false;
      sel.innerHTML = data.meses.map(m => `<option value="${esc(m.id)}" ${m.id === M.id ? 'selected' : ''}>${esc(m.titulo)}</option>`).join('');
      sel.onchange = () => load({ entrega: sel.value });
    }

    renderResumo();

    const counts = posts.reduce((a, p) => { a[p.tipo] = (a[p.tipo] || 0) + 1; return a; }, {});
    $('legend').innerHTML = ['carousel', 'reel', 'image'].filter(t => counts[t])
      .map(t => `<span>${I[t] || I.image}${(li ? LABEL_LINKEDIN[t] : LABEL[t]).split(' ')[0]}</span>`).join('');

    const isSvg = C.avatar_url && /\.svg$/i.test(C.avatar_url);
    $('profile').innerHTML = li ? '' : `
      <div class="av ${isSvg ? '' : 'photo'}">${C.avatar_url ? `<img src="${esc(C.avatar_url)}" alt="">` : ''}</div>
      <div><b>${esc(C.handle || C.nome)}</b><div class="bio">${esc(C.bio || '')}</div></div>`;

    $('hl').innerHTML = li ? '' : (data.destaques || []).map((s, i) => `
      <button data-story="${i}"><span class="ring"><div>${s.capa_url ? `<img src="${esc(s.capa_url)}" alt="">` : ''}</div></span><span>${esc(s.nome)}</span></button>`).join('');

    renderVistas();
    renderFeed();
  }

  // números e calendário da lateral: mudam a cada resposta do cliente
  function renderResumo() {
    const approved = posts.filter(p => p.status === 'aprovado').length;
    const adjust = posts.filter(p => p.status === 'ajuste').length;
    $('summary').innerHTML =
      `<div><b>${posts.length}</b><span>posts</span></div>` +
      `<div><b>${approved}</b><span>aprovados</span></div>` +
      `<div><b>${adjust}</b><span>ajustes</span></div>`;

    $('calList').innerHTML = posts.map(p => `
      <li><button data-post="${p.idx}">
        <span class="num">${esc(p.numero)}</span>
        <span class="thumb">${cover(p) ? `<img src="${esc(cover(p))}" alt="">` : ''}</span>
        <span class="topic">${esc(nomeDe(p))}${p.data ? `<small>${esc(p.data)}</small>` : ''}</span>
        <span class="dot ${esc(p.status)}" title="${STATUS[p.status] || ''}"></span>
      </button></li>`).join('');
  }

  function renderVistas() {
    const box = $('vistas');
    box.hidden = false;
    box.querySelectorAll('[data-vista]').forEach(b => {
      b.classList.toggle('on', b.dataset.vista === vista);
      b.setAttribute('aria-pressed', b.dataset.vista === vista);
      b.onclick = () => {
        if (b.dataset.vista === vista) return;
        vista = b.dataset.vista;
        try { localStorage.setItem('aprov_vista_' + canal, vista); } catch { }
        renderVistas(); renderFeed();
      };
    });
    document.body.dataset.vista = vista;
    $('intro').textContent = data.mes.intro || (vista === 'post'
      ? 'Cada post aparece com a legenda e a aprovação ao lado. Aprove ou peça ajustes direto por aqui.'
      : 'Toque em qualquer post para ver o conteúdo completo. Aprove ou peça ajustes direto por aqui.');
  }

  function renderFeed() {
    if (vista === 'post') return renderPosts();
    $('feed').className = 'feed' + (li ? ' feed-li' : '');
    const order = li ? posts : [...posts].reverse(); // no Instagram, mais recente primeiro, como no perfil
    $('feed').innerHTML = order.map(p => `
      <button class="tile" data-post="${p.idx}" aria-label="Post ${esc(p.numero)}: ${esc(p.tema)}">
        ${p.video_url && !cover(p) ? `<video src="${esc(p.video_url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(cover(p))}" alt="" loading="lazy">`}
        <span class="badge">${esc(p.numero)}</span>
        <span class="kind">${I[p.tipo] || I.image}</span>
        ${p.status !== 'pendente' ? `<span class="st ${esc(p.status)}">${STATUS[p.status]}</span>` : ''}
        <span class="ver"><span>Ver post</span></span>
      </button>`).join('');
  }

  // Vista por post: a prévia como sai na rede de um lado; legenda, aprovação e histórico do outro.
  function renderPosts() {
    const C = data.cliente;
    const av = C.avatar_url ? `<img src="${esc(C.avatar_url)}" alt="">` : esc((C.nome || '?').charAt(0));
    $('feed').className = 'pv-lista';
    $('feed').innerHTML = posts.map(p => {
      const slides = slidesFor(p, false), multi = slides.length > 1;
      const topo = li
        ? `<div class="li-head"><span class="li-av">${av}</span><span class="li-quem"><b>${esc(C.nome)}</b><small>Post ${esc(p.numero)}${p.data ? ` · ${esc(p.data)}` : ''} · ${LABEL_LINKEDIN[p.tipo] || 'Imagem'}</small></span></div>`
        : `<div class="pv-ig"><span class="pv-av">${C.avatar_url ? `<img src="${esc(C.avatar_url)}" alt="">` : ''}</span><b>${esc(C.handle || C.nome)}</b><small>Post ${esc(p.numero)}${p.data ? ` · ${esc(p.data)}` : ''}</small></div>`;
      return `<article class="pv" id="pv-${p.idx}" data-idx="${p.idx}">
        <div class="pv-prev">${topo}
          <div class="media">${multi ? `<span class="counter">1 / ${slides.length}</span>` : ''}
            <div class="track">${slides.join('') || '<div class="slide pv-sem">Sem arte</div>'}</div>
            ${multi ? `<button class="arrow prev" aria-label="Anterior">${I.prev}</button><button class="arrow next" aria-label="Próximo">${I.next}</button>` : ''}</div>
          ${multi ? `<div class="dots">${slides.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        </div>
        <div class="info pv-info">${infoHTML(p, slides.length)}</div>
      </article>`;
    }).join('');
    $('feed').querySelectorAll('.pv').forEach(el => { const p = posts[+el.dataset.idx]; carrossel(el); bindReview(el, p); });
  }

  /* ---------- modal ---------- */
  const backdrop = $('backdrop'), modal = $('modal');
  let cur = null;

  function slidesFor(p, autoplay = true) {
    if (p.tipo === 'reel') return p.video_url ? [`<div class="slide"><video src="${esc(p.video_url)}" controls ${autoplay ? 'autoplay' : 'preload="metadata"'} playsinline ${p.capa_url ? `poster="${esc(p.capa_url)}"` : ''}></video></div>`] : [];
    return (p.slides || []).map(s => `<div class="slide"><img src="${esc(s)}" alt="" ${autoplay ? '' : 'loading="lazy"'}></div>`);
  }
  const fmtDate = d => { try { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } };

  // Caixa de aprovação e histórico. Sem ids: aparece no modal e em cada post da vista por post.
  function reviewHTML(p) {
    let name = ''; try { name = localStorage.getItem('aprov_nome') || ''; } catch { }
    const h = (p.historico || []).filter(a => a.comentario || a.acao !== 'comentario');
    return `
      <div class="review">
        <div class="label">Sua avaliação</div>
        <div class="status-line ${esc(p.status)}">${STATUS[p.status]}</div>
        <textarea class="comment" rows="3" aria-label="Comentário" placeholder="Comentário ou o que precisa ajustar (obrigatório para pedir ajuste)"></textarea>
        <input class="author" aria-label="Seu nome" placeholder="Seu nome" value="${esc(name)}">
        <div class="actions">
          <button class="btn success" data-acao="aprovado">Aprovar</button>
          <button class="btn warn" data-acao="ajuste">Pedir ajuste</button>
          <button class="btn ghost" data-acao="comentario">Só comentar</button>
        </div>
        <div class="msg" role="status"></div>
        ${h.length ? `<div class="label" style="margin-top:18px">Histórico</div><ul class="hist">${h.map(a => `
          <li class="${esc(a.acao)}"><b>${a.acao === 'aprovado' ? 'Aprovado' : a.acao === 'ajuste' ? 'Ajuste' : 'Comentário'}</b>${a.autor ? ` · ${esc(a.autor)}` : ''}${a.created_at ? ` · ${fmtDate(a.created_at)}` : ''}${a.comentario ? `<p>${esc(a.comentario)}</p>` : ''}</li>`).join('')}</ul>` : ''}
      </div>`;
  }
  function bindReview(root, p) {
    root.querySelectorAll('.review [data-acao]').forEach(b => b.onclick = () => send(root, p, b.dataset.acao));
  }
  function infoHTML(p, total) {
    return `<div class="label">Post ${esc(p.numero)} &nbsp;·&nbsp; ${(li ? LABEL_LINKEDIN : LABEL)[p.tipo] || 'Imagem'}${total > 1 ? ` · ${total} imagens` : ''}${p.data ? ` &nbsp;·&nbsp; ${esc(p.data)}` : ''}</div>
        <h3>${rich(p.titulo)}</h3>
        <div class="label">${li ? 'Texto do post' : 'Legenda'}</div>
        <div class="cap">${esc(p.legenda)}</div>
        ${reviewHTML(p)}`;
  }

  // Carrossel dentro de root (o modal ou um post da lista): setas, contador, pontinhos e arrastar.
  function carrossel(root) {
    const track = root.querySelector('.track'), total = track ? track.children.length : 0;
    let i = 0;
    const ir = k => {
      i = Math.max(0, Math.min(total - 1, k));
      track.style.transform = `translateX(-${i * 100}%)`;
      const c = root.querySelector('.counter'); if (c) c.textContent = `${i + 1} / ${total}`;
      root.querySelector('.arrow.prev').disabled = i === 0; root.querySelector('.arrow.next').disabled = i === total - 1;
      root.querySelectorAll('.dots i').forEach((d, n) => d.classList.toggle('on', n === i));
      track.querySelectorAll('video').forEach((v, n) => { if (n !== i) v.pause(); });
    };
    if (total < 2) return { ir() { }, total };
    root.querySelector('.arrow.prev').onclick = () => ir(i - 1);
    root.querySelector('.arrow.next').onclick = () => ir(i + 1);
    swipe(root.querySelector('.media'), d => ir(i + d));
    ir(0);
    return { ir: d => ir(i + d), total };
  }

  let car = null;
  function openPost(i) {
    cur = posts[i];
    const slides = slidesFor(cur); const multi = slides.length > 1;
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="media">
        ${multi ? `<span class="counter">1 / ${slides.length}</span>` : ''}
        <button class="close" id="close" aria-label="Fechar">${I.close}</button>
        <div class="track">${slides.join('')}</div>
        ${multi ? `<button class="arrow prev" aria-label="Anterior">${I.prev}</button><button class="arrow next" aria-label="Próximo">${I.next}</button>` : ''}
      </div>
      <div class="info">
        ${multi ? `<div class="dots">${slides.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        ${infoHTML(cur, slides.length)}
      </div>`;
    show();
    document.querySelectorAll('.cal button').forEach(b => b.classList.toggle('active', +b.dataset.post === i));
    car = carrossel(modal);
    bindReview(modal, cur);
  }

  async function send(root, p, acao) {
    const q = c => root.querySelector('.review ' + c);
    const comentario = q('.comment').value.trim(), autor = q('.author').value.trim(), msg = q('.msg');
    if ((acao === 'ajuste' || acao === 'comentario') && !comentario) {
      msg.textContent = acao === 'ajuste' ? 'Descreva o que precisa ajustar.' : 'Escreva o comentário.';
      msg.className = 'msg err'; q('.comment').focus(); return;
    }
    if (autor) try { localStorage.setItem('aprov_nome', autor); } catch { }
    const botoes = root.querySelectorAll('.review [data-acao]');
    botoes.forEach(b => b.disabled = true);
    msg.textContent = 'Enviando…'; msg.className = 'msg';
    try {
      const r = await window.API.responder(token, p.id, acao, comentario, autor);
      if (r && r.status) p.status = r.status;
      p.historico = [...(p.historico || []), { acao, comentario, autor, origem: 'cliente', created_at: new Date().toISOString() }];
      const text = r && r.demo ? 'Modo demonstração: nada foi salvo.' : acao === 'aprovado' ? 'Aprovado. Obrigado!' : acao === 'ajuste' ? 'Ajuste registrado no painel da agência.' : 'Comentário enviado.';
      renderResumo();
      if (vista === 'grade') renderFeed();   // o selo de status das miniaturas
      root.querySelector('.review').outerHTML = reviewHTML(p); bindReview(root, p);
      q('.msg').textContent = text; q('.msg').className = 'msg ok';
    } catch (e) {
      msg.textContent = 'Não deu certo: ' + (e.message || 'tente de novo.'); msg.className = 'msg err';
      botoes.forEach(b => b.disabled = false);
    }
  }

  function openStory(i) {
    const s = data.destaques[i]; cur = { story: true }; car = null;
    modal.className = 'modal story';
    modal.innerHTML = `
      <div class="media"><button class="close" id="close" aria-label="Fechar">${I.close}</button>
        <div class="track"><div class="slide">${s.capa_url ? `<img src="${esc(s.capa_url)}" alt="">` : ''}</div></div></div>
      <div class="info"><div class="label">Destaque</div><h3>${esc(s.nome)}</h3></div>`;
    show();
  }
  function show() { backdrop.classList.add('open'); document.body.style.overflow = 'hidden'; $('close').onclick = close; $('close').focus(); }
  function swipe(el, mover) {
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) mover(dx < 0 ? 1 : -1); x0 = null; });
  }
  function close() {
    backdrop.classList.remove('open'); document.body.style.overflow = '';
    modal.querySelectorAll('video').forEach(v => v.pause());
    modal.innerHTML = ''; cur = null; car = null;
    document.querySelectorAll('.cal button').forEach(b => b.classList.remove('active'));
  }

  document.addEventListener('click', e => {
    const p = e.target.closest('[data-post]');
    if (p && vista === 'post') {   // na vista por post, o calendário leva até o post
      const alvo = $('pv-' + p.dataset.post);
      if (alvo) alvo.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (p) return openPost(+p.dataset.post);
    const s = e.target.closest('[data-story]'); if (s) return openStory(+s.dataset.story);
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => {
    if (!cur) return;
    if (e.key === 'Escape') return close();
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (car && e.key === 'ArrowRight') car.ir(1);
    if (car && e.key === 'ArrowLeft') car.ir(-1);
  });

  load(chave ? { m: chave.m, entrega: chave.entrega, canal: chave.canal } : {});
})();
