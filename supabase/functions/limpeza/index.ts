import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Apaga arquivos do bucket privado. Quem manda é o dono, o sócio ou o administrador geral:
// a conferência de nível fica nas funções do banco (plano_limpeza e arquivar_mes), chamadas com o token de quem clicou.
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Método inválido'},405);
 try {
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'');
  if(!bearer)return reply({error:'Entre novamente no painel.'},401);
  const url=Deno.env.get('SUPABASE_URL')!;
  const comoUsuario=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${bearer}`}}});
  const servico=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:auth,error:authError}=await servico.auth.getUser(bearer);
  if(authError||!auth.user)return reply({error:'Sessão inválida.'},401);

  const {acao,agencia_id,dias,mes_id}=await req.json();
  if(typeof agencia_id!=='string'||!UUID.test(agencia_id))return reply({error:'Agência inválida.'},400);
  const prazo=Number.isFinite(dias)?Math.max(30,Math.min(3650,Math.trunc(dias))):90;
  if(acao!=='orfaos'&&acao!=='arquivar')return reply({error:'Ação inválida.'},400);

  const {data:plano,error:planoError}=await comoUsuario.rpc('plano_limpeza',{p_agencia:agencia_id,p_dias:prazo});
  if(planoError)return reply({error:planoError.message},403);

  // Apaga no Storage do Supabase ('midia:' e caminhos antigos) e no R2 ('r2:'), cada um pela sua porta.
  const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const base=(Deno.env.get('R2_BASE')||'https://vistto-midia.felipelabmor.workers.dev').replace(/\/+$/,'');
  const apagarR2=async(caminho:string)=>{
   const segredo=Deno.env.get('SIGN_SECRET');
   if(!segredo)throw new Error('Servidor sem segredo configurado.');
   const exp=Math.floor(Date.now()/1000)+300;
   const chave=await crypto.subtle.importKey('raw',new TextEncoder().encode(segredo),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const sig=hex(await crypto.subtle.sign('HMAC',chave,new TextEncoder().encode(`DELETE:${caminho}:${exp}`)));
   const r=await fetch(`${base}/m/${caminho.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`,{method:'DELETE'});
   if(!r.ok)throw new Error('Não foi possível apagar uma arte no R2.');
  };
  const apagar=async(itens:string[])=>{
   const limpa=(x:string)=>x.startsWith('r2:')?x.slice(3):x.startsWith('midia:')?x.slice(6):x;
   const r2:string[]=[],storage:string[]=[];
   for(const item of [...new Set(itens.filter(x=>typeof x==='string'))]){
    const caminho=limpa(item);
    if(!caminho.startsWith(agencia_id+'/'))continue;
    (item.startsWith('r2:')?r2:storage).push(caminho);
   }
   let apagados=0;
   for(let i=0;i<storage.length;i+=100){
    const lote=storage.slice(i,i+100);
    const {error}=await servico.storage.from('midia').remove(lote);
    if(error)throw new Error(error.message);
    apagados+=lote.length;
   }
   for(const caminho of r2){ await apagarR2(caminho); apagados++; }
   return apagados;
  };

  if(acao==='orfaos'){
   const apagados=await apagar(plano.orfaos||[]);
   return reply({ok:true,apagados});
  }

  // arquivar: um mês por chamada quando mes_id vem, senão todos os vencidos
  const meses=(plano.meses||[]).filter((m:{id:string})=>!mes_id||m.id===mes_id);
  if(!meses.length)return reply({ok:true,meses:0,apagados:0});
  let apagados=0,feitos=0;
  for(const m of meses){
   const {error}=await comoUsuario.rpc('arquivar_mes',{p_mes:m.id});
   if(error)return reply({error:error.message,meses:feitos,apagados},403);
   apagados+=await apagar(m.arquivos||[]);
   feitos++;
  }
  return reply({ok:true,meses:feitos,apagados});
 } catch(e) {
  return reply({error:e instanceof Error?e.message:'Falha inesperada.'},400);
 }
});
