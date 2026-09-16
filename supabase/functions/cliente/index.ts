import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply({error:'Método inválido'},405);
  try {
    const {token,mes}=await req.json();
    if(typeof token!=='string'||! /^[a-f0-9]{24,64}$/.test(token))return reply(null);
    if(mes!==null && mes!==undefined && (typeof mes!=='string'||!/^\d{4}-\d{2}$/.test(mes)))return reply({error:'Mês inválido'},400);
    const url=Deno.env.get('SUPABASE_URL')!;
    const sb=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const {data,error}=await sb.rpc('get_mes',{p_token:token,p_ano_mes:mes||null});
    if(error)throw error;
    if(!data)return reply(null);
    const cache=new Map<string,Promise<string>>();
    async function signed(v:string|null) {
      if(!v)return v;
      let path:string;
      if(v.startsWith('midia:'))path=v.slice(6);
      else if(v.startsWith(url+'/storage/v1/object/public/midia/'))path=decodeURIComponent(v.split('/storage/v1/object/public/midia/')[1]);
      else return v;
      if(!cache.has(path))cache.set(path,(async()=>{
        const {data:s,error:e}=await sb.storage.from('midia').createSignedUrl(path,3600);
        if(e)throw e;return s.signedUrl;
      })());
      return cache.get(path)!;
    }
    if(data.cliente) data.cliente.avatar_url=await signed(data.cliente.avatar_url);
    await Promise.all((data.destaques||[]).map(async(d:any)=>{d.capa_url=await signed(d.capa_url);}));
    await Promise.all((data.posts||[]).map(async(p:any)=>{
      p.slides=await Promise.all((p.slides||[]).map(signed));
      p.video_url=await signed(p.video_url);p.capa_url=await signed(p.capa_url);
    }));
    return reply(data);
  } catch {return reply({error:'Não foi possível carregar o conteúdo'},400);}
});
