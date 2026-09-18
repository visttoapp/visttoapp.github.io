(function () {
  const cfg = window.CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const pad = n => String(n == null ? '' : n).padStart(2, '0');
  const STATUS = { pendente: 'Aguardando', aprovado: 'Aprovado', ajuste: 'Ajuste' };
  const TIPO = { carousel: 'Carrossel', image: 'Imagem', reel: 'Reel' };
  const PAPEIS = { dono: 'Dono', socio: 'Sócio', head: 'Head', designer: 'Designer', editor_video: 'Editor de vídeo', social_media: 'Social media', gestor_trafego: 'Gestor de tráfego' };
  const NIVEL = { dono: 3, socio: 3, head: 2, designer: 1, editor_video: 1, social_media: 1, gestor_trafego: 1 };
  const COLS = 'id,agencia_id,squad_id,slug,nome,handle,bio,avatar_url,created_at';


  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    $('login').hidden = false;
    $('loginMsg').textContent = 'Preencha js/config.js com a URL e a chave anon do Supabase.';
    $('loginMsg').className = 'msg err';
    return;
  }
  const hashInicial = new URLSearchParams(location.hash.slice(1));
  let recuperando = hashInicial.get('type') === 'recovery';
  const erroLink = hashInicial.get('error_code') || hashInicial.get('error');
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange(evento => { if (evento === 'PASSWORD_RECOVERY') { recuperando = true; abrirSenha(); } });

  const run = async q => { const r = await q; if(r.error) throw r.error; return r.data; };
  window.addEventListener('unhandledrejection', e => { e.preventDefault(); alert('Não foi possível concluir: ' + (e.reason?.message || 'tente novamente.')); });
  /* ---------- auth ---------- */
  $('btnLogin').onclick = async () => {
    $('loginMsg').textContent = 'Entrando…'; $('loginMsg').className = 'msg';
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pass').value });
    if (error) { $('loginMsg').textContent = error.message; $('loginMsg').className = 'msg err'; return; }
    await start();
  };
  $('btnEsqueci').onclick = async () => {
    const email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('loginMsg').textContent = 'Digite seu e-mail no campo acima e clique de novo em Esqueci minha senha.'; $('loginMsg').className = 'msg err'; return; }
    $('btnEsqueci').disabled = true; $('loginMsg').textContent = 'Enviando…'; $('loginMsg').className = 'msg';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('./', location.href).href });
    $('btnEsqueci').disabled = false;
    if (error && /not authorized|rate limit/i.test(error.message)) { $('loginMsg').textContent = 'Não foi possível enviar o e-mail agora. Peça ao responsável da sua equipe para redefinir sua senha no painel.'; $('loginMsg').className = 'msg err'; return; }
    $('loginMsg').textContent = 'Se este e-mail tiver acesso, você vai receber um link para criar uma nova senha. Confira também o spam.'; $('loginMsg').className = 'msg ok';
  };
  $('btnPrimeiro').onclick = () => { $('primeiroBox').hidden = !$('primeiroBox').hidden; if (!$('primeiroBox').hidden) ($('email').value ? $('primeiroCodigo') : $('email')).focus(); };
  $('btnPrimeiroSalvar').onclick = async () => {
    const email = $('email').value.trim(), codigo = $('primeiroCodigo').value.replace(/\D/g, ''), a = $('primeiroSenha').value, b = $('primeiroSenha2').value;
    const erro = t => { $('loginMsg').textContent = t; $('loginMsg').className = 'msg err'; };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('Digite seu e-mail no campo E-mail.');
    if (codigo.length !== 6) return erro('O código tem 6 números.');
    if (a.length < 8) return erro(`A senha precisa ter pelo menos 8 caracteres (tem ${a.length}).`);
    if (a !== b) return erro('As duas senhas não são iguais.');
    $('btnPrimeiroSalvar').disabled = true; $('loginMsg').textContent = 'Criando sua senha…'; $('loginMsg').className = 'msg';
    try {
      const r = await fetch(cfg.SUPABASE_URL + '/functions/v1/primeiro-acesso', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY }, body: JSON.stringify({ email, codigo, password: a }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Não foi possível concluir.');
      const { error } = await sb.auth.signInWithPassword({ email, password: a });
      if (error) throw new Error('Senha criada. Agora entre com seu e-mail e a senha nova.');
      $('primeiroSenha').value = ''; $('primeiroSenha2').value = ''; $('primeiroCodigo').value = ''; $('primeiroBox').hidden = true;
      $('loginMsg').textContent = ''; await start();
    } catch (e) { erro(e.message); } finally { $('btnPrimeiroSalvar').disabled = false; }
  };
  $('pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });
  $('btnLogout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  sb.auth.getSession().then(({ data }) => {
    if (data.session) return start();
    $('login').hidden = false;
    if (erroLink) { $('loginMsg').textContent = 'O link expirou ou já foi usado. Clique em Esqueci minha senha para receber outro.'; $('loginMsg').className = 'msg err'; history.replaceState(null, '', location.pathname); }
  });

  /* ---------- senha ---------- */
  let obrigatorio = false;
  function abrirSenha() {
    if ($('app').hidden) return;
    $('cardSenha').hidden = false; $('msgSenha').textContent = '';
    $('senhaIntro').textContent = obrigatorio ? 'Crie a sua senha pessoal (mínimo 8 caracteres) para liberar o painel.' : recuperando ? 'Você entrou pelo link de recuperação. Defina agora a sua nova senha (mínimo 8 caracteres).' : 'Escolha uma nova senha com pelo menos 8 caracteres.';
    $('cardSenha').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('novaSenha').focus();
  }
  $('btnMinhaSenha').onclick = () => { recuperando = false; abrirSenha(); };
  $('btnFecharSenha').onclick = () => { $('cardSenha').hidden = true; $('novaSenha').value = ''; $('novaSenha2').value = ''; };
  $('btnSalvarSenha').onclick = async () => {
    const a = $('novaSenha').value, b = $('novaSenha2').value;
    $('msgSenha').className = 'msg err';
    if (a.length < 8) { $('msgSenha').textContent = `A senha precisa ter pelo menos 8 caracteres (tem ${a.length}).`; return; }
    if (a.length > 128) { $('msgSenha').textContent = 'A senha pode ter no máximo 128 caracteres.'; return; }
    if (a !== b) { $('msgSenha').textContent = 'As duas senhas não são iguais.'; return; }
    $('btnSalvarSenha').disabled = true;
    const { error } = await sb.auth.updateUser({ password: a, data: { trocar_senha: false } });
    $('btnSalvarSenha').disabled = false;
    if (error) { $('msgSenha').textContent = /different|same/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : /weak|pwned|leak/i.test(error.message) ? 'Essa senha é fraca ou já vazou em outro site. Escolha outra.' : 'Não foi possível trocar a senha: ' + error.message; return; }
    recuperando = false; $('novaSenha').value = ''; $('novaSenha2').value = '';
    if (obrigatorio) { obrigatorio = false; document.body.classList.remove('trocar-senha'); setTimeout(() => { $('cardSenha').hidden = true; }, 1500); }
    $('msgSenha').textContent = 'Senha trocada.'; $('msgSenha').className = 'msg ok';
  };

  /* ---------- estado ---------- */
  let agencias = [], agencia = null, superadmin = false, nivel = 0, squads = [];
  let clientes = [], meses = [], posts = [], cliente = null, mes = null;
  let files = [];          // arquivos do post em edição [{file, url, kind}]
  let editing = null;      // post em edição (id) ou null
  let destFiles = [];      // {nome, url}

  async function start() {
    try {
      const ctx=await run(sb.rpc('meu_contexto'));
      agencias=ctx.agencias;superadmin=ctx.superadmin;
      if(!agencias.length){await sb.auth.signOut();$('login').hidden=false;$('app').hidden=true;$('loginMsg').textContent='Seu acesso ainda não foi liberado. Fale com o responsável da sua equipe.';return;}
      $('selAgencia').innerHTML=agencias.map(g=>`<option value="${g.id}">${esc(g.nome)}</option>`).join('');
      $('boxAgencia').hidden=agencias.length<2;
      $('login').hidden=true;$('app').hidden=false;
      history.replaceState(null,'','./');
      await selectAgencia(agencias[0].id);
      const { data: { user } } = await sb.auth.getUser();
      obrigatorio = !!user?.user_metadata?.trocar_senha;
      document.body.classList.toggle('trocar-senha', obrigatorio);
      if (recuperando || obrigatorio) abrirSenha();
    }catch(e){$('app').hidden=true;$('login').hidden=false;$('loginMsg').textContent='Não foi possível abrir o painel: '+e.message;}
  }

  async function selectAgencia(id) {
    agencia=agencias.find(g=>g.id===id); BRAND.apply(agencia);
    nivel=agencia.nivel||0;
    $('meuPapel').textContent=superadmin?'Administrador geral':(PAPEIS[agencia.papel]||'');
    squads=await run(sb.rpc('listar_squads',{p_agencia:agencia.id}));
    const squadOpts=squads.map(q=>`<option value="${q.id}">${esc(q.nome)}</option>`).join('');
    $('cSquad').innerHTML=(nivel>=3?'<option value="">Sem squad (só donos e sócios veem)</option>':'')+squadOpts;
    $('accessSquad').innerHTML=(nivel>=3?'<option value="">Sem squad</option>':'')+squadOpts;
    $('accessSquad').closest('.field').hidden=!agencia.usa_squads||(nivel<3&&!squads.length);
    $('btnAccess').hidden=nivel<2; $('btnEspaco').hidden=!superadmin; $('btnNovoCliente').hidden=nivel<2||(nivel<3&&agencia.usa_squads&&!squads.length); $('cardLink').hidden=nivel<2;
    const comSquads=!!agencia.usa_squads;
    $('squadsBox').hidden=nivel<3||!comSquads;
    $('cSquad').closest('.field').hidden=!comSquads;
    if(!comSquads){$('accessSquad').closest('.field').hidden=true;$('accessSquad').innerHTML='<option value=""></option>';$('cSquad').innerHTML='<option value=""></option>';}
    $('titulo').style.cursor=nivel>=2?'pointer':''; $('titulo').title=nivel>=2?'Editar cliente':'';
    $('accessPapel').innerHTML=Object.entries(PAPEIS).filter(([k])=>NIVEL[k]<nivel).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
    $('accessPapel').value=nivel>=3?'head':'designer';
    $('cardCliente').hidden=true; $('cardMes').hidden=true; $('accessCard').hidden=true; $('cardEspaco').hidden=true; document.body.classList.remove('vendo-equipe','vendo-espaco'); $('btnAccess').classList.remove('active'); $('cardSenha').hidden=!(recuperando||obrigatorio);
    await loadClientes();
    medirEspaco();
  }
  $('selAgencia').onchange=e=>selectAgencia(e.target.value);
  $('btnRefresh').onclick=()=>selectMes(mes?.id);
  $('filterStatus').onchange=renderLista;
  async function accessList() {
    const rows=await run(sb.rpc('listar_acessos',{p_agencia:agencia.id}));
    const opcoes=atual=>Object.entries(PAPEIS).filter(([k])=>NIVEL[k]<nivel||k===atual).map(([k,v])=>`<option value="${k}" ${k===atual?'selected':''}>${v}</option>`).join('');
    membrosAgencia=rows;
    $('accessList').innerHTML=rows.map(r=>`<div class="membro"><span>${esc(r.nome||r.email)}${r.nome?`<br><small>${esc(r.email)}</small>`:''}${(r.squads||[]).length?`<br><small>Squad: ${r.squads.map(x=>esc(x.nome)).join(', ')}</small>`:''}${r.pendente?'<br><small>Aguardando primeiro acesso</small>':''}${r.papel==='gestor_trafego'?`<br><small class="${r.clientes?'qtd':'alerta'}">${r.clientes?`${r.clientes} cliente${r.clientes>1?'s':''} liberado${r.clientes>1?'s':''}`:'Nenhum cliente liberado ainda'}</small>`:''}</span>${r.pode_gerir?`${r.papel==='gestor_trafego'?`<button class="btn soft" data-clientes="${r.usuario_id}" aria-expanded="false">Clientes</button>`:''}<select data-papel="${r.usuario_id}" aria-label="Papel">${opcoes(r.papel)}</select><button class="btn ghost" data-codigo="${r.usuario_id}">novo código</button><button class="btn ghost" data-revoke="${r.usuario_id}">remover</button>`:`<small>${esc(PAPEIS[r.papel]||r.papel)}</small>`}${r.papel==='gestor_trafego'&&r.pode_gerir?`<div class="gestor-clientes" id="gc-${r.usuario_id}" hidden></div>`:''}</div>`).join('')||'<p>Ninguém cadastrado nesta agência ainda.</p>';
    $('accessList').querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{await run(sb.rpc('revogar_acesso',{p_agencia:agencia.id,p_usuario:b.dataset.revoke}));$('accessMsg').textContent='Acesso removido.';await accessList();});
    $('accessList').querySelectorAll('[data-codigo]').forEach(b=>b.onclick=async()=>{
      const r=rows.find(x=>x.usuario_id===b.dataset.codigo);
      if(b.dataset.armed!=='1'){b.dataset.armed='1';b.textContent='confirmar: a senha atual deixa de valer';return;}
      b.disabled=true;$('accessMsg').textContent='Gerando código…';
      try{const j=await chamarAcessos({acao:'codigo',usuario_id:r.usuario_id});$('accessMsg').textContent=instrucao(r.nome,r.email,j.codigo);await accessList();}
      catch(e){$('accessMsg').textContent=e.message;b.disabled=false;}
    });
    $('accessList').querySelectorAll('[data-clientes]').forEach(b=>b.onclick=()=>abrirClientesGestor(b));
    $('accessList').querySelectorAll('[data-papel]').forEach(sel=>sel.onchange=async()=>{try{await run(sb.rpc('alterar_papel',{p_agencia:agencia.id,p_usuario:sel.dataset.papel,p_papel:sel.value}));$('accessMsg').textContent='Papel atualizado.';}catch(e){$('accessMsg').textContent=e.message;}await accessList();});
    await recarregarSquads();
  }
  async function abrirClientesGestor(b){
    const u=b.dataset.clientes, box=$('gc-'+u), abrir=box.hidden;
    box.hidden=!abrir; b.setAttribute('aria-expanded',abrir); b.classList.toggle('active',abrir);
    if(!abrir) return;
    box.innerHTML='<small>Carregando…</small>';
    try{
      const lista=await run(sb.rpc('clientes_do_gestor',{p_agencia:agencia.id,p_usuario:u}));
      const pessoa=membrosAgencia.find(x=>x.usuario_id===u);
      const nome=esc((pessoa?.nome||pessoa?.email||'').split(' ')[0]);
      const grupos=[...new Set(lista.map(c=>c.squad||''))];
      box.innerHTML=!lista.length?`<p class="hint">Nenhum cliente disponível. ${agencia.usa_squads?'Coloque a pessoa no squad do cliente primeiro.':'Cadastre um cliente primeiro.'}</p>`
        :`<p class="hint">Marque os clientes de ${nome||'quem faz o tráfego'}. Só os marcados aparecem no painel dessa pessoa. Designers e editores continuam vendo os clientes do squad.</p>`
        +grupos.map(g=>`${g&&grupos.length>1?`<span class="label">${esc(g)}</span>`:''}<div class="checks">${lista.filter(c=>(c.squad||'')===g).map(c=>`<label class="check"><input type="checkbox" data-gc="${c.id}" ${c.marcado?'checked':''}><span>${esc(c.nome)}</span></label>`).join('')}</div>`).join('')
        +(lista.length>3?`<div class="checks-acoes"><button class="btn text sm" data-gc-todos="1">Marcar todos</button><button class="btn text sm" data-gc-todos="0">Desmarcar todos</button></div>`:'');
      const salvar=async(inp)=>{inp.disabled=true;try{await run(sb.rpc('definir_gestor_cliente',{p_cliente:inp.dataset.gc,p_usuario:u,p_dentro:inp.checked}));}catch(e){inp.checked=!inp.checked;$('accessMsg').textContent=e.message;}finally{inp.disabled=false;}};
      const contar=()=>{const n=box.querySelectorAll('[data-gc]:checked').length;const sm=b.closest('.membro').querySelector('small.alerta, small.qtd');if(sm){sm.className=n?'qtd':'alerta';sm.textContent=n?`${n} cliente${n>1?'s':''} liberado${n>1?'s':''}`:'Nenhum cliente liberado ainda';}};
      box.querySelectorAll('[data-gc]').forEach(inp=>inp.onchange=async()=>{await salvar(inp);contar();});
      box.querySelectorAll('[data-gc-todos]').forEach(t=>t.onclick=async()=>{const v=t.dataset.gcTodos==='1';for(const inp of box.querySelectorAll('[data-gc]')){if(inp.checked!==v){inp.checked=v;await salvar(inp);}}contar();});
    }catch(e){box.innerHTML=`<p class="hint">${esc(e.message)}</p>`;}
  }
  let membrosAgencia=[];
  async function recarregarSquads(){
    squads=await run(sb.rpc('listar_squads',{p_agencia:agencia.id}));
    if(nivel<3)return;
    $('squadsList').innerHTML=squads.map(q=>{
      const fora=membrosAgencia.filter(m=>!q.membros.some(x=>x.usuario_id===m.usuario_id));
      return `<div class="squad"><div class="squadHead"><b>${esc(q.nome)}</b><small>${q.clientes} cliente(s)</small><button class="btn ghost" data-del-squad="${q.id}">excluir squad</button></div>
        <div class="chips">${q.membros.map(m=>`<span class="chip">${esc(m.nome)} <small>${esc(PAPEIS[m.papel]||m.papel)}</small><button title="tirar do squad" data-sair="${q.id}|${m.usuario_id}">×</button></span>`).join('')||'<small>Ninguém neste squad ainda.</small>'}</div>
        ${fora.length?`<div class="addMembro"><select data-add-sel="${q.id}" aria-label="Adicionar ao squad">${fora.map(m=>`<option value="${m.usuario_id}">${esc(m.nome||m.email)} · ${esc(PAPEIS[m.papel]||m.papel)}</option>`).join('')}</select><button class="btn" data-add="${q.id}">adicionar ao squad</button></div>`:''}</div>`;
    }).join('')||'<p>Nenhum squad criado.</p>';
    const L=$('squadsList');
    L.querySelectorAll('[data-sair]').forEach(b=>b.onclick=async()=>{const [sq,u]=b.dataset.sair.split('|');await run(sb.rpc('definir_membro_squad',{p_squad:sq,p_usuario:u,p_dentro:false}));await accessList();});
    L.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{const u=L.querySelector(`[data-add-sel="${b.dataset.add}"]`).value;await run(sb.rpc('definir_membro_squad',{p_squad:b.dataset.add,p_usuario:u,p_dentro:true}));await accessList();});
    L.querySelectorAll('[data-del-squad]').forEach(b=>b.onclick=async()=>{
      if(b.dataset.armed!=='1'){b.dataset.armed='1';b.textContent='confirmar: clientes ficam sem squad';return;}
      await run(sb.rpc('excluir_squad',{p_squad:b.dataset.delSquad}));await selectAgencia(agencia.id);verEquipe(true);await accessList();
    });
  }
  $('btnNovoSquad').onclick=async()=>{
    const nome=$('novoSquad').value.trim(); if(!nome){$('accessMsg').textContent='Dê um nome ao squad.';return;}
    try{await run(sb.rpc('salvar_squad',{p_agencia:agencia.id,p_nome:nome}));$('novoSquad').value='';$('accessMsg').textContent='Squad criado.';await selectAgencia(agencia.id);verEquipe(true);await accessList();}catch(e){$('accessMsg').textContent=/unique|duplicate/i.test(e.message)?'Já existe um squad com esse nome.':e.message;}
  };
  const PAPEL_TEXTO={'head':'head','designer':'designer','editor de video':'editor_video','editor de vídeo':'editor_video','editor':'editor_video','editor_video':'editor_video','gestor de trafego':'gestor_trafego','gestor de tráfego':'gestor_trafego','gestor':'gestor_trafego','gestora':'gestor_trafego','gestora de tráfego':'gestor_trafego','gestor_trafego':'gestor_trafego','social media':'social_media','social_media':'social_media','socio':'socio','sócio':'socio','dono':'dono'};
  async function chamarAcessos(corpo){
    const {data:{session}}=await sb.auth.getSession(); if(!session)throw new Error('Entre novamente no painel.');
    const r=await fetch(cfg.SUPABASE_URL+'/functions/v1/acessos',{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({agencia_id:agencia.id,...corpo})});
    const j=await r.json(); if(!r.ok)throw new Error(j.error||'Não foi possível concluir.'); return j;
  }
  $('btnLote').onclick=async()=>{
    const out=[];
    const linhas=$('loteLinhas').value.split('\n').map(l=>l.trim()).filter(Boolean);
    if(!linhas.length){$('loteMsg').textContent='Escreva pelo menos uma linha.';return;}
    $('btnLote').disabled=true;$('loteMsg').textContent='Criando…';
    for(const linha of linhas){
      const [nome,email,papelTxt,squadTxt]=linha.split(';').map(x=>(x||'').trim());
      const papel=PAPEL_TEXTO[(papelTxt||'').toLowerCase()];
      const squad=squadTxt?squads.find(q=>q.nome.toLowerCase()===squadTxt.toLowerCase()):null;
      if(!email||!papel){out.push(`✗ ${linha}: confira e-mail e papel.`);continue;}
      if(squadTxt&&!squad){out.push(`✗ ${nome||email}: squad "${squadTxt}" não encontrado.`);continue;}
      try{const j=await chamarAcessos({email,papel,nome:nome||null,squad_id:squad?.id||null});out.push('✓ '+instrucao(nome,email,j.codigo));}
      catch(e){
        if(/já tem conta|já cadastrado/i.test(e.message)){
          try{await run(sb.rpc('autorizar_acesso',{p_agencia:agencia.id,p_email:email,p_papel:papel,p_nome:nome||null,p_squad:squad?.id||null}));out.push(`✓ ${nome||email}: já tinha conta, foi autorizado${squad?' no squad':''}.`);}
          catch(e2){out.push(`✗ ${nome||email}: ${e2.message}`);}
        } else out.push(`✗ ${nome||email}: ${e.message}`);
      }
      $('loteMsg').textContent=out.join('\n');
    }
    $('btnLote').disabled=false;
    $('loteMsg').textContent=out.join('\n\n')+'\n\nEnvie cada código só para a própria pessoa. Os códigos não aparecem de novo; se perder, use "novo código" na lista.';
    await accessList();
  };
  function mostrar(id){ requestAnimationFrame(() => $(id).scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  function verEquipe(abrir){
    $('accessCard').hidden=!abrir;
    document.body.classList.toggle('vendo-equipe',abrir);
    $('btnAccess').classList.toggle('active',abrir);
    if(abrir)scrollTo({top:0,behavior:'smooth'});
  }
  $('btnAccess').onclick=async()=>{const abrir=$('accessCard').hidden;verEquipe(abrir);if(abrir) await accessList();};
  $('btnFecharEquipe').onclick=()=>verEquipe(false);
  $('grantAccess').onclick=async()=>{try{await run(sb.rpc('autorizar_acesso',{p_agencia:agencia.id,p_email:$('accessEmail').value.trim(),p_papel:$('accessPapel').value,p_nome:$('accessNome').value.trim()||null,p_squad:$('accessSquad').value||null}));$('accessMsg').textContent='Acesso autorizado.';await accessList();}catch(e){$('accessMsg').textContent=e.message;}};
  const instrucao=(nome,email,codigo)=>`${nome||email}: código ${codigo} (vale 48 horas). Envie para a pessoa: acesse ${new URL('./',location.href).href}, clique em Primeiro acesso, use o e-mail ${email} e o código ${codigo}.`;
  $('createAccess').onclick=async()=>{
    const email=$('accessEmail').value.trim(), nome=$('accessNome').value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){$('accessMsg').textContent='E-mail inválido. Confira se está no formato nome@dominio.com.';return;}
    const btn=$('createAccess');btn.disabled=true;$('accessMsg').textContent='Cadastrando…';
    try{
      const j=await chamarAcessos({email,papel:$('accessPapel').value,nome:nome||null,squad_id:$('accessSquad').value||null});
      $('accessNome').value='';$('accessEmail').value='';$('accessMsg').textContent=instrucao(nome,email,j.codigo);await accessList();
    }catch(e){$('accessMsg').textContent=e.message;}finally{btn.disabled=false;}
  };
  $('btnRotate').onclick=async()=>{if(!cliente||nivel<2||!confirm('O link anterior deixará de funcionar. Gerar outro?'))return;cliente.token=await run(sb.rpc('renovar_link',{p_cliente:cliente.id}));renderTop();};
  async function loadClientes() {
    const { data, error } = await sb.from('clientes').select(COLS).eq('agencia_id', agencia.id).order('nome');
    if (error) return alert(error.message);
    clientes = data;
    const opt = c => `<option value="${c.id}">${esc(c.nome)}</option>`;
    const grupos = squads.map(q => ({ nome: q.nome, itens: clientes.filter(c => c.squad_id === q.id) })).filter(g => g.itens.length);
    const soltos = clientes.filter(c => !squads.some(q => q.id === c.squad_id));
    $('selCliente').innerHTML = !clientes.length ? `<option value="">${nivel >= 2 ? '— crie um cliente —' : '— nenhum cliente liberado —'}</option>`
      : grupos.length ? grupos.map(g => `<optgroup label="${esc(g.nome)}">${g.itens.map(opt).join('')}</optgroup>`).join('') + (soltos.length ? `<optgroup label="Sem squad">${soltos.map(opt).join('')}</optgroup>` : '')
      : clientes.map(opt).join('');
    const saved = localStorage.getItem('adm_cliente_' + agencia.id);
    if (saved && clientes.find(c => c.id === saved)) $('selCliente').value = saved;
    await selectCliente($('selCliente').value);
  }
  $('selCliente').onchange = e => { verEquipe(false); $('cardMes').hidden = true; $('cardCliente').hidden = true; selectCliente(e.target.value); };

  async function selectCliente(id) {
    cliente = clientes.find(c => c.id === id) || null;
    localStorage.setItem('adm_cliente_' + agencia.id, id || '');
    meses = []; mes = null; posts=[]; limparPost();
    if (!cliente) { $('selMes').innerHTML = ''; renderTop(); renderLista(); return; }
    if (nivel >= 2 && !cliente.token) cliente.token = await run(sb.rpc('link_cliente', { p_cliente: cliente.id }));
    const data = await run(sb.from('meses').select('*').eq('cliente_id', cliente.id).order('ano_mes', { ascending: false }));
    meses = data || [];
    $('selMes').innerHTML = meses.map(m => `<option value="${m.id}">${esc(m.titulo)}${m.arquivado_em ? ' (arquivado)' : ''}</option>`).join('') || '<option value="">— crie um mês —</option>';
    await selectMes($('selMes').value);
  }
  $('selMes').onchange = e => { verEquipe(false); selectMes(e.target.value); };

  async function selectMes(id) {
    mes = meses.find(m => m.id === id) || null;
    posts = [];
    if (mes) {
      const data = await run(sb.from('posts').select('*, aprovacoes(*)').eq('mes_id', mes.id).order('ordem'));
      await MEDIA.prepare(sb, data);
      posts = (data || []).map(p => ({ ...p, aprovacoes: (p.aprovacoes || []).sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
    }
    renderTop(); renderLista(); limparPost();
  }

  function renderTop() {
    $('titulo').textContent = cliente ? `${cliente.nome}${mes ? ' · ' + mes.titulo : ''}` : (nivel >= 2 ? 'Comece criando um cliente' : 'Nenhum cliente liberado');
    $('btnNovoMes').hidden = !cliente;
    $('btnEditarCliente').hidden = !cliente || nivel < 2;
    $('btnImportPasta').hidden = !mes;
    $('btnExcluirMes').hidden = !mes || nivel < 2;
    $('chkPub').checked = !!(mes && mes.publicado);
    $('chkPub').disabled = !mes || nivel < 2;
    const base = new URL('c',location.href).href;
    $('linkCliente').textContent = cliente && cliente.token ? `${base}#t=${cliente.token}${mes ? '&m=' + mes.ano_mes : ''}` : '—';
    const ap = posts.filter(p => p.status === 'aprovado').length, aj = posts.filter(p => p.status === 'ajuste').length;
    const pend = posts.filter(p => p.status === 'pendente').length;
    $('summary').innerHTML = `<div><b>${posts.length}</b><span>posts no mês</span></div><div><b>${pend}</b><span>aguardando</span></div><div><b>${ap}</b><span>aprovados</span></div><div><b>${aj}</b><span>ajustes</span></div>`;
    $('cardPost').hidden = !mes;
    $('cardLink').hidden = nivel < 2 || !cliente;
    $('summary').hidden = !mes;
  }
  $('chkPub').onchange = async e => {
    if (!mes) return;
    const { error } = await sb.from('meses').update({ publicado: e.target.checked }).eq('id', mes.id);
    if (error) return alert(error.message);
    mes.publicado = e.target.checked; renderTop();
  };
  $('btnCopy').onclick = async () => { if(!cliente?.token || !mes?.publicado) return alert('Publique o mês antes de copiar o link.'); await navigator.clipboard.writeText($('linkCliente').textContent); $('btnCopy').textContent = 'copiado!'; setTimeout(() => $('btnCopy').textContent = 'copiar link', 1500); };

  /* ---------- cliente ---------- */
  $('btnNovoCliente').onclick = () => { verEquipe(false); fillCliente(null); $('cardCliente').hidden = false; mostrar('cardCliente'); };
  $('btnFecharCliente').onclick = () => $('cardCliente').hidden = true;
  function fillCliente(c) {
    $('cNome').value = c ? c.nome : ''; $('cSlug').value = c ? c.slug : ''; $('cHandle').value = c ? c.handle || '' : '';
    $('cAvatar').value = c ? c.avatar_url || '' : ''; $('cBio').value = c ? c.bio || '' : '';
    $('cSquad').value = c ? c.squad_id || '' : (nivel >= 3 ? '' : (squads[0]?.id || ''));
    destFiles = []; renderDest(); $('msgCliente').textContent = '';
    $('cardCliente').dataset.id = c ? c.id : '';
    $('btnExcluirCliente').hidden = !c || nivel < 2;
  }
  $('btnExcluirCliente').onclick = async () => {
    const c = clientes.find(x => x.id === $('cardCliente').dataset.id);
    if (!c || nivel < 2) return;
    const nMeses = c.id === cliente?.id ? meses.length : null;
    const aviso = nMeses === null ? 'todos os meses e posts dele' : nMeses ? `${nMeses > 1 ? `os ${nMeses} meses` : 'o mês'} e todos os posts dele` : 'o cadastro dele';
    const digitado = prompt(`Isso apaga ${c.nome}, ${aviso} e o link do cliente para sempre. Não dá para desfazer.\n\nPara confirmar, digite o nome do cliente:`);
    if (digitado === null) return;
    if (digitado.trim().toLowerCase() !== c.nome.trim().toLowerCase()) return alert('O nome não confere. Nada foi excluído.');
    const { data, error } = await sb.from('clientes').delete().eq('id', c.id).select('id');
    if (error || !data?.length) return alert(error?.message || 'Você não tem permissão para excluir este cliente.');
    localStorage.removeItem('adm_cliente_' + agencia.id);
    $('cardCliente').hidden = true;
    await loadClientes();
  };
  $('btnSalvarCliente').onclick = async () => {
    const id = $('cardCliente').dataset.id;
    const row = { agencia_id: agencia.id, nome: $('cNome').value.trim(), slug: $('cSlug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'), handle: $('cHandle').value.trim(), avatar_url: $('cAvatar').value.trim() || null, bio: $('cBio').value.trim(), squad_id: $('cSquad').value || null };
    if (!row.nome || !row.slug) { $('msgCliente').textContent = 'Nome e slug são obrigatórios.'; $('msgCliente').className = 'msg err'; return; }
    const q = id ? sb.from('clientes').update(row).eq('id', id).select(COLS).single() : sb.from('clientes').insert(row).select(COLS).single();
    const { data, error } = await q;
    if (error) { $('msgCliente').textContent = error.message; $('msgCliente').className = 'msg err'; return; }
    if (destFiles.length) {
      const { data: ex } = await sb.from('destaques').select('ordem').eq('cliente_id', data.id);
      let ordem = ex ? ex.length : 0;
      await run(sb.from('destaques').insert(destFiles.map(d => ({ cliente_id: data.id, nome: d.nome, capa_url: d.url, ordem: ordem++ }))));
    }
    $('msgCliente').textContent = 'Salvo.'; $('msgCliente').className = 'msg ok';
    localStorage.setItem('adm_cliente_' + agencia.id, data.id);
    $('cardCliente').hidden = true;
    await loadClientes();
  };
  $('btnEditarCliente').onclick = () => $('titulo').onclick();
  $('titulo').onclick = () => { if (cliente && nivel >= 2) { verEquipe(false); fillCliente(cliente); $('cardCliente').hidden = false; mostrar('cardCliente'); } };

  dropzone($('dropAvatar'), async fl => {
    const url = await upload(fl[0], `clientes/${$('cSlug').value || 'novo'}/avatar`);
    if (url) $('cAvatar').value = url;
  });
  dropzone($('dropDest'), async fl => {
    for (const f of fl) {
      const url = await upload(f, `clientes/${$('cSlug').value || 'novo'}/destaques`);
      if (url) destFiles.push({ nome: f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), url });
    }
    renderDest();
  });
  function renderDest() {
    $('thumbsDest').innerHTML = destFiles.map((d, i) => `<div><img src="${esc(MEDIA.url(d.url))}"><small>${esc(d.nome)}</small><button data-i="${i}">×</button></div>`).join('');
    $('thumbsDest').querySelectorAll('button').forEach(b => b.onclick = () => { destFiles.splice(+b.dataset.i, 1); renderDest(); });
  }

  /* ---------- mês ---------- */
  $('btnNovoMes').onclick = () => {
    verEquipe(false);
    if (!cliente) return alert('Crie um cliente primeiro.');
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    $('mAnoMes').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    $('mTitulo').value = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase()).replace(' de ', ' ');
    $('mIntro').value = ''; $('msgMes').textContent = ''; $('cardMes').hidden = false; mostrar('cardMes');
  };
  $('btnFecharMes').onclick = () => $('cardMes').hidden = true;
  $('btnExcluirMes').onclick = async () => {
    if (!mes || nivel < 2) return;
    const n = posts.length;
    if (!confirm(`Excluir o mês "${mes.titulo}" de ${cliente.nome}${n ? ` e os ${n} post${n > 1 ? 's' : ''} dele` : ''}? Não dá para desfazer.`)) return;
    const { data, error } = await sb.from('meses').delete().eq('id', mes.id).select('id');
    if (error || !data?.length) return alert(error?.message || 'Você não tem permissão para excluir este mês.');
    await selectCliente(cliente.id);
  };
  $('btnSalvarMes').onclick = async () => {
    const row = { cliente_id: cliente.id, ano_mes: $('mAnoMes').value.trim(), titulo: $('mTitulo').value.trim(), intro: $('mIntro').value.trim() || null };
    if (!/^\d{4}-\d{2}$/.test(row.ano_mes) || !row.titulo) { $('msgMes').textContent = 'Use o formato 2026-10 e um título.'; $('msgMes').className = 'msg err'; return; }
    const { data, error } = await sb.from('meses').insert(row).select().single();
    if (error) { $('msgMes').textContent = error.message; $('msgMes').className = 'msg err'; return; }
    $('cardMes').hidden = true;
    await selectCliente(cliente.id); $('selMes').value = data.id; await selectMes(data.id);
  };

  /* ---------- upload ---------- */
  // As artes novas vão para o depósito na Cloudflare (10 GB). As antigas seguem no Supabase.
  async function upload(file, folder) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$|^video\/mp4$/.test(file.type)) { alert('Use JPG, PNG, WebP, GIF ou MP4.'); return null; }
    if (file.size > 50 * 1024 * 1024) { alert('O limite é 50 MB por arquivo.'); return null; }
    try {
      const { data: { session } } = await sb.auth.getSession();
      const pedido = await fetch(cfg.SUPABASE_URL + '/functions/v1/midia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ acao: 'enviar', agencia_id: agencia.id, ext })
      });
      const j = await pedido.json().catch(() => ({}));
      if (!pedido.ok || j.error || !j.envio) throw new Error(j.error || 'Não foi possível preparar o envio.');
      const envio = await fetch(j.envio, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!envio.ok) {
        const detalhe = await envio.json().catch(() => ({}));
        throw new Error(detalhe.error || `O arquivo não subiu (${envio.status}).`);
      }
      MEDIA.guardar(j.ref, j.leitura);
      return j.ref;
    } catch (e) {
      alert('Upload falhou: ' + (e.message || 'tente de novo.'));
      return null;
    }
  }
  function dropzone(el, onFiles) {
    let busy=false;
    const receive=async fl=>{
      if(busy||!fl.length)return;busy=true;
      const controls=['selAgencia','selCliente','selMes','btnSalvarCliente','btnSalvarPost','btnNovoCliente','btnNovoMes','btnLimpar'];
      controls.forEach(id=>$(id).disabled=true);
      try{await onFiles(fl);}finally{busy=false;controls.forEach(id=>$(id).disabled=false);}
    };
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); receive([...e.dataTransfer.files]); });
    el.addEventListener('click', () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,video/mp4';
      inp.onchange = () => receive([...inp.files]); inp.click();
    });
  }

  /* ---------- post ---------- */
  dropzone($('drop'), async fl => {
    fl.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    $('msgPost').textContent = `Enviando ${fl.length} arquivo(s)…`; $('msgPost').className = 'msg';
    for (const f of fl) {
      const url = await upload(f, `${cliente.slug}/${mes.ano_mes}`);
      if (url) files.push({ url, kind: f.type.startsWith('video') ? 'video' : 'image', name: f.name });
    }
    $('msgPost').textContent = ''; renderThumbs();
  });
  function renderThumbs() {
    $('thumbs').innerHTML = files.map((f, i) => `<div>${f.kind === 'video' ? `<video src="${esc(MEDIA.url(f.url))}" muted></video>` : `<img src="${esc(MEDIA.url(f.url))}">`}<small>${f.kind === 'video' ? 'vídeo' : i + 1}</small><button data-i="${i}" title="remover">×</button></div>`).join('');
    $('thumbs').querySelectorAll('button').forEach(b => b.onclick = () => { files.splice(+b.dataset.i, 1); renderThumbs(); });
  }
  function limparPost() {
    editing = null; files = []; renderThumbs();
    ['pNumero', 'pData', 'pTema', 'pTitulo', 'pLegenda'].forEach(id => $(id).value = '');
    $('pTipo').value = 'carousel'; $('pNumero').value = pad(posts.length + 1);
    $('postFormTitle').textContent = 'Novo post'; $('msgPost').textContent = '';
  }
  $('btnLimpar').onclick = limparPost;

  $('btnSalvarPost').onclick = async () => {
    if (!mes) return;
    const tipo = $('pTipo').value;
    const imgs = files.filter(f => f.kind === 'image').map(f => f.url);
    const vid = files.find(f => f.kind === 'video');
    if (tipo === 'reel' && !vid) { $('msgPost').textContent = 'Reel precisa de um .mp4.'; $('msgPost').className = 'msg err'; return; }
    if (tipo !== 'reel' && !imgs.length) { $('msgPost').textContent = 'Envie pelo menos uma imagem.'; $('msgPost').className = 'msg err'; return; }
    const row = {
      mes_id: mes.id, numero: $('pNumero').value.trim() || pad(posts.length + 1), data: $('pData').value.trim() || null,
      tema: $('pTema').value.trim(), titulo: $('pTitulo').value.trim(), tipo, legenda: $('pLegenda').value.trim(),
      slides: tipo === 'reel' ? [] : imgs, video_url: vid ? vid.url : null, capa_url: tipo === 'reel' ? (imgs[0] || null) : null
    };
    if (!editing) row.ordem = posts.length;
    const q = editing ? sb.from('posts').update(row).eq('id', editing) : sb.from('posts').insert(row);
    const { error } = await q;
    if (error) { $('msgPost').textContent = error.message; $('msgPost').className = 'msg err'; return; }
    $('msgPost').textContent = 'Salvo.'; $('msgPost').className = 'msg ok';
    await selectMes(mes.id);
  };

  /* ---------- espaço e limpeza ---------- */
  const LIMITE = 1024 * 1024 * 1024; // 1 GB do plano atual do servidor
  const mb = b => b >= 1024 * 1024 * 1024 ? (b / 1024 / 1024 / 1024).toFixed(2) + ' GB' : Math.round(b / 1024 / 1024) + ' MB';
  let uso = null;
  function verEspaco(abrir) {
    $('cardEspaco').hidden = !abrir;
    document.body.classList.toggle('vendo-espaco', abrir);
    $('btnEspaco').classList.toggle('active', abrir);
    if (abrir) { verEquipe(false); mostrar('cardEspaco'); }
  }
  $('btnEspaco').onclick = async () => { const abrir = $('cardEspaco').hidden; verEspaco(abrir); if (abrir) await carregarEspaco(); };
  $('btnFecharEspaco').onclick = () => verEspaco(false);
  $('diasArquivo').onchange = () => carregarEspaco();
  async function medirEspaco() {
    if (!superadmin) { uso = null; $('avisoEspaco').hidden = true; return null; }
    try { uso = await run(sb.rpc('uso_armazenamento', { p_agencia: agencia.id, p_dias: +$('diasArquivo').value || 90 })); }
    catch { uso = null; }
    const cheio = uso ? uso.bytes_bucket / LIMITE : 0;
    $('avisoEspaco').hidden = !uso || cheio < 0.8;
    if (uso && cheio >= 0.8) $('avisoEspaco').innerHTML = `O servidor está com <b>${mb(uso.bytes_bucket)} de 1 GB</b> em uso. Abra <b>Espaço e limpeza</b> para liberar espaço antes que os envios comecem a falhar.`;
    return uso;
  }
  async function carregarEspaco() {
    $('msgEspaco').textContent = 'Conferindo…'; $('msgEspaco').className = 'msg';
    const u = await medirEspaco();
    if (!u) { $('msgEspaco').textContent = 'Não foi possível medir o espaço agora.'; $('msgEspaco').className = 'msg err'; return; }
    const pct = Math.min(100, Math.round(u.bytes_bucket / LIMITE * 100));
    $('barraUso').style.width = pct + '%';
    $('barraUso').className = pct >= 80 ? 'cheio' : pct >= 60 ? 'meio' : '';
    $('usoResumo').innerHTML = `<div><b>${mb(u.bytes_bucket)}</b><span>de 1 GB no servidor (${pct}%)</span></div>`
      + `<div><b>${mb(u.bytes)}</b><span>desta agência · ${u.arquivos} arquivo(s)</span></div>`
      + `<div><b>${mb(u.bytes_orfaos)}</b><span>${u.orfaos} arquivo(s) sem dono</span></div>`
      + `<div><b>${u.meses_antigos}</b><span>mês(es) fora do prazo</span></div>`;
    $('btnOrfaos').disabled = !u.orfaos;
    $('btnOrfaos').textContent = u.orfaos ? `Apagar ${u.orfaos} arquivo(s) sem dono (${mb(u.bytes_orfaos)})` : 'Nenhum arquivo sem dono';
    let plano = { meses: [] };
    try { plano = await run(sb.rpc('plano_limpeza', { p_agencia: agencia.id, p_dias: +$('diasArquivo').value || 90 })); } catch {}
    $('mesesAntigos').innerHTML = plano.meses.length
      ? `<span class="label">Meses que podem sair do servidor</span>` + plano.meses.map(m => `<div class="imp"><div class="imp-campos"><b>${esc(m.cliente)}</b><span>${esc(m.titulo)}</span><small>${m.arquivos.length} arquivo(s) · criado em ${new Date(m.criado_em).toLocaleDateString('pt-BR')}</small></div><button class="btn sm" data-arq="${m.id}">arquivar</button></div>`).join('')
      : '<p class="hint">Nenhum mês fora do prazo. Nada a arquivar.</p>';
    $('mesesAntigos').querySelectorAll('[data-arq]').forEach(b => b.onclick = () => arquivar(b.dataset.arq, b));
    $('msgEspaco').textContent = '';
  }
  async function chamarLimpeza(corpo) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(cfg.SUPABASE_URL + '/functions/v1/limpeza', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ agencia_id: agencia.id, ...corpo })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'Não foi possível concluir a limpeza.');
    return j;
  }
  $('btnOrfaos').onclick = async () => {
    if (!uso?.orfaos) return;
    if (!confirm(`Apagar ${uso.orfaos} arquivo(s) que não estão em nenhum post e liberar ${mb(uso.bytes_orfaos)}? Não dá para desfazer.`)) return;
    $('btnOrfaos').disabled = true; $('msgEspaco').textContent = 'Apagando…'; $('msgEspaco').className = 'msg';
    try { const j = await chamarLimpeza({ acao: 'orfaos' }); $('msgEspaco').textContent = `${j.apagados} arquivo(s) apagados.`; $('msgEspaco').className = 'msg ok'; }
    catch (e) { $('msgEspaco').textContent = e.message; $('msgEspaco').className = 'msg err'; }
    await carregarEspaco();
  };
  async function arquivar(mesId, botao) {
    if (!confirm('Arquivar este mês tira as artes do servidor e fecha o link do cliente. O post, o tema, a legenda e o histórico continuam no painel. Confirmar?')) return;
    botao.disabled = true; $('msgEspaco').textContent = 'Arquivando…'; $('msgEspaco').className = 'msg';
    try {
      const j = await chamarLimpeza({ acao: 'arquivar', mes_id: mesId, dias: +$('diasArquivo').value || 90 });
      $('msgEspaco').textContent = `Mês arquivado. ${j.apagados} arquivo(s) saíram do servidor.`; $('msgEspaco').className = 'msg ok';
    } catch (e) { $('msgEspaco').textContent = e.message; $('msgEspaco').className = 'msg err'; }
    await carregarEspaco();
    if (cliente) await selectCliente(cliente.id);
  }

  /* ---------- importar a pasta do mês ---------- */
  let importPosts = [];
  $('btnImportPasta').onclick = () => {
    if (!mes) return alert('Escolha ou crie um mês primeiro.');
    verEquipe(false); importPosts = []; renderImport();
    $('msgImport').textContent = ''; $('msgImport').className = 'msg';
    $('cardImport').hidden = false; mostrar('cardImport');
  };
  $('btnFecharImport').onclick = () => { $('cardImport').hidden = true; importPosts = []; renderImport(); };
  $('dropPasta').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.webkitdirectory = true;
    inp.onchange = () => { lerPasta([...inp.files]); };
    inp.click();
  };
  function lerPasta(fl) {
    if (!fl.length) return;
    const { posts: achados, ignorados } = PASTA.analisar(fl.map(f => ({ caminho: f.webkitRelativePath || f.name, nome: f.name, arquivo: f })));
    importPosts = achados.map(p => ({ ...p, usar: true, repetido: posts.some(x => (x.numero || '') === p.numero) }));
    importPosts.forEach(p => { if (p.repetido) p.usar = false; });
    const partes = [];
    partes.push(`${achados.length} post(s) encontrado(s) em ${fl.length} arquivo(s).`);
    if (ignorados.length) partes.push(`${ignorados.length} arquivo(s) fora do padrão foram deixados de lado (${[...new Set(ignorados.map(i => i.motivo))].slice(0, 3).join(', ')}).`);
    if (importPosts.some(p => p.repetido)) partes.push('Os números que já existem neste mês vieram desmarcados.');
    $('msgImport').textContent = partes.join(' ');
    $('msgImport').className = achados.length ? 'msg' : 'msg err';
    renderImport();
  }
  function renderImport() {
    const L = $('importLista');
    $('importAcoes').hidden = !importPosts.length;
    if (!importPosts.length) { L.innerHTML = ''; return; }
    L.innerHTML = importPosts.map((p, i) => `<div class="imp ${p.usar ? '' : 'off'}">
      <label class="check"><input type="checkbox" data-usar="${i}" ${p.usar ? 'checked' : ''}><span>usar</span></label>
      <div class="imp-campos">
        <input data-numero="${i}" value="${esc(p.numero)}" aria-label="Número" size="3">
        <input data-tema="${i}" value="${esc(p.tema)}" aria-label="Tema" placeholder="Tema">
        <input data-data="${i}" value="${esc(p.data || '')}" aria-label="Dia da postagem" placeholder="dia" size="5">
        <select data-tipo="${i}" aria-label="Formato">${Object.entries(TIPO).map(([k, v]) => `<option value="${k}" ${k === p.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="imp-info">
        <small>${p.arquivos.length} arquivo(s) · ${esc(p.origem)}</small>
        ${p.repetido ? '<small class="alerta">número já existe neste mês</small>' : ''}
        ${p.avisos.map(a => `<small class="alerta">${esc(a)}</small>`).join('')}
      </div>
    </div>`).join('');
    L.querySelectorAll('[data-usar]').forEach(c => c.onchange = () => { importPosts[+c.dataset.usar].usar = c.checked; renderImport(); });
    L.querySelectorAll('[data-numero]').forEach(c => c.oninput = () => importPosts[+c.dataset.numero].numero = c.value);
    L.querySelectorAll('[data-tema]').forEach(c => c.oninput = () => importPosts[+c.dataset.tema].tema = c.value);
    L.querySelectorAll('[data-data]').forEach(c => c.oninput = () => importPosts[+c.dataset.data].data = c.value);
    L.querySelectorAll('[data-tipo]').forEach(c => c.onchange = () => importPosts[+c.dataset.tipo].tipo = c.value);
    $('btnImportar').textContent = `Importar ${importPosts.filter(p => p.usar).length} post(s)`;
  }
  $('btnImportar').onclick = async () => {
    const fila = importPosts.filter(p => p.usar);
    if (!mes || !fila.length) return;
    const total = fila.reduce((n, p) => n + p.arquivos.length, 0);
    let feitos = 0, criados = 0;
    $('btnImportar').disabled = true; $('btnFecharImport').disabled = true;
    try {
      for (const p of fila) {
        const enviados = [];
        for (const a of p.arquivos) {
          $('msgImport').textContent = `Enviando ${++feitos} de ${total} arquivo(s)… (post ${p.numero})`;
          $('msgImport').className = 'msg';
          const url = await upload(a.arquivo, `${cliente.slug}/${mes.ano_mes}`);
          if (!url) throw new Error('Um arquivo não subiu. Os posts já criados continuam no mês.');
          enviados.push({ url, video: a.video });
        }
        const imgs = enviados.filter(x => !x.video).map(x => x.url);
        const vid = enviados.find(x => x.video);
        const tipo = vid ? 'reel' : p.tipo === 'reel' ? 'image' : p.tipo;
        const { error } = await sb.from('posts').insert({
          mes_id: mes.id, ordem: posts.length + criados, numero: String(p.numero || '').trim() || null,
          data: (p.data || '').trim() || null, tema: (p.tema || '').trim(), titulo: (p.tema || '').trim(),
          tipo, legenda: '', slides: tipo === 'reel' ? [] : imgs,
          video_url: vid ? vid.url : null, capa_url: tipo === 'reel' ? (imgs[0] || null) : null
        });
        if (error) throw new Error(error.message);
        criados++;
      }
      $('msgImport').textContent = `${criados} post(s) criado(s) na ordem da pasta. Agora preencha tema, dia e legenda de cada um, em "editar", antes de publicar o mês.`;
      $('msgImport').className = 'msg ok';
      importPosts = []; renderImport(); $('cardImport').hidden = true;
      await selectMes(mes.id);
    } catch (e) {
      $('msgImport').textContent = (criados ? `${criados} post(s) criado(s) antes do erro. ` : '') + (e.message || 'Não foi possível importar.');
      $('msgImport').className = 'msg err';
      if (criados) await selectMes(mes.id);
    } finally {
      $('btnImportar').disabled = false; $('btnFecharImport').disabled = false;
    }
  };

  /* ---------- download dos originais ---------- */
  function arquivosPost(p) {
    const lista = p.tipo === 'reel' ? [p.video_url, p.capa_url] : (p.slides || []);
    return lista.filter(Boolean);
  }
  const slugArquivo = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function extensao(ref) {
    const limpo = String(ref).split(/[?#]/)[0];
    const m = limpo.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : 'jpg';
  }
  function salvarBlob(blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  let zipPronto;
  function carregarZip() {
    return zipPronto ||= new Promise((ok, erro) => {
      if (window.JSZip) return ok(window.JSZip);
      const sc = document.createElement('script');
      sc.src = 'js/vendor/jszip.min.js?v=3.10.1';
      sc.onload = () => ok(window.JSZip);
      sc.onerror = () => { zipPronto = null; erro(new Error('Não foi possível preparar o arquivo .zip.')); };
      document.head.appendChild(sc);
    });
  }
  async function baixarPost(p, botao) {
    if (!p) return;
    const refs = arquivosPost(p);
    if (!refs.length) return alert('Este post ainda não tem arquivos.');
    const texto = botao.textContent;
    botao.disabled = true; botao.textContent = 'baixando…';
    try {
      await MEDIA.prepare(sb, refs);
      const base = [slugArquivo(cliente?.nome) || 'cliente', mes?.ano_mes, 'post-' + (slugArquivo(p.numero) || String(posts.indexOf(p) + 1).padStart(2, '0'))].filter(Boolean).join('_');
      const nomes = refs.map((r, i) => {
        if (p.tipo === 'reel') return `${base}_${r === p.video_url ? 'video' : 'capa'}.${extensao(r)}`;
        return refs.length > 1 ? `${base}_${String(i + 1).padStart(2, '0')}.${extensao(r)}` : `${base}.${extensao(r)}`;
      });
      const blobs = await Promise.all(refs.map(async r => {
        const res = await fetch(MEDIA.url(r));
        if (!res.ok) throw new Error('Um dos arquivos não pôde ser baixado (' + res.status + ').');
        return res.blob();
      }));
      if (blobs.length === 1) { salvarBlob(blobs[0], nomes[0]); return; }
      const JSZip = await carregarZip();
      const zip = new JSZip();
      blobs.forEach((b, i) => zip.file(nomes[i], b, { binary: true }));
      salvarBlob(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), base + '.zip');
    } catch (e) {
      alert('Não foi possível baixar: ' + (e.message || 'tente de novo.'));
    } finally {
      botao.disabled = false; botao.textContent = texto;
    }
  }

  function renderLista() {
    $('lista').innerHTML = posts.filter(p=>!$('filterStatus').value || p.status===$('filterStatus').value).map(p => {
      const cover = p.capa_url || (p.slides && p.slides[0]) || '';
      const ret = p.aprovacoes;
      return `<tr>
        <td>${cover ? `<img src="${esc(MEDIA.url(cover))}">` : ''}</td>
        <td>${esc(p.numero)}<br><small style="color:var(--mute)">${esc(p.data || '')}</small></td>
        <td>${esc(p.tema)}<br><small style="color:var(--mute)">${esc((p.titulo || '').replace(/<[^>]+>/g, '')).slice(0, 60)}</small></td>
        <td>${TIPO[p.tipo]}${p.slides && p.slides.length > 1 ? ` · ${p.slides.length}` : ''}</td>
        <td><span class="pill ${p.status}">${STATUS[p.status]}</span></td>
        <td>${ret.length ? `<ul class="hist">${ret.map(a => `<li class="${a.acao}"><b>${a.acao === 'aprovado' ? 'Aprovado' : a.acao === 'ajuste' ? 'Ajuste' : 'Comentário'}</b>${a.autor ? ' · ' + esc(a.autor) : ''} · ${new Date(a.created_at).toLocaleDateString('pt-BR')}${a.comentario ? `<p>${esc(a.comentario)}</p>` : ''}</li>`).join('')}</ul>` : '<small style="color:var(--mute)">—</small>'}</td>
        <td class="row-actions">
          <button data-edit="${p.id}">editar</button>
          ${arquivosPost(p).length ? `<button data-baixar="${p.id}" title="Baixa os arquivos originais, na qualidade em que foram enviados">baixar</button>` : ''}
          ${p.status === 'ajuste' ? `<button data-reset="${p.id}">marcar como ajustado</button>` : ''}
          <button data-up="${p.id}">↑</button><button data-down="${p.id}">↓</button>
          ${nivel >= 2 ? `<button data-del="${p.id}">excluir</button>` : ''}
        </td></tr>`;
    }).join('') || `<tr class="empty-row"><td colspan="7">${mes ? 'Nenhum post neste filtro ainda.' : cliente ? 'Crie um mês para começar a subir posts.' : (nivel < 2 && !clientes.length ? 'Nenhum cliente liberado para você ainda. Fale com o Head do seu squad.' : 'Escolha ou crie um cliente para começar.')}</td></tr>`;

    $('lista').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editPost(b.dataset.edit));
    $('lista').querySelectorAll('[data-baixar]').forEach(b => b.onclick = () => baixarPost(posts.find(p => p.id === b.dataset.baixar), b));
    $('lista').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir este post?')) return;
      await run(sb.from('posts').delete().eq('id', b.dataset.del)); await selectMes(mes.id);
    });
    $('lista').querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
      await run(sb.rpc('marcar_ajustado',{p_post:b.dataset.reset}));
      await selectMes(mes.id);
    });
    const move = async (id, dir) => {
      const i = posts.findIndex(p => p.id === id), j = i + dir; if (j < 0 || j >= posts.length) return;
      const a = posts[i], b = posts[j];
      await run(sb.from('posts').update({ ordem: j }).eq('id', a.id));
      await run(sb.from('posts').update({ ordem: i }).eq('id', b.id));
      await selectMes(mes.id);
    };
    $('lista').querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(b.dataset.up, -1));
    $('lista').querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(b.dataset.down, 1));
  }

  function editPost(id) {
    const p = posts.find(x => x.id === id); if (!p) return;
    editing = id;
    $('pNumero').value = p.numero || ''; $('pData').value = p.data || ''; $('pTema').value = p.tema || '';
    $('pTipo').value = p.tipo; $('pTitulo').value = p.titulo || ''; $('pLegenda').value = p.legenda || '';
    files = [...(p.slides || []).map(u => ({ url: u, kind: 'image' })), ...(p.capa_url ? [{ url: p.capa_url, kind: 'image' }] : []), ...(p.video_url ? [{ url: p.video_url, kind: 'video' }] : [])];
    renderThumbs();
    $('postFormTitle').textContent = `Editando post ${p.numero}`;
    $('cardPost').scrollIntoView({ behavior: 'smooth' });
  }
})();
