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

  const apagar=async(caminhos:string[])=>{
   const limpos=[...new Set(caminhos.filter(c=>typeof c==='string'&&c.startsWith(agencia_id+'/')))];
   let apagados=0;
   for(let i=0;i<limpos.length;i+=100){
    const lote=limpos.slice(i,i+100);
    const {error}=await servico.storage.from('midia').remove(lote);
    if(error)throw new Error(error.message);
    apagados+=lote.length;
   }
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
