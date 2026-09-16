window.MEDIA = (()=>{
  const cache=new Map();
  function path(v) {
    if(typeof v!=='string')return null;
    if(v.startsWith('midia:'))return v.slice(6);
    const base=window.CONFIG.SUPABASE_URL+'/storage/v1/object/public/midia/';
    if(v.startsWith(base))return decodeURIComponent(v.slice(base.length));
    return null;
  }
  function collect(v,out=new Set()) {
    if(typeof v==='string' && path(v))out.add(v);
    else if(Array.isArray(v))v.forEach(x=>collect(x,out));
    else if(v && typeof v==='object')Object.values(v).forEach(x=>collect(x,out));
    return out;
  }
  return {
    url(v){return path(v)?cache.get(v)?.url||'':v;},
    async prepare(sb,data){
      await Promise.all([...collect(data)].map(async v=>{
        if(cache.get(v)?.until>Date.now())return;
        const {data,error}=await sb.storage.from('midia').createSignedUrl(path(v),3600);
        if(error)throw error;
        cache.set(v,{url:data.signedUrl,until:Date.now()+3300000});
      }));
    }
  };
})();
