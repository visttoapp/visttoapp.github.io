(function () {
  const cfg = window.CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const pad = n => String(n == null ? '' : n).padStart(2, '0');
  const STATUS = { pendente: 'Aguardando', aprovado: 'Aprovado', ajuste: 'Ajuste' };
  const TIPO = { carousel: 'Carrossel', image: 'Imagem', reel: 'Reel', texto: 'Texto' };
  const TIPO_FEED = { carousel: 'Carrossel', image: 'Imagem única', reel: 'Reel (vídeo)' };
  const TIPO_LINKEDIN = { image: 'Imagem', carousel: 'Carrossel (várias imagens)', reel: 'Vídeo' };
  // Canais de posts. Meta Ads e Google Ads saíram: as campanhas antigas ficam no banco, fora do painel.
  const CANAIS = { instagram: 'Instagram', linkedin: 'LinkedIn' };
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
  const { aviso, confirmar } = UI;
  window.addEventListener('unhandledrejection', e => { e.preventDefault(); aviso('Não foi possível concluir: ' + (e.reason?.message || 'tente novamente.'), 'erro'); });
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
  let clientes = [], meses = [], todosMeses = [], posts = [], cliente = null, mes = null;
  let canal = 'instagram';
  let files = [];          // arquivos do post em edição [{file, url, kind}]
  let editing = null;      // post em edição (id) ou null
  let destFiles = [];      // {nome, url}
  let temPauta = null;     // o banco já tem responsável, revisão interna e gaveta (supabase/pauta.sql)?
  let membros = [];        // equipe da agência, para escolher o responsável
  let contagens = new Map();   // mes_id → quantos posts em cada etapa, para as entregas
  let mesPreferido = null; // mês a abrir quando o cliente carregar (vindo da visão geral)
  let vendoGeral = false, geral = null, semanaPauta = null, ultimaBusca = 0;
  let vista = (() => { try { return localStorage.getItem('adm_vista') || 'lista'; } catch (e) { return 'lista'; } })();

  async function start() {
    try {
      const ctx=await run(sb.rpc('meu_contexto'));
      agencias=ctx.agencias;superadmin=ctx.superadmin;
      if(!agencias.length){await sb.auth.signOut();$('login').hidden=false;$('app').hidden=true;$('loginMsg').textContent='Seu acesso ainda não foi liberado. Fale com o responsável da sua equipe.';return;}
      $('selAgencia').innerHTML=agencias.map(g=>`<option value="${g.id}">${esc(g.nome)}</option>`).join('');
      $('boxAgencia').hidden=agencias.length<2;
      $('login').hidden=true;
      history.replaceState(null,'','./');
      // Com mais de uma agência, a pessoa escolhe em qual entra antes de carregar qualquer cliente.
      if(agencias.length>1) escolherAgencia(); else await entrarAgencia(agencias[0].id);
      const { data: { user } } = await sb.auth.getUser();
      obrigatorio = !!user?.user_metadata?.trocar_senha;
      document.body.classList.toggle('trocar-senha', obrigatorio);
      if (recuperando || obrigatorio) abrirSenha();
    }catch(e){$('app').hidden=true;$('login').hidden=false;$('loginMsg').textContent='Não foi possível abrir o painel: '+e.message;}
  }

  function escolherAgencia() {
    const ultima = localStorage.getItem('adm_agencia');
    $('escolhaLista').innerHTML = agencias.map(g => `<button class="escolha-item" data-agencia="${g.id}">
      <span><b>${esc(g.nome)}</b><small>${esc(superadmin ? 'Administrador geral' : (PAPEIS[g.papel] || ''))}</small></span>
      ${g.id === ultima ? '<small class="escolha-tag">última usada</small>' : ''}</button>`).join('');
    $('escolhaLista').querySelectorAll('[data-agencia]').forEach(b => b.onclick = () => entrarAgencia(b.dataset.agencia));
    $('app').hidden = true; $('escolha').hidden = false;
  }
  async function entrarAgencia(id) {
    $('escolha').hidden = true; $('app').hidden = false;
    $('selAgencia').value = id;
    try { localStorage.setItem('adm_agencia', id); } catch (e) {}
    await selectAgencia(id);
  }
  $('btnTrocarAgencia').onclick = escolherAgencia;
  $('btnSairEscolha').onclick = () => $('btnLogout').click();

  async function selectAgencia(id) {
    agencia=agencias.find(g=>g.id===id); BRAND.apply(agencia);
    nivel=agencia.nivel||0;
    // clientes, squads, equipe e a checagem da pauta saem juntos, em vez de um esperar o outro
    const pClientes=sb.from('clientes').select(COLS).eq('agencia_id', agencia.id).order('nome');
    const pPauta=temPauta===null?sb.from('posts').select('interno').limit(1):null;
    const pMembros=sb.rpc('membros_agencia',{p_agencia:agencia.id});
    $('meuPapel').textContent=superadmin?'Administrador geral':(PAPEIS[agencia.papel]||'');
    squads=await run(sb.rpc('listar_squads',{p_agencia:agencia.id}));
    const squadOpts=squads.map(q=>`<option value="${q.id}">${esc(q.nome)}</option>`).join('');
    $('cSquad').innerHTML=(nivel>=3?'<option value="">Sem squad (só donos e sócios veem)</option>':'')+squadOpts;
    $('accessSquad').innerHTML=(nivel>=3?'<option value="">Sem squad</option>':'')+squadOpts;
    $('accessSquad').closest('.field').hidden=!agencia.usa_squads||(nivel<3&&!squads.length);
    if(!CANAIS[canal]) canal='instagram';
    $('selCanal').value=canal; rotularCanal();
    $('btnAccess').hidden=nivel<2; $('btnEspaco').hidden=!superadmin; $('btnNovoCliente').hidden=nivel<2||(nivel<3&&agencia.usa_squads&&!squads.length); $('cardLink').hidden=nivel<2;
    const comSquads=!!agencia.usa_squads;
    $('squadsBox').hidden=nivel<3||!comSquads;
    $('cSquad').closest('.field').hidden=!comSquads;
    if(!comSquads){$('accessSquad').closest('.field').hidden=true;$('accessSquad').innerHTML='<option value=""></option>';$('cSquad').innerHTML='<option value=""></option>';}
    $('titulo').style.cursor=nivel>=2?'pointer':''; $('titulo').title=nivel>=2?'Editar cliente':'';
    $('accessPapel').innerHTML=Object.entries(PAPEIS).filter(([k])=>NIVEL[k]<nivel).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
    $('accessPapel').value=nivel>=3?'head':'designer';
    $('cardCliente').hidden=true; $('cardMes').hidden=true; $('accessCard').hidden=true; $('cardEspaco').hidden=true; document.body.classList.remove('vendo-equipe','vendo-espaco'); $('btnAccess').classList.remove('active'); $('cardSenha').hidden=!(recuperando||obrigatorio);
    if(pPauta){const r=await pPauta;temPauta=!r.error;}
    const rm=await pMembros;
    membros=!rm.error?(rm.data||[]):nivel>=2?((await sb.rpc('listar_acessos',{p_agencia:agencia.id})).data||[]).map(m=>({usuario_id:m.usuario_id,nome:m.nome||String(m.email||'').split('@')[0],papel:m.papel})):[];
    $('fldResponsavel').hidden=!temPauta; $('fldInterno').hidden=!temPauta;
    document.querySelectorAll('#filterStatus [data-pauta]').forEach(o=>o.hidden=!temPauta);
    $('pResponsavel').innerHTML='<option value="">Ninguém</option>'+membros.map(m=>`<option value="${m.usuario_id}">${esc(m.nome)}</option>`).join('');
    await loadClientes(pClientes);
    // o espaço é do servidor inteiro, não da agência: mede uma vez por sessão
    if(!espacoMedido){espacoMedido=true;medirEspaco();}
  }
  let espacoMedido=false;
  $('selAgencia').onchange=e=>{try{localStorage.setItem('adm_agencia',e.target.value);}catch(x){}selectAgencia(e.target.value);};
  $('btnRefresh').onclick=()=>vendoGeral?carregarGeral():selectMes(mes?.id);
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
  $('btnRotate').onclick=async()=>{if(!cliente||nivel<2||!await confirmar('O link que o cliente tem hoje deixa de funcionar. Você vai precisar mandar o novo.',{titulo:'Gerar um link novo?',ok:'Gerar link novo',perigo:true}))return;cliente.token=await run(sb.rpc('renovar_link',{p_cliente:cliente.id}));renderTop();};
  // abrir: id do cliente para abrir em seguida (depois de salvar um). Sem ele, fica na visão geral.
  async function loadClientes(pronto, abrir) {
    const { data, error } = await (pronto || sb.from('clientes').select(COLS).eq('agencia_id', agencia.id).order('nome'));
    if (error) return aviso(error.message, 'erro');
    clientes = data;
    const opt = c => `<option value="${c.id}">${esc(c.nome)}</option>`;
    const grupos = squads.map(q => ({ nome: q.nome, itens: clientes.filter(c => c.squad_id === q.id) })).filter(g => g.itens.length);
    const soltos = clientes.filter(c => !squads.some(q => q.id === c.squad_id));
    $('selCliente').innerHTML = !clientes.length ? `<option value="">${nivel >= 2 ? '— crie um cliente —' : '— nenhum cliente liberado —'}</option>`
      : '<option value="">Escolha um cliente…</option>' + (grupos.length ? grupos.map(g => `<optgroup label="${esc(g.nome)}">${g.itens.map(opt).join('')}</optgroup>`).join('') + (soltos.length ? `<optgroup label="Sem squad">${soltos.map(opt).join('')}</optgroup>` : '')
      : clientes.map(opt).join(''));
    if (abrir && clientes.find(c => c.id === abrir)) { $('selCliente').value = abrir; await verGeral(false); await selectCliente(abrir); }
    else { $('selCliente').value = ''; await verGeral(true); }
  }
  $('selCliente').onchange = async e => {
    verEquipe(false); fecharFerramentas(); $('cardMes').hidden = true; $('cardCliente').hidden = true;
    if (!e.target.value) return verGeral(true);
    await verGeral(false); await selectCliente(e.target.value);
  };

  async function selectCliente(id) {
    cliente = clientes.find(c => c.id === id) || null;
    localStorage.setItem('adm_cliente_' + agencia.id, id || '');
    meses = []; mes = null; posts=[]; fecharPost(); contagens = new Map();
    if (!cliente) { $('selMes').innerHTML = ''; renderTop(); renderLista(); renderEntregas(); return; }
    const c = cliente;
    const [data, token] = await Promise.all([
      run(sb.from('meses').select('*').eq('cliente_id', c.id).order('ano_mes', { ascending: false }).order('created_at', { ascending: false })),
      nivel >= 2 && !c.token ? run(sb.rpc('link_cliente', { p_cliente: c.id })) : null
    ]);
    if (token) c.token = token;
    if (cliente !== c) return;   // trocaram de cliente enquanto carregava
    todosMeses = (data || []).filter(m => CANAIS[m.canal || 'instagram']);
    // quantos posts em cada etapa, por mês: um pedido só, para as entregas
    if (todosMeses.length) {
      const { data: st } = await sb.from('posts').select('mes_id,status' + (temPauta ? ',interno' : '')).in('mes_id', todosMeses.map(m => m.id));
      if (cliente !== c) return;
      for (const p of st || []) contar(p);
    }
    await aplicarCanal();
  }
  async function aplicarCanal() {
    rotularCanal();
    meses = todosMeses.filter(m => (m.canal || 'instagram') === canal);
    $('selMes').innerHTML = meses.map(m => `<option value="${m.id}">${esc(m.titulo)}${m.arquivado_em ? ' (arquivado)' : ''}${m.publicado ? '' : ' · rascunho'}</option>`).join('')
      || '<option value="">— crie um mês —</option>';
    if (mesPreferido && meses.some(m => m.id === mesPreferido)) $('selMes').value = mesPreferido;
    mesPreferido = null;
    await selectMes($('selMes').value);
  }
  // Feed e LinkedIn funcionam igual: mês, número, tema, legenda e artes. Muda o nome e os formatos.
  function rotularCanal() {
    document.body.dataset.canal = canal;
    if (!vendoGeral) $('eyebrow').textContent = `Aprovação de conteúdo · ${CANAIS[canal]}`;
    const tipos = canal === 'linkedin' ? TIPO_LINKEDIN : TIPO_FEED;
    const atual = $('pTipo').value;
    $('pTipo').innerHTML = Object.entries(tipos).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('pTipo').value = tipos[atual] ? atual : Object.keys(tipos)[0];
  }
  $('selCanal').onchange = async e => { canal = e.target.value; if (vendoGeral) return; verEquipe(false); fecharFerramentas(); $('cardMes').hidden = true; $('cardCliente').hidden = true; await aplicarCanal(); };
  $('selMes').onchange = e => { verEquipe(false); fecharFerramentas(); selectMes(e.target.value); };

  async function selectMes(id) {
    if ((mes?.id || '') !== (id || '')) fecharPost();   // trocar de mês fecha o formulário; atualizar o mesmo, não
    mes = meses.find(m => m.id === id) || null;
    posts = [];
    if (mes) {
      const m = mes;
      const data = await run(sb.from('posts').select('*, aprovacoes(*)').eq('mes_id', m.id).order('ordem'));
      if (mes !== m) return;   // trocaram de mês enquanto carregava
      posts = (data || []).map(p => ({ ...p, aprovacoes: (p.aprovacoes || []).sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
      ultimaBusca = Date.now();
      contagens.delete(m.id); posts.forEach(contar);   // a contagem deste mês fica igual ao que acabou de chegar
      // a lista aparece já com os textos; as miniaturas chegam em seguida
      renderTop(); renderLista(); renderEntregas();
      try { await MEDIA.prepare(sb, data); } catch (e) { console.warn(e); }
      if (mes === m) renderLista();
      return;
    }
    renderTop(); renderLista(); renderEntregas(); fecharPost();
  }

  function renderTop() {
    $('titulo').textContent = cliente ? `${cliente.nome}${mes ? ' · ' + mes.titulo : ''}` : (nivel >= 2 ? 'Comece criando um cliente' : 'Nenhum cliente liberado');
    $('btnNovoMes').hidden = !cliente;
    $('btnExportar').hidden = !cliente;
    $('btnAjustes').hidden = !mes;
    if (!cliente) fecharFerramentas(); else if (!mes) { $('cardImport').hidden = true; $('cardAjustes').hidden = true; }
    $('btnEditarCliente').hidden = !cliente || nivel < 2;
    $('btnImportPasta').hidden = !mes;
    $('btnExcluirMes').hidden = !mes || nivel < 2;
    $('chkPub').checked = !!(mes && mes.publicado);
    $('chkPub').disabled = !mes || nivel < 2;
    const base = new URL('c',location.href).href;
    const alvo = !mes ? '' : canal === 'instagram' ? '&m=' + mes.ano_mes : '&e=' + mes.id;
    $('linkCliente').textContent = cliente && cliente.token ? `${base}#t=${cliente.token}${alvo}` : '—';
    if (!mes) fecharPost();
    $('btnNovoPost').hidden = !mes;
    $('cardLink').hidden = nivel < 2 || !cliente;
  }
  $('chkPub').onchange = async e => {
    if (!mes) return;
    const { error } = await sb.from('meses').update({ publicado: e.target.checked }).eq('id', mes.id);
    if (error) return aviso(error.message, 'erro');
    mes.publicado = e.target.checked; renderTop();
  };
  $('btnCopy').onclick = async () => { if(!cliente?.token || !mes?.publicado) return aviso('Publique o mês antes de copiar o link.', 'erro'); await navigator.clipboard.writeText($('linkCliente').textContent); $('btnCopy').textContent = 'copiado!'; setTimeout(() => $('btnCopy').textContent = 'copiar link', 1500); };

  /* ---------- cliente ---------- */
  $('btnNovoCliente').onclick = () => { verEquipe(false); fecharFerramentas(); fillCliente(null); $('cardCliente').hidden = false; mostrar('cardCliente'); };
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
    const oQue = nMeses === null ? 'todos os meses e posts dele' : nMeses ? `${nMeses > 1 ? `os ${nMeses} meses` : 'o mês'} e todos os posts dele` : 'o cadastro dele';
    if (!await confirmar(`Isso apaga ${c.nome}, ${oQue} e o link do cliente para sempre. Não dá para desfazer. Para confirmar, digite o nome do cliente.`,
      { titulo: 'Excluir cliente?', ok: 'Excluir cliente', perigo: true, digitar: c.nome })) return;
    const { data, error } = await sb.from('clientes').delete().eq('id', c.id).select('id');
    if (error || !data?.length) return aviso(error?.message || 'Você não tem permissão para excluir este cliente.', 'erro');
    aviso(`${c.nome} foi excluído.`);
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
    aviso(id ? 'Cliente salvo.' : `${data.nome} foi criado.`);
    await loadClientes(null, data.id);
  };
  $('btnEditarCliente').onclick = () => $('titulo').onclick();
  $('titulo').onclick = () => { if (cliente && nivel >= 2) { verEquipe(false); fecharFerramentas(); fillCliente(cliente); $('cardCliente').hidden = false; mostrar('cardCliente'); } };

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
    verEquipe(false); fecharFerramentas();
    if (!cliente) return aviso('Crie um cliente primeiro.', 'erro');
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    $('mAnoMes').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    $('mTitulo').value = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase()).replace(' de ', ' ');
    $('mesFormTitle').textContent = `Novo mês · ${CANAIS[canal]}`;
    $('mesFormHint').textContent = `Cada mês reúne os posts ${canal === 'linkedin' ? 'do LinkedIn' : 'do feed'} que o cliente vai aprovar.`;
    $('mIntro').value = ''; $('msgMes').textContent = ''; $('cardMes').hidden = false; mostrar('cardMes');
  };
  $('btnFecharMes').onclick = () => $('cardMes').hidden = true;
  $('btnExcluirMes').onclick = async () => {
    if (!mes || nivel < 2) return;
    const n = posts.length;
    if (!await confirmar(`O mês "${mes.titulo}" de ${cliente.nome}${n ? ` e ${n > 1 ? `os ${n} posts` : 'o post'} dele` : ''} vão embora. Não dá para desfazer.`,
      { titulo: 'Excluir o mês?', ok: 'Excluir', perigo: true })) return;
    const { data, error } = await sb.from('meses').delete().eq('id', mes.id).select('id');
    if (error || !data?.length) return aviso(error?.message || 'Você não tem permissão para excluir este mês.', 'erro');
    await selectCliente(cliente.id);
  };
  $('btnSalvarMes').onclick = async () => {
    const row = { cliente_id: cliente.id, canal, ano_mes: $('mAnoMes').value.trim(), titulo: $('mTitulo').value.trim(),
      intro: $('mIntro').value.trim() || null };
    if (!/^\d{4}-\d{2}$/.test(row.ano_mes) || !row.titulo) {
      $('msgMes').textContent = 'Use o formato 2026-10 e um título.';
      $('msgMes').className = 'msg err'; return;
    }
    const { data, error } = await sb.from('meses').insert(row).select().single();
    if (error) {
      $('msgMes').textContent = /duplicate|unique/i.test(error.message) ? 'Este cliente já tem um mês com essa data.' : error.message;
      $('msgMes').className = 'msg err'; return;
    }
    $('cardMes').hidden = true;
    await selectCliente(cliente.id); $('selMes').value = data.id; await selectMes(data.id);
  };

  /* ---------- upload ---------- */
  // As artes novas vão para o depósito na Cloudflare (10 GB). As antigas seguem no Supabase.
  async function upload(file, folder) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$|^video\/mp4$/.test(file.type)) { aviso(`${file.name}: use JPG, PNG, WebP, GIF ou MP4.`, 'erro'); return null; }
    if (file.size > 50 * 1024 * 1024) { aviso(`${file.name}: o limite é 50 MB por arquivo.`, 'erro'); return null; }
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
      aviso(`${file.name} não subiu: ` + (e.message || 'tente de novo.'), 'erro');
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
    $('pTipo').value = canal === 'linkedin' ? 'image' : 'carousel';
    $('pNumero').value = pad(posts.length + 1);
    $('postFormTitle').textContent = 'Novo post';
    $('pResponsavel').value = ''; $('pInterno').value = '';
    [...$('pInterno').options].forEach(o => o.disabled = false);
    $('btnExcluirPost').hidden = true;
    $('msgPost').textContent = '';
  }
  // O formulário só aparece quando alguém vai criar ou editar; o resto do tempo a lista fica sozinha.
  function abrirPost(p) {
    if (!mes) return;
    if (!p) limparPost();
    $('cardPost').hidden = false; mostrar('cardPost');
    (p ? $('pTema') : $('pNumero')).focus({ preventScroll: true });
  }
  function fecharPost() { limparPost(); $('cardPost').hidden = true; }
  $('btnNovoPost').onclick = () => { verEquipe(false); fecharFerramentas(); abrirPost(); };
  $('btnLimpar').onclick = fecharPost;
  $('btnFecharPost').onclick = fecharPost;
  $('btnExcluirPost').onclick = async () => {
    const p = posts.find(x => x.id === editing); if (!p || nivel < 2) return;
    if (!await confirmar(`O post ${p.numero || ''} e o histórico de aprovação dele vão embora. Não dá para desfazer.`, { titulo: 'Excluir este post?', ok: 'Excluir', perigo: true })) return;
    const { data, error } = await sb.from('posts').delete().eq('id', p.id).select('id');
    if (error || !data?.length) return aviso(error?.message || 'Você não tem permissão para excluir.', 'erro');
    fecharPost(); aviso(`Post ${p.numero || ''} excluído.`);
    await selectMes(mes.id);
  };

  $('btnSalvarPost').onclick = async () => {
    if (!mes) return;
    const tipo = $('pTipo').value;
    const imgs = files.filter(f => f.kind === 'image').map(f => f.url);
    const vid = files.find(f => f.kind === 'video');
    const erro = t => { $('msgPost').textContent = t; $('msgPost').className = 'msg err'; };
    if (tipo === 'reel' && !vid) return erro(canal === 'linkedin' ? 'Vídeo precisa de um .mp4.' : 'Reel precisa de um .mp4.');
    if (tipo !== 'reel' && !imgs.length) return erro('Envie pelo menos uma imagem.');
    const row = {
      mes_id: mes.id, numero: $('pNumero').value.trim() || pad(posts.length + 1), data: $('pData').value.trim() || null,
      tema: $('pTema').value.trim(), titulo: $('pTitulo').value.trim(), tipo, legenda: $('pLegenda').value.trim(),
      slides: tipo === 'reel' ? [] : imgs, video_url: vid ? vid.url : null, capa_url: tipo === 'reel' ? (imgs[0] || null) : null
    };
    if (temPauta) { row.responsavel = $('pResponsavel').value || null; row.interno = $('pInterno').value || null; }
    if (!editing) row.ordem = posts.length;
    const q = editing ? sb.from('posts').update(row).eq('id', editing) : sb.from('posts').insert(row);
    const { error } = await q;
    if (error) { $('msgPost').textContent = error.message; $('msgPost').className = 'msg err'; return; }
    aviso(`Post ${row.numero} salvo.`);
    fecharPost();
    await selectMes(mes.id);
  };

  /* ---------- espaço e limpeza ---------- */
  const LIMITE_SUPA = 1024 * 1024 * 1024;        // 1 GB do armazenamento antigo (Supabase)
  const LIMITE_R2 = 10 * 1024 * 1024 * 1024;     // 10 GB do depósito das artes novas (Cloudflare)
  const mb = b => b >= 1024 * 1024 * 1024 ? (b / 1024 / 1024 / 1024).toFixed(2) + ' GB' : Math.round(b / 1024 / 1024) + ' MB';
  let uso = null, usoR2 = null;
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
    if (!superadmin) { uso = null; usoR2 = null; $('avisoEspaco').hidden = true; return null; }
    try {
      const j = await chamarLimpeza({ acao: 'uso', dias: +$('diasArquivo').value || 90 });
      uso = j.supabase; usoR2 = j.r2 || null;
    } catch { uso = null; usoR2 = null; }
    const cheioR2 = usoR2 ? usoR2.bytes / LIMITE_R2 : 0;
    const cheioSupa = uso ? uso.bytes_bucket / LIMITE_SUPA : 0;
    const apertado = cheioR2 >= 0.8 || cheioSupa >= 0.8;
    $('avisoEspaco').hidden = !apertado;
    if (apertado) $('avisoEspaco').innerHTML = cheioR2 >= 0.8
      ? `As artes estão ocupando <b>${mb(usoR2.bytes)} de 10 GB</b>. Abra <b>Espaço e limpeza</b> para arquivar meses antigos.`
      : `O armazenamento antigo está com <b>${mb(uso.bytes_bucket)} de 1 GB</b>. Abra <b>Espaço e limpeza</b> e arquive os meses vencidos.`;
    return uso;
  }
  async function carregarEspaco() {
    $('msgEspaco').textContent = 'Conferindo…'; $('msgEspaco').className = 'msg';
    const u = await medirEspaco();
    if (!u) { $('msgEspaco').textContent = 'Não foi possível medir o espaço agora.'; $('msgEspaco').className = 'msg err'; return; }
    const pctR2 = usoR2 ? Math.min(100, Math.round(usoR2.bytes / LIMITE_R2 * 100)) : 0;
    const pctSupa = Math.min(100, Math.round(u.bytes_bucket / LIMITE_SUPA * 100));
    $('barraUso').style.width = (usoR2 ? pctR2 : pctSupa) + '%';
    $('barraUso').className = (usoR2 ? pctR2 : pctSupa) >= 80 ? 'cheio' : (usoR2 ? pctR2 : pctSupa) >= 60 ? 'meio' : '';
    $('usoResumo').innerHTML = (usoR2
        ? `<div><b>${mb(usoR2.bytes)}</b><span>de 10 GB nas artes novas (${pctR2}%) · ${usoR2.arquivos} arquivo(s)</span></div>`
        : `<div><b>—</b><span>não consegui ler o depósito das artes novas</span></div>`)
      + `<div><b>${mb(u.bytes_bucket)}</b><span>de 1 GB no armazenamento antigo (${pctSupa}%)</span></div>`
      + `<div><b>${mb(u.bytes_orfaos)}</b><span>${u.orfaos} arquivo(s) antigos sem dono</span></div>`
      + `<div><b>${u.meses_antigos}</b><span>mês(es) fora do prazo</span></div>`;
    $('btnOrfaos').disabled = false;
    $('btnOrfaos').textContent = u.orfaos
      ? `Procurar e apagar arquivos sem dono (${u.orfaos} antigo(s), ${mb(u.bytes_orfaos)})`
      : 'Procurar e apagar arquivos sem dono';
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
    if (!await confirmar('Vou procurar, nos dois lugares, arquivos que não estão em nenhum post, e apagar o que achar. Não dá para desfazer.', { titulo: 'Apagar arquivos sem dono?', ok: 'Procurar e apagar', perigo: true })) return;
    $('btnOrfaos').disabled = true; $('msgEspaco').textContent = 'Apagando…'; $('msgEspaco').className = 'msg';
    try { const j = await chamarLimpeza({ acao: 'orfaos' }); $('msgEspaco').textContent = `${j.apagados} arquivo(s) apagados.`; $('msgEspaco').className = 'msg ok'; }
    catch (e) { $('msgEspaco').textContent = e.message; $('msgEspaco').className = 'msg err'; }
    await carregarEspaco();
  };
  async function arquivar(mesId, botao) {
    if (!await confirmar('Arquivar apaga as artes deste mês para sempre, dos dois lugares, e fecha o link do cliente. Não dá para desfazer, e o original precisa estar guardado com você. O post, o tema, a legenda e o histórico continuam no painel.', { titulo: 'Arquivar o mês?', ok: 'Arquivar', perigo: true })) return;
    botao.disabled = true; $('msgEspaco').textContent = 'Arquivando…'; $('msgEspaco').className = 'msg';
    try {
      const j = await chamarLimpeza({ acao: 'arquivar', mes_id: mesId, dias: +$('diasArquivo').value || 90 });
      $('msgEspaco').textContent = `Mês arquivado. ${j.apagados} arquivo(s) saíram do servidor.`; $('msgEspaco').className = 'msg ok';
    } catch (e) { $('msgEspaco').textContent = e.message; $('msgEspaco').className = 'msg err'; }
    await carregarEspaco();
    if (cliente) await selectCliente(cliente.id);
  }

  /* ---------- ferramentas do mês: importar, subir ajustes, exportar ---------- */
  // Um quadro aberto por vez; o botão do topo fica marcado enquanto o dele está aberto.
  const FERRAMENTAS = ['cardImport', 'cardAjustes', 'cardExportar'];
  function marcarFerramenta(id) { document.querySelectorAll('[data-painel]').forEach(b => b.classList.toggle('active', b.dataset.painel === id)); }
  function abrirFerramenta(id) {
    verEquipe(false); $('cardCliente').hidden = true; $('cardMes').hidden = true;
    FERRAMENTAS.forEach(f => $(f).hidden = f !== id);
    marcarFerramenta(id); mostrar(id);
  }
  function fecharFerramentas() { FERRAMENTAS.forEach(f => $(f).hidden = true); marcarFerramenta(null); }
  const alternar = (id, abrir) => () => { if (!$(id).hidden) return fecharFerramentas(); abrir(); abrirFerramenta(id); };

  /* ---------- importar a pasta do mês ---------- */
  let importPosts = [];
  $('btnImportPasta').onclick = alternar('cardImport', () => {
    importPosts = []; renderImport();
    $('msgImport').textContent = ''; $('msgImport').className = 'msg';
  });
  $('btnFecharImport').onclick = () => { fecharFerramentas(); importPosts = []; renderImport(); };
  $('dropPasta').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.webkitdirectory = true;
    inp.onchange = () => { lerPasta([...inp.files]); };
    inp.click();
  };
  async function lerPasta(fl) {
    if (!fl.length) return;
    const lista = PASTA.semRaiz(fl.map(f => ({ caminho: f.webkitRelativePath || f.name, nome: f.name, arquivo: f })));
    const { posts: achados, ignorados } = PASTA.analisar(lista);
    // roteiro.txt na pasta: data, tema, título e legenda de cada post, casados pelo número
    const roteiro = PASTA.acharRoteiro(lista);
    let semArte = [], roteiroOk = false;
    if (roteiro) {
      try { semArte = PASTA.aplicarRoteiro(achados, PASTA.lerRoteiro(await roteiro.arquivo.text())); roteiroOk = true; }
      catch (e) { roteiroOk = false; }
    }
    importPosts = achados.map(p => ({ ...p, usar: true, repetido: posts.some(x => (x.numero || '') === p.numero) }));
    importPosts.forEach(p => { if (p.repetido) p.usar = false; });
    const partes = [];
    partes.push(`${achados.length} post(s) encontrado(s) em ${fl.length} arquivo(s).`);
    if (roteiro) partes.push(roteiroOk ? `Textos lidos de "${roteiro.nome}".` : `Não consegui ler "${roteiro.nome}": os textos ficam para preencher.`);
    if (semArte.length) partes.push(`O roteiro tem ${semArte.length > 1 ? 'os posts' : 'o post'} ${semArte.join(', ')} sem arte na pasta.`);
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
        <select data-tipo="${i}" aria-label="Formato">${Object.entries(canal === 'linkedin' ? TIPO_LINKEDIN : TIPO_FEED).map(([k, v]) => `<option value="${k}" ${k === p.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="imp-info">
        <small>${p.arquivos.length} arquivo(s) · ${esc(p.origem)}</small>
        ${p.legenda ? `<small title="${esc(p.legenda)}">legenda: ${esc(p.legenda.slice(0, 70))}${p.legenda.length > 70 ? '…' : ''}</small>` : ''}
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
          data: (p.data || '').trim() || null, tema: (p.tema || '').trim(), titulo: (p.titulo || p.tema || '').trim(),
          tipo, legenda: (p.legenda || '').trim(), slides: tipo === 'reel' ? [] : imgs,
          video_url: vid ? vid.url : null, capa_url: tipo === 'reel' ? (imgs[0] || null) : null
        });
        if (error) throw new Error(error.message);
        criados++;
      }
      $('msgImport').textContent = `${criados} post(s) criado(s) na ordem da pasta. ${fila.every(p => p.legenda) ? 'Confira os textos em "editar" antes de publicar o mês.' : 'Preencha o que faltou (dia e legenda) em "editar" antes de publicar o mês.'}`;
      $('msgImport').className = 'msg ok';
      importPosts = []; renderImport(); fecharFerramentas();
      await selectMes(mes.id);
    } catch (e) {
      $('msgImport').textContent = (criados ? `${criados} post(s) criado(s) antes do erro. ` : '') + (e.message || 'Não foi possível importar.');
      $('msgImport').className = 'msg err';
      if (criados) await selectMes(mes.id);
    } finally {
      $('btnImportar').disabled = false; $('btnFecharImport').disabled = false;
    }
  };

  /* ---------- subir ajustes pela pasta ---------- */
  // Troca as artes de posts que já existem, casando pelo número. Com um roteiro.txt na pasta, troca
  // também tema, título, legenda e data; sem ele, o texto fica. O histórico fica sempre, e as artes
  // antigas viram "sem dono" e saem na limpeza.
  let ajustes = [], previas = [], roteiroAj = null;
  const rotuloPost = p => `Post ${p.numero || '—'}${(p.tema || semTags(p.titulo)) ? ' · ' + (p.tema || semTags(p.titulo)) : ''}`;
  function limparPrevias() { previas.forEach(u => URL.revokeObjectURL(u)); previas = []; }
  function previa(arquivo) { const u = URL.createObjectURL(arquivo); previas.push(u); return u; }
  $('btnAjustes').onclick = alternar('cardAjustes', () => {
    limparPrevias(); ajustes = []; roteiroAj = null; renderAjustes();
    $('msgAjustes').textContent = ''; $('msgAjustes').className = 'msg';
  });
  $('btnFecharAjustes').onclick = () => { fecharFerramentas(); limparPrevias(); ajustes = []; roteiroAj = null; renderAjustes(); };
  $('dropAjustes').onclick = () => {
    if ($('dropAjustes').classList.contains('travado')) return;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.webkitdirectory = true;
    inp.onchange = () => lerAjustes([...inp.files]);
    inp.click();
  };
  async function lerAjustes(fl) {
    if (!fl.length) return;
    limparPrevias();
    const lista = PASTA.prepararAjustes(fl.map(f => ({ caminho: f.webkitRelativePath || f.name, nome: f.name, arquivo: f })), posts.map(p => p.numero));
    const { posts: grupos, ignorados } = PASTA.analisar(lista);
    const roteiro = PASTA.acharRoteiro(lista);
    roteiroAj = null;
    let roteiroOk = false;
    if (roteiro) { try { roteiroAj = PASTA.lerRoteiro(await roteiro.arquivo.text()); roteiroOk = true; } catch (e) { roteiroOk = false; } }
    const usados = new Set();
    ajustes = grupos.map(g => {
      const deduzido = g.avisos.includes('número deduzido da ordem');
      const alvo = deduzido ? null : posts.find(p => PASTA.mesmoNumero(p.numero, g.numero));
      const repetido = !!alvo && usados.has(alvo.id);
      if (alvo) usados.add(alvo.id);
      const capa = g.arquivos.find(a => a.imagem);
      return { grupo: g, alvo: alvo?.id || '', modo: null, previa: capa ? previa(capa.arquivo) : '', repetido,
        usar: !!alvo && !repetido && alvo.status !== 'aprovado' };
    });
    // posts que só ganham texto novo: estão no roteiro, mas sem arte na pasta
    const semPost = [];
    for (const b of roteiroAj ? roteiroAj.values() : []) {
      const p = posts.find(x => PASTA.mesmoNumero(x.numero, b.numero));
      if (!p) { semPost.push(b.numero); continue; }
      if (usados.has(p.id)) continue;
      const a = { grupo: null, alvo: p.id, modo: null, previa: '', repetido: false, usar: p.status !== 'aprovado' };
      if (textoDe(a).nomes.length) ajustes.push(a);
    }
    const partes = [`${grupos.length} conjunto(s) de arte em ${fl.length} arquivo(s).`];
    if (roteiro) partes.push(roteiroOk ? `Textos lidos de "${roteiro.nome}".` : `Não consegui ler "${roteiro.nome}": só as artes mudam.`);
    if (semPost.length) partes.push(`O roteiro tem ${semPost.length > 1 ? 'os números' : 'o número'} ${semPost.join(', ')} sem post neste mês.`);
    const soltos = ajustes.filter(a => !a.alvo).length;
    if (soltos) partes.push(`${soltos} sem post com o mesmo número: escolha o post na lista ou deixe desmarcado.`);
    if (ignorados.length) partes.push(`${ignorados.length} arquivo(s) fora do padrão foram deixados de lado.`);
    $('msgAjustes').textContent = partes.join(' ');
    $('msgAjustes').className = ajustes.length ? 'msg' : 'msg err';
    renderAjustes();
  }
  const planoDe = a => PASTA.planejarAjuste(a.grupo, posts.find(p => p.id === a.alvo), a.modo);
  // o texto segue o post que recebe, pelo número dele no roteiro
  function textoDe(a) {
    const p = posts.find(x => x.id === a.alvo);
    return PASTA.textoAjuste(p && PASTA.blocoDe(roteiroAj, p.numero), p, false);
  }
  const filaAjustes = () => ajustes.filter(a => a.usar && a.alvo && planoDe(a).ok && (a.grupo || textoDe(a).nomes.length));
  function renderAjustes() {
    const L = $('ajustesLista');
    $('ajustesAcoes').hidden = !ajustes.length;
    if (!ajustes.length) { L.innerHTML = ''; return; }
    L.innerHTML = ajustes.map((a, i) => {
      const p = posts.find(x => x.id === a.alvo), plano = planoDe(a), t = textoDe(a);
      const capaAtual = p && (p.capa_url || (p.slides || [])[0]);
      const resumo = plano.ok ? [a.grupo ? plano.texto : '', t.nomes.length ? 'troca ' + t.nomes.join(', ') : a.grupo ? '' : 'o texto já é igual ao do roteiro'].filter(Boolean).join(' · ') : '';
      const avisos = [...(plano.ok ? [...plano.avisos, ...t.avisos] : [plano.erro]),
        ...(a.repetido ? ['outro conjunto já vai para este post'] : []),
        ...(p?.status === 'aprovado' ? ['o cliente já aprovou este post'] : [])];
      const modo = plano.modo || a.modo;
      return `<div class="aj ${a.usar && plano.ok ? '' : 'off'}">
        <label class="check" title="Usar este conjunto"><input type="checkbox" data-aj-usar="${i}" aria-label="Usar" ${a.usar && plano.ok ? 'checked' : ''} ${plano.ok ? '' : 'disabled'}></label>
        <div class="aj-troca" aria-hidden="true">
          <span class="aj-mini">${capaAtual ? `<img src="${esc(MEDIA.url(capaAtual))}" alt="">` : ''}</span>
          <svg class="i" viewBox="0 0 16 16"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5"/></svg>
          <span class="aj-mini nova">${a.previa ? `<img src="${esc(a.previa)}" alt="">` : `<small>${a.grupo ? 'vídeo' : 'texto'}</small>`}${a.grupo && a.grupo.arquivos.length > 1 ? `<b>${a.grupo.arquivos.length}</b>` : ''}</span>
        </div>
        <div class="aj-info">
          <div class="aj-linha">
            <small class="aj-origem" title="${esc(a.grupo ? a.grupo.origem : 'roteiro')}">${esc(a.grupo ? a.grupo.origem.split('/').pop() : 'roteiro')}</small>
            <select data-aj-alvo="${i}" aria-label="Post que recebe estas artes"><option value="">Escolha o post…</option>${posts.map(x => `<option value="${x.id}" ${x.id === a.alvo ? 'selected' : ''}>${esc(rotuloPost(x))}</option>`).join('')}</select>
            ${p ? `<span class="pill ${p.status}">${STATUS[p.status]}</span>` : ''}
          </div>
          ${resumo ? `<p class="aj-plano">${esc(resumo)}</p>` : ''}
          ${plano.podeLaminas ? `<div class="seg" role="group" aria-label="Como trocar"><button type="button" data-aj-modo="${i}|laminas" class="${modo === 'laminas' ? 'on' : ''}">Só estas lâminas</button><button type="button" data-aj-modo="${i}|tudo" class="${modo === 'tudo' ? 'on' : ''}">Carrossel inteiro</button></div>` : ''}
          ${avisos.map(t => `<small class="alerta">${esc(t)}</small>`).join('')}
        </div>
      </div>`;
    }).join('');
    L.querySelectorAll('[data-aj-usar]').forEach(c => c.onchange = () => { ajustes[+c.dataset.ajUsar].usar = c.checked; renderAjustes(); });
    L.querySelectorAll('[data-aj-alvo]').forEach(s => s.onchange = () => {
      const a = ajustes[+s.dataset.ajAlvo]; a.alvo = s.value; a.modo = null; a.repetido = false;
      a.usar = !!a.alvo && planoDe(a).ok; renderAjustes();
    });
    L.querySelectorAll('[data-aj-modo]').forEach(b => b.onclick = () => {
      const [i, m] = b.dataset.ajModo.split('|'), a = ajustes[+i];
      a.modo = m; a.usar = planoDe(a).ok; renderAjustes();
    });
    const n = filaAjustes().length;
    $('btnAplicarAjustes').textContent = n ? `Aplicar ajustes em ${n} post${n > 1 ? 's' : ''}` : 'Nada marcado para aplicar';
    $('btnAplicarAjustes').disabled = !n;
  }
  $('btnAplicarAjustes').onclick = async () => {
    const fila = filaAjustes();
    if (!mes || !fila.length) return;
    const avisar = $('chkAvisar').checked;
    const total = fila.reduce((n, a) => n + planoDe(a).envios.length, 0);
    const textos = new Map(fila.map(a => [a, textoDe(a).campos]));   // antes de o post mudar
    let feitos = 0, trocados = 0;
    const travar = v => { $('btnAplicarAjustes').disabled = v; $('btnFecharAjustes').disabled = v; $('dropAjustes').classList.toggle('travado', v); };
    travar(true);
    try {
      for (const a of fila) {
        const p = posts.find(x => x.id === a.alvo), plano = planoDe(a);
        const refs = [];
        for (const f of plano.envios) {
          $('msgAjustes').textContent = `Enviando ${++feitos} de ${total} arquivo(s)… (${rotuloPost(p)})`; $('msgAjustes').className = 'msg';
          const ref = await upload(f.arquivo, `${cliente.slug}/${mes.ano_mes}`);
          if (!ref) throw new Error('Um arquivo não subiu. Os posts já trocados continuam trocados.');
          refs.push(ref);
        }
        await run(sb.from('posts').update({ ...plano.montar(refs), ...textos.get(a) }).eq('id', p.id));
        if (avisar && p.status !== 'pendente') await run(sb.rpc('marcar_ajustado', { p_post: p.id }));
        trocados++;
        ajustes = ajustes.filter(x => x !== a);   // se algo falhar depois, este não sobe de novo
      }
      limparPrevias(); ajustes = []; roteiroAj = null; renderAjustes();
      await selectMes(mes.id);
      $('msgAjustes').textContent = `Pronto: ${trocados} post(s) atualizado(s).${avisar ? ' Os que tinham retorno do cliente voltaram para Aguardando.' : ''}`;
      $('msgAjustes').className = 'msg ok';
    } catch (e) {
      $('msgAjustes').textContent = (trocados ? `${trocados} post(s) trocado(s) antes do erro. ` : '') + (e.message || 'Não foi possível subir os ajustes.');
      $('msgAjustes').className = 'msg err';
      if (trocados) await selectMes(mes.id);
    } finally { travar(false); renderAjustes(); }
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
    if (!refs.length) return aviso('Este post ainda não tem arquivos.', 'erro');
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
      aviso('Não foi possível baixar: ' + (e.message || 'tente de novo.'), 'erro');
    } finally {
      botao.disabled = false; botao.textContent = texto;
    }
  }

  /* ---------- exportar retornos em PDF ---------- */
  // Monta um relatório só para impressão e abre a janela do navegador, onde a pessoa escolhe
  // "Salvar como PDF". Lê só o que o banco já deixa essa pessoa ver: nada muda de permissão.
  const ACAO = { aprovado: 'Aprovado', ajuste: 'Ajuste pedido', comentario: 'Comentário' };
  const semTags = t => String(t || '').replace(/<[^>]+>/g, '');
  const dataHora = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  $('btnExportar').onclick = alternar('cardExportar', () => {
    $('expAlcance').innerHTML = (mes ? `<option value="mes">Este mês: ${esc(mes.titulo)}</option>` : '')
      + `<option value="cliente">Tudo de ${esc(cliente.nome)} (todos os meses)</option>`;
    $('msgExportar').textContent = '';
  });
  $('btnFecharExportar').onclick = fecharFerramentas;
  $('btnGerarPdf').onclick = async () => {
    const b = $('btnGerarPdf'), msg = $('msgExportar');
    b.disabled = true; msg.textContent = 'Juntando os retornos…'; msg.className = 'msg';
    try {
      await gerarRelatorio($('expAlcance').value, $('expFiltro').value);
      msg.textContent = '';
    } catch (e) {
      msg.textContent = 'Não foi possível gerar o PDF: ' + (e.message || 'tente de novo.'); msg.className = 'msg err';
    } finally { b.disabled = false; }
  };

  async function gerarRelatorio(alcance, filtro) {
    const ordemCanal = { instagram: 0, linkedin: 1 };
    const lista = (alcance === 'mes' && mes ? [mes] : [...todosMeses])
      .sort((a, b) => (ordemCanal[a.canal || 'instagram'] - ordemCanal[b.canal || 'instagram']) || b.ano_mes.localeCompare(a.ano_mes));
    if (!lista.length) throw new Error('este cliente ainda não tem mês.');
    const todos = await run(sb.from('posts').select('*, aprovacoes(*)').in('mes_id', lista.map(m => m.id)).order('ordem'));
    const doCliente = p => p.aprovacoes.some(a => (a.origem || 'cliente') === 'cliente');
    const passa = p => filtro === 'todos' || (filtro === 'ajuste' ? p.status === 'ajuste' : doCliente(p));
    const grupos = lista.map(m => ({
      mes: m,
      posts: todos.filter(p => p.mes_id === m.id).map(p => ({ ...p, aprovacoes: (p.aprovacoes || []).sort((x, y) => x.created_at.localeCompare(y.created_at)) })).filter(passa)
    })).filter(g => g.posts.length);
    if (!grupos.length) throw new Error(filtro === 'ajuste' ? 'nenhum post está com ajuste pedido.' : filtro === 'retorno' ? 'o cliente ainda não deixou nenhum retorno aqui.' : 'não há posts para exportar.');

    // miniaturas: capa do reel ou todas as lâminas do carrossel; meses arquivados já não têm arte
    const miniaturas = p => p.tipo === 'reel' ? [p.capa_url].filter(Boolean) : (p.slides || []);
    const refs = grupos.filter(g => !g.mes.arquivado_em).flatMap(g => g.posts.flatMap(miniaturas));
    let semArtes = false;
    try { await MEDIA.prepare(sb, refs); } catch { semArtes = true; }

    const postsTodos = grupos.flatMap(g => g.posts);
    const conta = s => postsTodos.filter(p => p.status === s).length;
    const comentarios = postsTodos.reduce((n, p) => n + p.aprovacoes.filter(a => a.acao !== 'aprovado' && (a.origem || 'cliente') === 'cliente').length, 0);
    const escopo = alcance === 'mes' && mes ? mes.titulo : 'Todos os meses';
    const filtroTxt = { retorno: 'posts com retorno do cliente', ajuste: 'posts com ajuste pedido', todos: 'todos os posts' }[filtro];

    const thumbs = (g, p) => {
      if (p.tipo === 'texto') return '';
      if (g.mes.arquivado_em) return '<p class="rel-aviso">Artes arquivadas: já saíram do servidor.</p>';
      const refsPost = miniaturas(p);
      if (!refsPost.length) return '';
      const varias = refsPost.length > 1;
      return `<div class="rel-thumbs">${refsPost.map((r, i) => {
        const url = MEDIA.url(r);
        const legenda = p.tipo === 'reel' ? 'capa do vídeo' : varias ? `lâmina ${i + 1}` : '';
        return `<figure>${url && !semArtes ? `<img src="${esc(url)}" alt="">` : '<span class="sem-arte">arte indisponível</span>'}${legenda ? `<figcaption>${legenda}</figcaption>` : ''}</figure>`;
      }).join('')}</div>`;
    };
    const historico = p => p.aprovacoes.length
      ? `<ol class="rel-hist">${p.aprovacoes.map(a => {
          const agencia_ = a.origem === 'agencia';
          return `<li class="${esc(a.acao)}${agencia_ ? ' agencia' : ''}"><span class="quem"><b>${agencia_ ? 'Agência' : ACAO[a.acao] || esc(a.acao)}</b>${!agencia_ && a.autor ? ' · ' + esc(a.autor) : ''} · ${dataHora(a.created_at)}</span>${a.comentario ? `<p>${esc(a.comentario)}</p>` : ''}</li>`;
        }).join('')}</ol>`
      : '<p class="rel-vazio">Sem retorno do cliente até agora.</p>';
    const bloco = (g, p) => {
      const nome = p.tema || semTags(p.titulo) || 'Post';
      const detalhes = [TIPO[p.tipo] + (p.tipo === 'carousel' && (p.slides || []).length > 1 ? ` · ${p.slides.length} lâminas` : ''),
        p.data ? 'dia ' + p.data : '', semTags(p.titulo) !== nome ? semTags(p.titulo) : ''].filter(Boolean);
      return `<article class="rel-post">
        <div class="rel-post-head"><div><h3>Post ${esc(p.numero || '')} · ${esc(nome)}</h3><p>${detalhes.map(esc).join(' · ')}</p></div><span class="rel-status ${esc(p.status)}">${STATUS[p.status] || esc(p.status)}</span></div>
        ${thumbs(g, p)}${historico(p)}</article>`;
    };

    document.getElementById('relatorio')?.remove();
    const rel = document.createElement('div');
    rel.id = 'relatorio';
    rel.innerHTML = `<header class="rel-capa"><small>${esc(agencia?.nome || BRAND.NOME)} · retornos do cliente</small><h1>${esc(cliente.nome)}</h1>
        <p>${esc(escopo)} · ${filtroTxt}</p>
        <div class="rel-resumo"><span><b>${postsTodos.length}</b> post(s)</span><span><b>${conta('aprovado')}</b> aprovado(s)</span><span><b>${conta('ajuste')}</b> com ajuste</span><span><b>${conta('pendente')}</b> aguardando</span><span><b>${comentarios}</b> ajuste(s) e comentário(s) escritos</span></div></header>
      ${grupos.map(g => `<section class="rel-mes"><h2>${esc(CANAIS[g.mes.canal || 'instagram'])} · ${esc(g.mes.titulo)}${g.mes.objetivo ? ' · ' + esc(g.mes.objetivo) : ''}</h2>${g.posts.map(p => bloco(g, p)).join('')}</section>`).join('')}
      <footer class="rel-rodape">Gerado em ${dataHora(new Date())} pelo painel ${esc(BRAND.NOME)}.${semArtes ? ' Algumas artes não puderam ser carregadas.' : ''}</footer>`;
    document.body.appendChild(rel);

    // espera as miniaturas carregarem (até 20 s) para não sair PDF com buraco
    $('msgExportar').textContent = 'Carregando as miniaturas…';
    await Promise.race([
      Promise.all([...rel.querySelectorAll('img')].map(img => img.complete ? null : new Promise(ok => {
        img.onload = ok;
        img.onerror = () => { const s = document.createElement('span'); s.className = 'sem-arte'; s.textContent = 'arte indisponível'; img.replaceWith(s); ok(); };
      }))),
      new Promise(ok => setTimeout(ok, 20000))
    ]);

    // o título da página vira o nome sugerido do arquivo PDF
    const tituloAntes = document.title;
    const limpar = () => { document.body.classList.remove('imprimindo'); document.title = tituloAntes; rel.remove(); };
    document.title = `Retornos - ${cliente.nome} - ${escopo}`.replace(/[\\/:*?"<>|]/g, '-');
    document.body.classList.add('imprimindo');
    window.addEventListener('afterprint', limpar, { once: true });
    window.print();
  }

  const ETAPAS = { revisao: 'Revisão interna', pendente: 'Aguardando', ajuste: 'Ajuste', aprovado: 'Aprovado', reserva: 'Gaveta' };
  const nomeMembro = id => (membros.find(m => m.usuario_id === id) || {}).nome || '';
  const iniciais = nome => String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?';
  const avatar = id => id ? `<span class="av" title="${esc(nomeMembro(id))}">${esc(iniciais(nomeMembro(id)))}</span>` : '';
  const etiqueta = p => `<span class="pill ${PAINEL.etapa(p)}">${ETAPAS[PAINEL.etapa(p)] || STATUS[p.status]}</span>`;
  const filtrados = () => posts.filter(p => !$('filterStatus').value || PAINEL.etapa(p) === $('filterStatus').value);
  const nomePost = p => p.tema || semTags(p.titulo);

  function renderLista() {
    $('tabelaPosts').hidden = vista === 'quadro';
    $('quadro').hidden = vista !== 'quadro';
    document.querySelectorAll('[data-vista]').forEach(b => b.classList.toggle('on', b.dataset.vista === vista));
    if (vista === 'quadro') return renderQuadro();
    $('lista').innerHTML = filtrados().map(p => {
      const cover = p.capa_url || (p.slides && p.slides[0]) || '';
      const ret = p.aprovacoes;
      return `<tr class="st-${PAINEL.etapa(p)}">
        <td>${cover && MEDIA.url(cover) ? `<img src="${esc(MEDIA.url(cover))}" alt="">` : '<span class="sem-capa"></span>'}</td>
        <td>${esc(p.numero)}<br><small>${esc(p.data || '')}</small></td>
        <td>${esc(p.tema)}<br><small>${esc(semTags(p.titulo).slice(0, 60))}</small>${p.responsavel ? `<div class="resp">${avatar(p.responsavel)}<small>${esc(nomeMembro(p.responsavel))}</small></div>` : ''}</td>
        <td>${TIPO[p.tipo]}${p.slides && p.slides.length > 1 ? ` · ${p.slides.length}` : ''}</td>
        <td>${etiqueta(p)}</td>
        <td>${ret.length ? `<ul class="hist">${ret.map(a => `<li class="${a.acao}"><b>${a.acao === 'aprovado' ? 'Aprovado' : a.acao === 'ajuste' ? 'Ajuste' : 'Comentário'}</b>${a.autor ? ' · ' + esc(a.autor) : ''} · ${new Date(a.created_at).toLocaleDateString('pt-BR')}${a.comentario ? `<p>${esc(a.comentario)}</p>` : ''}</li>`).join('')}</ul>` : '<small>—</small>'}</td>
        <td class="row-actions">
          <button data-edit="${p.id}">editar</button>
          ${arquivosPost(p).length ? `<button data-baixar="${p.id}" title="Baixa os arquivos originais, na qualidade em que foram enviados">baixar</button>` : ''}
          ${p.status === 'ajuste' && !p.interno ? `<button data-reset="${p.id}">marcar como ajustado</button>` : ''}
          ${p.interno === 'revisao' && nivel >= 2 ? `<button data-liberar="${p.id}">liberar para o cliente</button>` : ''}
          <button data-up="${p.id}" aria-label="Subir na ordem">↑</button><button data-down="${p.id}" aria-label="Descer na ordem">↓</button>
        </td></tr>`;
    }).join('') || `<tr class="empty-row"><td colspan="7">${vazio()}</td></tr>`;
    ligarAcoes($('lista'));
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
  function vazio() {
    return mes ? 'Nenhum post neste filtro ainda.'
      : cliente ? `Crie um mês ${canal === 'linkedin' ? 'de LinkedIn ' : ''}para começar a subir posts.`
      : (nivel < 2 && !clientes.length ? 'Nenhum cliente liberado para você ainda. Fale com o Head do seu squad.' : 'Escolha ou crie um cliente para começar.');
  }
  // Os botões são os mesmos na lista e no quadro.
  function ligarAcoes(raiz) {
    raiz.querySelectorAll('[data-edit]').forEach(b => b.onclick = e => { e.stopPropagation(); editPost(b.dataset.edit); });
    raiz.querySelectorAll('[data-baixar]').forEach(b => b.onclick = e => { e.stopPropagation(); baixarPost(posts.find(p => p.id === b.dataset.baixar), b); });
    raiz.querySelectorAll('[data-reset]').forEach(b => b.onclick = async e => {
      e.stopPropagation(); b.disabled = true;
      await run(sb.rpc('marcar_ajustado', { p_post: b.dataset.reset }));
      aviso('Marcado como ajustado. O cliente vê a nova versão para aprovar.');
      await selectMes(mes.id);
    });
    raiz.querySelectorAll('[data-liberar]').forEach(b => b.onclick = async e => {
      e.stopPropagation(); b.disabled = true;
      await run(sb.from('posts').update({ interno: null }).eq('id', b.dataset.liberar));
      aviso(mes.publicado ? 'Liberado. O cliente já vê este post no link.' : 'Liberado. O cliente vai ver quando o mês for publicado.');
      await selectMes(mes.id);
    });
  }

  // Quadro: uma coluna por etapa. Só mostra; quem muda o status é o cliente.
  function renderQuadro() {
    const lista = filtrados();
    const colunas = ['revisao', 'pendente', 'ajuste', 'aprovado', 'reserva'].filter(k => (k !== 'revisao' && k !== 'reserva') || lista.some(p => PAINEL.etapa(p) === k));
    $('quadro').style.setProperty('--colunas', colunas.length);
    $('quadro').innerHTML = !lista.length ? `<p class="quadro-vazio">${vazio()}</p>` : colunas.map(k => {
      const itens = lista.filter(p => PAINEL.etapa(p) === k);
      return `<section class="coluna c-${k}"><header><span>${ETAPAS[k]}</span><small>${itens.length}</small></header>
        ${itens.map(p => {
          const cover = p.capa_url || (p.slides && p.slides[0]) || '';
          const url = cover && MEDIA.url(cover);
          return `<article class="cartao" data-edit="${p.id}" tabindex="0">
            ${url ? `<img src="${esc(url)}" alt="">` : '<span class="sem-capa"></span>'}
            <div><b>${esc(p.numero || '')}${nomePost(p) ? ' · ' + esc(nomePost(p)) : ''}</b>
              <small>${[TIPO[p.tipo], p.data].filter(Boolean).map(esc).join(' · ')}</small>
              <div class="cartao-pe">${avatar(p.responsavel)}${p.aprovacoes.length ? `<small title="Retornos do cliente">💬 ${p.aprovacoes.filter(a => a.origem !== 'agencia').length}</small>` : ''}
                ${p.status === 'ajuste' && !p.interno ? `<button data-reset="${p.id}">ajustado</button>` : ''}
                ${p.interno === 'revisao' && nivel >= 2 ? `<button data-liberar="${p.id}">liberar</button>` : ''}</div></div>
          </article>`;
        }).join('') || '<p class="coluna-vazia">Nada aqui.</p>'}</section>`;
    }).join('');
    ligarAcoes($('quadro'));
    $('quadro').querySelectorAll('.cartao').forEach(c => c.onkeydown = e => { if (e.key === 'Enter') editPost(c.dataset.edit); });
  }
  document.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => {
    vista = b.dataset.vista;
    try { localStorage.setItem('adm_vista', vista); } catch (e) {}
    renderLista();
  });

  /* ---------- entregas: os meses do cliente como cartões com progresso ---------- */
  function contar(p) {
    const c = contagens.get(p.mes_id) || { total: 0, pendente: 0, ajuste: 0, aprovado: 0, revisao: 0, reserva: 0 };
    const e = PAINEL.etapa(p);
    c[e] = (c[e] || 0) + 1;
    if (e !== 'reserva') c.total++;
    contagens.set(p.mes_id, c);
  }
  function renderEntregas() {
    const el = $('entregas');
    el.hidden = vendoGeral || !cliente;
    if (el.hidden) return;
    el.innerHTML = meses.map(m => {
      const c = contagens.get(m.id) || { total: 0, aprovado: 0, ajuste: 0, pendente: 0, revisao: 0 };
      const pct = c.total ? Math.round(100 * c.aprovado / c.total) : 0;
      const estado = m.arquivado_em ? 'Arquivado' : m.publicado ? (c.total && c.aprovado === c.total ? 'Aprovado' : 'Em aprovação') : 'Rascunho';
      return `<button class="entrega${mes && m.id === mes.id ? ' on' : ''}" data-mes="${m.id}">
        <span class="entrega-topo"><b>${esc(m.titulo)}</b><small class="estado e-${estado === 'Rascunho' ? 'rascunho' : estado === 'Aprovado' ? 'ok' : estado === 'Arquivado' ? 'arquivo' : 'andando'}">${estado}</small></span>
        <span class="progresso" aria-hidden="true"><i style="width:${pct}%"></i></span>
        <small>${c.total ? `${c.aprovado} de ${c.total} aprovados` : 'Nenhum post ainda'}${c.ajuste ? ` · ${c.ajuste} em ajuste` : ''}${c.revisao ? ` · ${c.revisao} em revisão` : ''}</small>
      </button>`;
    }).join('') + `<button class="entrega nova" id="entregaNova"><svg class="i" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>Novo mês</button>`;
    el.querySelectorAll('[data-mes]').forEach(b => b.onclick = () => { verEquipe(false); fecharFerramentas(); $('selMes').value = b.dataset.mes; selectMes(b.dataset.mes); });
    $('entregaNova').onclick = () => $('btnNovoMes').click();
  }

  /* ---------- visão geral da agência ---------- */
  async function verGeral(abrir) {
    vendoGeral = abrir;
    document.body.classList.toggle('vendo-geral', abrir);
    $('geral').hidden = !abrir;
    $('btnGeral').classList.toggle('active', abrir);
    if (abrir) {
      fecharFerramentas(); fecharPost(); $('cardMes').hidden = true;
      cliente = null; mes = null; posts = [];
      if ($('selCliente').querySelector('option[value=""]')) $('selCliente').value = '';
      $('selMes').innerHTML = '';
      renderTop();
      $('eyebrow').textContent = 'Visão geral';
      $('titulo').textContent = agencia ? agencia.nome : '—';
      $('titulo').title = '';
      renderEntregas();
      await carregarGeral();
    } else {
      $('titulo').title = nivel >= 2 ? 'Editar cliente' : '';
      rotularCanal();
    }
  }
  $('btnGeral').onclick = () => { verEquipe(false); verEspaco(false); $('cardCliente').hidden = true; verGeral(true); };

  function opcoesMeses() {
    const atual = PAINEL.mesAtual();
    const lista = []; for (let i = -6; i <= 2; i++) lista.push(PAINEL.somarMeses(atual, i));
    const antes = $('geralMes').value || atual;
    $('geralMes').innerHTML = lista.reverse().map(m => `<option value="${m}">${PAINEL.nomeMes(m)}${m === atual ? ' · este mês' : ''}</option>`).join('');
    $('geralMes').value = lista.includes(antes) ? antes : atual;
  }
  async function carregarGeral() {
    if (!agencia) return;
    if (!$('geralMes').options.length) opcoesMeses();
    const sel = $('geralMes').value;
    const ids = clientes.map(c => c.id);
    $('msgGeral').textContent = '';
    if (!ids.length) { geral = { sel, meses: [], posts: [] }; return renderGeral(); }
    $('geral').classList.add('carregando');
    try {
      // três meses para trás (números de aprovação) e um para frente (pauta da semana que vira o mês)
      const ms = (await run(sb.from('meses').select('*').in('cliente_id', ids).gte('ano_mes', PAINEL.somarMeses(sel, -2)).lte('ano_mes', PAINEL.somarMeses(sel, 1))))
        .filter(m => CANAIS[m.canal || 'instagram']);
      const cols = 'id,mes_id,numero,data,tema,titulo,tipo,status,created_at,slides,capa_url' + (temPauta ? ',responsavel,interno' : '') + ',aprovacoes(acao,origem,created_at)';
      const ps = ms.length ? await run(sb.from('posts').select(cols).in('mes_id', ms.map(m => m.id)).order('ordem')) : [];
      if (!vendoGeral || $('geralMes').value !== sel) return;
      const porMes = new Map(ms.map(m => [m.id, m]));
      geral = { sel, meses: ms, posts: ps.map(p => { const m = porMes.get(p.mes_id); return { ...p, _anoMes: m.ano_mes, _publicadoEm: m.publicado_em, _cliente: m.cliente_id, _mes: m }; }) };
      ultimaBusca = Date.now();
      renderGeral();
    } catch (e) { $('msgGeral').textContent = e.message; $('msgGeral').className = 'msg err'; }
    finally { $('geral').classList.remove('carregando'); }
  }
  $('geralMes').onchange = carregarGeral;
  let abaGeral = 'clientes';
  document.querySelectorAll('#geralAbas [data-aba]').forEach(b => b.onclick = () => { abaGeral = b.dataset.aba; renderGeral(); });

  function renderGeral() {
    if (!geral) return;
    document.querySelectorAll('#geralAbas [data-aba]').forEach(b => { b.classList.toggle('on', b.dataset.aba === abaGeral); b.setAttribute('aria-selected', b.dataset.aba === abaGeral); });
    $('geralClientes').hidden = abaGeral !== 'clientes';
    $('geralPauta').hidden = abaGeral !== 'pauta';
    $('geralAprovacao').hidden = abaGeral !== 'aprovacao';
    $('geralMes').hidden = abaGeral === 'pauta';
    const doMes = geral.posts.filter(p => p._anoMes === geral.sel);
    const porCliente = c => doMes.filter(p => p._cliente === c.id);
    const resumos = clientes.map(c => ({ c, r: PAINEL.resumo(porCliente(c), geral.sel), meses: geral.meses.filter(m => m.cliente_id === c.id && m.ano_mes === geral.sel) }));
    const t = PAINEL.somar(resumos.map(x => x.r));
    const kpi = (n, txt, cls = '') => `<div class="kpi ${cls}"><b>${n}</b><span>${txt}</span></div>`;
    $('geralKpis').innerHTML = kpi(t.total, `posts em ${PAINEL.nomeMes(geral.sel).split(' ')[0].toLowerCase()}`)
      + kpi(t.pendente, 'com o cliente', 'k-pendente') + kpi(t.ajuste, 'em ajuste', 'k-ajuste') + kpi(t.aprovado, 'aprovados', 'k-aprovado')
      + (t.revisao ? kpi(t.revisao, 'em revisão interna', 'k-revisao') : '') + kpi(t.atrasados, 'atrasados', t.atrasados ? 'k-atraso' : '');
    if (abaGeral === 'clientes') renderClientesGeral(resumos);
    if (abaGeral === 'pauta') renderPauta();
    if (abaGeral === 'aprovacao') renderAprovacao();
  }
  function renderClientesGeral(resumos) {
    const nomeMesCurto = PAINEL.nomeMes(geral.sel).split(' ')[0].toLowerCase();
    const ordem = [...resumos].sort((a, b) => (b.r.atrasados - a.r.atrasados) || (b.r.ajuste - a.r.ajuste) || (!!b.meses.length - !!a.meses.length) || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
    $('geralClientes').innerHTML = !ordem.length ? `<p class="vazio-geral">${nivel >= 2 ? 'Nenhum cliente ainda. Use "Novo" na barra lateral para criar o primeiro.' : 'Nenhum cliente liberado para você ainda.'}</p>` : ordem.map(({ c, r, meses: ms }) => {
      const rascunho = ms.some(m => !m.publicado);
      const canais = [...new Set(ms.map(m => CANAIS[m.canal || 'instagram'].split(' ·')[0]))];
      const prox = r.proximo ? r.proximo.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
      return `<button class="cli" data-cli="${c.id}" data-mes="${ms[0] ? ms[0].id : ''}">
        <span class="cli-topo"><span class="cli-av">${esc(iniciais(c.nome))}</span><span class="cli-nome"><b>${esc(c.nome)}</b><small>${ms.length ? canais.join(' · ') : `sem ${nomeMesCurto} ainda`}</small></span>${rascunho ? '<small class="estado e-rascunho">Rascunho</small>' : ''}</span>
        ${ms.length ? `<span class="progresso" aria-hidden="true"><i style="width:${Math.round(100 * r.progresso)}%"></i></span>
        <span class="cli-linha"><small>${r.aprovado} de ${r.total} aprovados</small>${prox ? `<small>próximo ${prox}</small>` : ''}</span>
        <span class="cli-chips">${r.pendente ? `<span class="chip-st pendente">${r.pendente} com o cliente</span>` : ''}${r.ajuste ? `<span class="chip-st ajuste">${r.ajuste} em ajuste</span>` : ''}${r.revisao ? `<span class="chip-st revisao">${r.revisao} em revisão</span>` : ''}${r.atrasados ? `<span class="chip-st atraso">${r.atrasados} atrasado${r.atrasados > 1 ? 's' : ''}</span>` : ''}</span>` : ''}
      </button>`;
    }).join('');
    $('geralClientes').querySelectorAll('[data-cli]').forEach(b => b.onclick = () => abrirCliente(b.dataset.cli, b.dataset.mes));
  }
  async function abrirCliente(id, mesId) {
    const m = mesId && geral && geral.meses.find(x => x.id === mesId);
    if (m && (m.canal || 'instagram') !== canal) { canal = m.canal || 'instagram'; $('selCanal').value = canal; }
    mesPreferido = mesId || null;
    $('selCliente').value = id;
    await verGeral(false);
    await selectCliente(id);
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPauta() {
    if (!semanaPauta) semanaPauta = PAINEL.inicioSemana();
    const seg = semanaPauta, fim = new Date(seg); fim.setDate(fim.getDate() + 6);
    const f = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    $('pautaPeriodo').textContent = `${f(seg)} a ${f(fim)}. Os posts de cada pessoa, pelo dia previsto. Gaveta fica de fora.`;
    const linhas = PAINEL.pauta(geral.posts, seg);
    const hoje = PAINEL.inicioSemana(new Date()).getTime() === seg.getTime() ? (new Date().getDay() + 6) % 7 : -1;
    const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(seg); d.setDate(d.getDate() + i); return d; });
    const nomeCli = id => (clientes.find(c => c.id === id) || {}).nome || '';
    const ordem = [...linhas.keys()].sort((a, b) => (!a) - (!b) || nomeMembro(a).localeCompare(nomeMembro(b), 'pt-BR'));
    const cab = `<div class="pauta-canto"></div>` + dias.map((d, i) => `<div class="pauta-dia${i === hoje ? ' hoje' : ''}"><b>${d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '')}</b><small>${f(d)}</small></div>`).join('');
    $('pautaGrade').innerHTML = !ordem.length ? '<p class="vazio-geral">Nenhum post com data nesta semana.</p>' : cab + ordem.map(k => {
      const nome = k ? nomeMembro(k) || 'Alguém que saiu da equipe' : 'Sem responsável';
      const papel = k ? PAPEIS[(membros.find(m => m.usuario_id === k) || {}).papel] || '' : (temPauta ? 'Escolha no post' : '');
      return `<div class="pauta-pessoa">${k ? `<span class="av">${esc(iniciais(nome))}</span>` : '<span class="av vazio">?</span>'}<span><b>${esc(nome)}</b><small>${esc(papel)}</small></span></div>`
        + linhas.get(k).map((dia, i) => `<div class="pauta-celula${i === hoje ? ' hoje' : ''}">${dia.map(p => `<button class="tarefa t-${PAINEL.etapa(p)}" data-cli="${p._cliente}" data-mes="${p.mes_id}">
            <small>${esc(nomeCli(p._cliente))}</small><b>${esc(p.numero || '')}${p.tema || p.titulo ? ' · ' + esc(p.tema || semTags(p.titulo)) : ''}</b><span class="pill ${PAINEL.etapa(p)}">${ETAPAS[PAINEL.etapa(p)]}</span></button>`).join('')}</div>`).join('');
    }).join('');
    $('pautaGrade').querySelectorAll('[data-cli]').forEach(b => b.onclick = () => abrirCliente(b.dataset.cli, b.dataset.mes));
  }
  const andarSemana = n => { semanaPauta = new Date((semanaPauta || PAINEL.inicioSemana()).getTime()); semanaPauta.setDate(semanaPauta.getDate() + 7 * n); garantirMesPauta(); };
  // a semana pode cair fora dos meses carregados (três para trás, um para frente): aí troca o mês da visão geral
  function garantirMesPauta() {
    const meio = new Date(semanaPauta); meio.setDate(meio.getDate() + 3);
    const alvo = PAINEL.mesAtual(meio);
    const fora = alvo < PAINEL.somarMeses(geral.sel, -2) || alvo > PAINEL.somarMeses(geral.sel, 1);
    if (fora && [...$('geralMes').options].some(o => o.value === alvo)) { $('geralMes').value = alvo; return carregarGeral(); }
    renderPauta();
  }
  $('pautaAntes').onclick = () => andarSemana(-1);
  $('pautaDepois').onclick = () => andarSemana(1);
  $('pautaHoje').onclick = () => { semanaPauta = PAINEL.inicioSemana(); garantirMesPauta(); };

  function renderAprovacao() {
    const limite = PAINEL.somarMeses(geral.sel, -2);
    const janela = geral.posts.filter(p => p._anoMes >= limite && p._anoMes <= geral.sel && !p.interno);
    const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
    const num = v => v == null ? '—' : v.toFixed(1).replace('.', ',').replace(',0', '');
    const linha = (nome, a, cls = '') => `<tr class="${cls}"><td>${nome}</td><td>${a.comRetorno}</td><td>${PAINEL.duracao(a.espera)}</td><td>${num(a.ajustesPorPost)}</td><td>${pct(a.deFirst)}</td></tr>`;
    const porCliente = clientes.map(c => ({ c, a: PAINEL.aprovacao(janela.filter(p => p._cliente === c.id)) })).filter(x => x.a.comRetorno)
      .sort((x, y) => (y.a.espera || 0) - (x.a.espera || 0));
    $('aprovacaoLista').innerHTML = !porCliente.length ? '<tr class="empty-row"><td colspan="5">Nenhum retorno de cliente nestes três meses.</td></tr>'
      : linha('<b>Agência toda</b>', PAINEL.aprovacao(janela), 'total') + porCliente.map(x => linha(`<button class="link-cli" data-cli="${x.c.id}">${esc(x.c.nome)}</button>`, x.a)).join('');
    $('aprovacaoLista').querySelectorAll('[data-cli]').forEach(b => b.onclick = () => abrirCliente(b.dataset.cli, ''));
  }

  // Ao voltar para a aba, busca de novo o que estiver na tela (se passou meio minuto e ninguém está editando).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !agencia || Date.now() - ultimaBusca < 30000) return;
    const ocupado = !$('cardPost').hidden || [...document.querySelectorAll('.ferramenta')].some(f => !f.hidden) || !$('cardCliente').hidden || !$('cardMes').hidden;
    if (ocupado) return;
    if (vendoGeral) carregarGeral(); else if (mes) selectMes(mes.id);
  });

  function editPost(id) {
    const p = posts.find(x => x.id === id); if (!p) return;
    editing = id;
    $('pNumero').value = p.numero || ''; $('pData').value = p.data || ''; $('pTema').value = p.tema || '';
    $('pTipo').value = p.tipo; $('pTitulo').value = p.titulo || ''; $('pLegenda').value = p.legenda || '';
    files = [...(p.slides || []).map(u => ({ url: u, kind: 'image' })), ...(p.capa_url ? [{ url: p.capa_url, kind: 'image' }] : []), ...(p.video_url ? [{ url: p.video_url, kind: 'video' }] : [])];
    renderThumbs();
    $('pResponsavel').value = p.responsavel || ''; $('pInterno').value = p.interno || '';
    // quem não é Head não tira um post da revisão interna (o banco também barra)
    [...$('pInterno').options].forEach(o => o.disabled = !o.value && p.interno === 'revisao' && nivel < 2);
    $('btnExcluirPost').hidden = nivel < 2;
    $('postFormTitle').textContent = `Editando post ${p.numero || ''}`.trim();
    $('msgPost').textContent = '';
    abrirPost(p);
  }
})();
