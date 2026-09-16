import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const INVALIDO='E-mail ou código inválido. Confira os dados ou peça um novo código ao responsável.';
const hash=async(t:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Método inválido'},405);
 try {
  const {email,codigo,password}=await req.json();
  if(typeof email!=='string'||typeof codigo!=='string'||!/^\d{6}$/.test(codigo.trim()))return reply({error:INVALIDO},400);
  if(typeof password!=='string'||password.length<8)return reply({error:'A senha precisa ter pelo menos 8 caracteres.'},400);
  if(password.length>128)return reply({error:'A senha pode ter no máximo 128 caracteres.'},400);
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data,error}=await sb.rpc('convite_por_email',{p_email:email});
  const c=Array.isArray(data)?data[0]:null;
  if(error||!c||c.tentativas>=5||new Date(c.expira_em).getTime()<Date.now())return reply({error:INVALIDO},400);
  if(await hash(c.usuario_id+':'+codigo.trim())!==c.codigo_hash){
   await sb.from('convites').update({tentativas:c.tentativas+1}).eq('usuario_id',c.usuario_id);
   return reply({error:INVALIDO},400);
  }
  const {error:updError}=await sb.auth.admin.updateUserById(c.usuario_id,{password,user_metadata:{trocar_senha:false}});
  if(updError)return reply({error:/weak|pwned|leak/i.test(updError.message)?'Essa senha é fraca ou já vazou em outro site. Escolha outra.':'Não foi possível criar a senha. Tente outra.'},400);
  await sb.from('convites').delete().eq('usuario_id',c.usuario_id);
  return reply({ok:true});
 } catch {return reply({error:'Não foi possível concluir. Tente de novo.'},400);}
});
