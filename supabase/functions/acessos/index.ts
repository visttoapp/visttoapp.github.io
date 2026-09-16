import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
// Mesmo mapa de public.nivel_papel(): 3 dono/sócio · 2 head · 1 equipe. O administrador geral vale 4.
const NIVEL:Record<string,number>={dono:3,socio:3,head:2,designer:1,editor_video:1,social_media:1,gestor_trafego:1};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=async(t:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)))).map(b=>b.toString(16).padStart(2,'0')).join('');
// Senha interna aleatória (ninguém conhece) e código de 6 dígitos para o primeiro acesso.
const senhaAleatoria=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const novoCodigo=()=>String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Método inválido'},405);
 try {
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'');
  if(!bearer)return reply({error:'Entre novamente no painel.'},401);
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:auth,error:authError}=await sb.auth.getUser(bearer);
  if(authError||!auth.user)return reply({error:'Sessão inválida.'},401);
  const {acao,email,agencia_id,papel,nome,usuario_id,squad_id}=await req.json();
  if(typeof agencia_id!=='string'||!UUID.test(agencia_id))return reply({error:'Agência inválida.'},400);
  const {data:agency,error:agencyError}=await sb.from('agencias').select('id,usa_squads').eq('id',agencia_id).maybeSingle();
  if(agencyError||!agency)return reply({error:'Agência inválida.'},400);
  const {data:owner,error:ownerError}=await sb.from('administradores').select('usuario_id').eq('usuario_id',auth.user.id).maybeSingle();
  if(ownerError)return reply({error:'Não foi possível conferir sua permissão.'},400);
  let nivel=owner?4:0;
  if(!owner){
   const {data:membro,error:membroError}=await sb.from('agencia_usuarios').select('papel').eq('agencia_id',agencia_id).eq('usuario_id',auth.user.id).maybeSingle();
   if(membroError)return reply({error:'Não foi possível conferir sua permissão.'},400);
   nivel=membro?NIVEL[membro.papel]||0:0;
  }
  if(nivel<2)return reply({error:'Você não pode gerenciar acessos.'},403);
  // Squads do Head nesta agência (dono, sócio e administrador não dependem de squad).
  const emitirCodigo=async(uid:string)=>{
   const codigo=novoCodigo();
   const {error:e}=await sb.from('convites').upsert({usuario_id:uid,codigo_hash:await hash(uid+':'+codigo),expira_em:new Date(Date.now()+7*864e5).toISOString(),tentativas:0,criado_por:auth.user.id});
   if(e)throw e; return codigo;
  };
  const meusSquads=async()=>{
   const {data,error:e}=await sb.from('squad_membros').select('squad_id, squads!inner(agencia_id)').eq('usuario_id',auth.user.id).eq('squads.agencia_id',agencia_id);
   if(e)throw e; return new Set((data||[]).map((r:any)=>r.squad_id));
  };

  if(acao==='codigo'){
   // Novo código de acesso para alguém abaixo de você, nesta agência. A senha antiga deixa de valer.
   if(typeof usuario_id!=='string'||!UUID.test(usuario_id))return reply({error:'Pessoa inválida.'},400);
   const {data:alvo,error:alvoError}=await sb.from('agencia_usuarios').select('papel').eq('agencia_id',agencia_id).eq('usuario_id',usuario_id).maybeSingle();
   if(alvoError||!alvo||(NIVEL[alvo.papel]||0)>=nivel)return reply({error:'Você não pode redefinir a senha desta pessoa.'},403);
   const {data:alvoAdmin}=await sb.from('administradores').select('usuario_id').eq('usuario_id',usuario_id).maybeSingle();
   if(alvoAdmin)return reply({error:'Você não pode redefinir a senha desta pessoa.'},403);
   if(nivel===2&&agency.usa_squads){
    const meus=await meusSquads();
    const {data:dele,error:deleError}=await sb.from('squad_membros').select('squad_id').eq('usuario_id',usuario_id);
    if(deleError||!(dele||[]).some((r:any)=>meus.has(r.squad_id)))return reply({error:'Você só redefine senhas de quem está no seu squad.'},403);
   }
   if(!owner){
    const {count,error:countError}=await sb.from('agencia_usuarios').select('usuario_id',{count:'exact',head:true}).eq('usuario_id',usuario_id);
    if(countError||count!==1)return reply({error:'Esta conta também é usada em outro lugar. Peça ao administrador geral.'},403);
   }
   const {error:updError}=await sb.auth.admin.updateUserById(usuario_id,{password:senhaAleatoria(),user_metadata:{trocar_senha:true}});
   if(updError)return reply({error:'Não foi possível gerar o código. Tente de novo.'},400);
   return reply({ok:true,codigo:await emitirCodigo(usuario_id)});
  }

  if(typeof email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))return reply({error:'E-mail inválido. Confira se está no formato nome@dominio.com.'},400);
  if(typeof papel!=='string'||!NIVEL[papel])return reply({error:'Escolha um papel válido.'},400);
  if(nome!==undefined&&nome!==null&&(typeof nome!=='string'||nome.length>80))return reply({error:'Nome muito longo.'},400);
  if(NIVEL[papel]>=nivel)return reply({error:'Você não pode criar esse tipo de acesso.'},403);
  if(squad_id!==undefined&&squad_id!==null&&(typeof squad_id!=='string'||!UUID.test(squad_id)))return reply({error:'Squad inválido.'},400);
  if(squad_id&&!agency.usa_squads)return reply({error:'Esta agência não trabalha com squads.'},400);
  if(squad_id){
   const {data:sq,error:sqError}=await sb.from('squads').select('id').eq('id',squad_id).eq('agencia_id',agencia_id).maybeSingle();
   if(sqError||!sq)return reply({error:'Squad inválido.'},400);
  }
  if(nivel===2&&agency.usa_squads&&(!squad_id||!(await meusSquads()).has(squad_id)))return reply({error:'Escolha um dos seus squads.'},403);
  const {data:created,error}=await sb.auth.admin.createUser({email:email.trim().toLowerCase(),password:senhaAleatoria(),email_confirm:true,user_metadata:{trocar_senha:true}});
  if(error||!created.user)return reply({error:owner&&error?.code==='email_exists'?'E-mail já cadastrado. Use Autorizar conta existente.':'Não foi possível criar este login. Se a pessoa já tem conta, use Autorizar conta existente.'},400);
  const {error:membershipError}=await sb.from('agencia_usuarios').insert({agencia_id,usuario_id:created.user.id,papel,nome:typeof nome==='string'&&nome.trim()?nome.trim():null,criado_por:auth.user.id});
  if(membershipError){await sb.auth.admin.deleteUser(created.user.id);return reply({error:'Não foi possível vincular o acesso. Tente novamente.'},400);}
  if(squad_id){
   const {error:squadError}=await sb.from('squad_membros').insert({squad_id,usuario_id:created.user.id});
   if(squadError){await sb.auth.admin.deleteUser(created.user.id);return reply({error:'Não foi possível colocar a pessoa no squad. Tente novamente.'},400);}
  }
  let codigo:string;
  try{codigo=await emitirCodigo(created.user.id);}catch{await sb.auth.admin.deleteUser(created.user.id);return reply({error:'Não foi possível gerar o código de acesso. Tente de novo.'},400);}
  return reply({ok:true,codigo});
 }catch{return reply({error:'Não foi possível concluir.'},400);}
});
