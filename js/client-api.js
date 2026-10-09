window.API = {
  // chave: { token } no link antigo ou { cliente, codigo } no link curto (js/link.js)
  async carregar(chave, alvo) {
    if(!chave||(!chave.token&&!chave.codigo))return null;
    const cfg=window.CONFIG;
    const a=alvo||{};
    const quem=chave.codigo?{curto:{cliente:chave.cliente,codigo:chave.codigo}}:{token:chave.token};
    const response=await fetch(cfg.SUPABASE_URL+'/functions/v1/cliente',{
      method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.SUPABASE_ANON_KEY},
      body:JSON.stringify({...quem,mes:a.m||null,canal:a.canal||null,entrega:a.entrega||null})
    });
    if(!response.ok)throw new Error('Não foi possível abrir o conteúdo. Tente novamente ou peça um novo link.');
    return response.json();
  },
  async responder(token,postId,acao,comentario,autor) {
    const cfg=window.CONFIG;
    const response=await fetch(cfg.SUPABASE_URL+'/rest/v1/rpc/registrar_aprovacao',{
      method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.SUPABASE_ANON_KEY},
      body:JSON.stringify({p_token:token,p_post_id:postId,p_acao:acao,p_comentario:comentario||null,p_autor:autor||null})
    });
    if(!response.ok)throw new Error('Resposta não salva. Confira seu link e tente novamente.');
    return response.json();
  }
};
