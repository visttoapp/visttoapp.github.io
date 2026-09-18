import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT=/^(jpe?g|png|webp|gif|mp4)$/i;
const BASE=(Deno.env.get('R2_BASE')||'https://vistto-midia.felipelabmor.workers.dev').replace(/\/+$/,'');
const HORA=3600;
// Emite o link curto e assinado que o Worker aceita. Quem confere quem pode ver é o banco,
// pelas funções pode_ref (leitura) e pode_enviar (envio), chamadas com o token de quem pediu.
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function assinar(metodo:string,caminho:string,exp:number){
 const chave=await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('SIGN_SECRET')!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',chave,new TextEncoder().encode(`${metodo}:${caminho}:${exp}`)));
}
export async function link(metodo:string,caminho:string,segundos=HORA){
 const exp=Math.floor(Date.now()/1000)+segundos;
 return `${BASE}/m/${caminho.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${await assinar(metodo,caminho,exp)}`;
}
const caminhoDe=(ref:string)=>typeof ref==='string'&&ref.startsWith('r2:')?ref.slice(3):null;

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Método inválido'},405);
 if(!Deno.env.get('SIGN_SECRET'))return reply({error:'Servidor sem segredo configurado.'},500);
 try {
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'');
  if(!bearer)return reply({error:'Entre novamente no painel.'},401);
  const url=Deno.env.get('SUPABASE_URL')!;
  const sb=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${bearer}`}}});
  const {acao,refs,agencia_id,ext}=await req.json();

  if(acao==='ler'){
   if(!Array.isArray(refs)||!refs.length||refs.length>200)return reply({error:'Lista inválida.'},400);
   const saida:Record<string,string>={};
   for(const ref of [...new Set(refs)] as string[]){
    const caminho=caminhoDe(ref);
    if(!caminho||caminho.includes('..'))continue;
    const {data:ok,error}=await sb.rpc('pode_ref',{v:ref});
    if(error)return reply({error:error.message},403);
    if(ok)saida[ref]=await link('GET',caminho);
   }
   return reply({urls:saida});
  }

  if(acao==='enviar'){
   if(typeof agencia_id!=='string'||!UUID.test(agencia_id))return reply({error:'Agência inválida.'},400);
   if(typeof ext!=='string'||!EXT.test(ext))return reply({error:'Formato não aceito.'},400);
   const {data:ok,error}=await sb.rpc('pode_enviar',{p_agencia:agencia_id});
   if(error)return reply({error:error.message},403);
   if(!ok)return reply({error:'Você não pode enviar arquivos nesta agência.'},403);
   const caminho=`${agencia_id}/${crypto.randomUUID()}.${ext.toLowerCase()}`;
   return reply({ref:`r2:${caminho}`,envio:await link('PUT',caminho,900),leitura:await link('GET',caminho)});
  }

  return reply({error:'Ação inválida.'},400);
 } catch(e) {
  return reply({error:e instanceof Error?e.message:'Falha inesperada.'},400);
 }
});
