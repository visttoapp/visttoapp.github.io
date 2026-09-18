/* Vistto · resolve as referências de mídia em links temporários.
   'midia:...' (e URLs antigas) vêm do Storage do Supabase.
   'r2:...' vêm do depósito na Cloudflare, por um link assinado que a função "midia" emite. */
window.MEDIA = (() => {
  const cache = new Map();
  const r2 = v => typeof v === 'string' && v.startsWith('r2:');
  function path(v) {
    if (typeof v !== 'string') return null;
    if (v.startsWith('midia:')) return v.slice(6);
    const base = window.CONFIG.SUPABASE_URL + '/storage/v1/object/public/midia/';
    if (v.startsWith(base)) return decodeURIComponent(v.slice(base.length));
    return null;
  }
  const conhecida = v => r2(v) || !!path(v);
  function collect(v, out = new Set()) {
    if (typeof v === 'string' && conhecida(v)) out.add(v);
    else if (Array.isArray(v)) v.forEach(x => collect(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach(x => collect(x, out));
    return out;
  }
  const guardar = (v, url) => cache.set(v, { url, until: Date.now() + 3300000 });
  async function pedirR2(sb, refs) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(window.CONFIG.SUPABASE_URL + '/functions/v1/midia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: window.CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ acao: 'ler', refs })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'Não foi possível abrir as artes.');
    Object.entries(j.urls || {}).forEach(([v, url]) => guardar(v, url));
  }
  return {
    url(v) { return conhecida(v) ? cache.get(v)?.url || '' : v; },
    guardar,
    async prepare(sb, data) {
      const faltando = [...collect(data)].filter(v => !(cache.get(v)?.until > Date.now()));
      if (!faltando.length) return;
      const doR2 = faltando.filter(r2);
      const doStorage = faltando.filter(v => !r2(v));
      await Promise.all([
        doR2.length ? pedirR2(sb, doR2) : null,
        ...doStorage.map(async v => {
          const { data: s, error } = await sb.storage.from('midia').createSignedUrl(path(v), 3600);
          if (error) throw error;
          guardar(v, s.signedUrl);
        })
      ].filter(Boolean));
    }
  };
})();
