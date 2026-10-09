/* Vistto · link curto do cliente: visttoapp.github.io/c#prime-plus/k7f3q2m9/outubro-2026
   O nome do cliente e o mês ficam legíveis; o código de 8 letras é a chave (sem ele não abre nada).
   O link antigo, #t=<token>&m=..., continua valendo. Coberto por tests/link.mjs. */
window.LINK = (() => {
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const CODIGO = /^[a-z2-9]{8}$/;   // sem 0, 1, i, l e o, que se confundem ao ditar
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // '2026-10' e 'linkedin' → 'linkedin-outubro-2026'
  function mesParaTexto(anoMes, canal) {
    const [a, m] = String(anoMes || '').split('-');
    if (!a || !MESES[+m - 1]) return '';
    return `${canal === 'linkedin' ? 'linkedin-' : ''}${MESES[+m - 1]}-${a}`;
  }
  // 'linkedin-outubro-2026', 'outubro-2026', 'out-26' ou 'março-2027' → { m: 'AAAA-MM', canal }
  function textoParaMes(texto) {
    let t = semAcento(texto), canal = null;
    if (t === 'linkedin') return { m: null, canal: 'linkedin' };
    if (t.startsWith('linkedin-')) { canal = 'linkedin'; t = t.slice(9); }
    const r = t.match(/^([a-z]+)-?(\d{4}|\d{2})$/);
    const i = r ? MESES.findIndex(n => n === r[1] || (r[1].length >= 3 && n.startsWith(r[1]))) : -1;
    if (i < 0) return { m: null, canal };
    const ano = r[2].length === 2 ? 2000 + +r[2] : +r[2];
    return { m: `${ano}-${String(i + 1).padStart(2, '0')}`, canal };
  }
  // O que veio depois do #: { token, m, canal, entrega } no link antigo, { cliente, codigo, m, canal } no curto, ou null.
  function ler(hash) {
    const h = String(hash || '').replace(/^#/, '');
    if (/(^|&)t=/.test(h)) {
      const p = new URLSearchParams(h);
      return { token: p.get('t') || '', m: p.get('m'), canal: p.get('k'), entrega: p.get('e') };
    }
    let partes;
    try { partes = h.split('/').map(x => decodeURIComponent(x).trim().toLowerCase()); } catch (e) { return null; }
    const [cliente, codigo, mes] = partes;
    if (!SLUG.test(cliente || '') || !CODIGO.test(codigo || '')) return null;
    return { cliente, codigo, ...(mes ? textoParaMes(mes) : { m: null, canal: null }) };
  }
  // Link curto pronto para copiar. null quando o cliente não tem código ou o identificador foge do padrão.
  function montar(base, slug, codigo, anoMes, canal) {
    if (!SLUG.test(slug || '') || !CODIGO.test(codigo || '')) return null;
    const mes = anoMes ? mesParaTexto(anoMes, canal) : '';
    return `${base}#${slug}/${codigo}${mes ? '/' + mes : ''}`;
  }
  return { mesParaTexto, textoParaMes, ler, montar, SLUG, CODIGO };
})();
