/* Vistto · contas da visão geral: resumo por cliente, atrasos, pauta da semana e números de aprovação.
   Só recebe dados e devolve números; quem desenha é o admin.js. Coberto por tests/painel.mjs. */
window.PAINEL = (() => {
  const DIA = 86400000;
  const pad = n => String(n).padStart(2, '0');
  const mesAtual = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  function somarMeses(anoMes, n) {
    const [a, m] = anoMes.split('-').map(Number);
    const d = new Date(a, m - 1 + n, 1);
    return mesAtual(d);
  }
  const nomeMes = anoMes => {
    const [a, m] = anoMes.split('-').map(Number);
    const t = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const inicioDoDia = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // "09/10", "9/10/26", "09/10/2026" ou só "09" (dia do próprio mês). O ano vem do mês do post;
  // dezembro com post em "05/01" vira janeiro do ano seguinte.
  function dataDoPost(post, anoMes) {
    const t = String(post && post.data || '').trim();
    if (!t || !anoMes) return null;
    const [ar, mr] = anoMes.split('-').map(Number);
    const m = t.match(/^(\d{1,2})(?:\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?)?\b/);
    if (!m) return null;
    const dia = +m[1], mes = m[2] ? +m[2] : mr;
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    let ano = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ar;
    if (!m[3]) { if (mes - mr > 6) ano--; else if (mr - mes > 6) ano++; }
    const d = new Date(ano, mes - 1, dia);
    return d.getMonth() === mes - 1 ? d : null;
  }

  // Revisão interna e gaveta valem mais que o status do cliente: o cliente nem vê esses posts.
  const etapa = p => p.interno || p.status || 'pendente';

  function resumo(posts, anoMes, hoje = new Date()) {
    const r = { total: 0, pendente: 0, ajuste: 0, aprovado: 0, revisao: 0, reserva: 0, atrasados: 0, proximo: null };
    const dia0 = inicioDoDia(hoje);
    for (const p of posts) {
      const e = etapa(p);
      r[e] = (r[e] || 0) + 1;
      if (e === 'reserva') continue;
      r.total++;
      const d = dataDoPost(p, p._anoMes || anoMes);
      if (!d) continue;
      if (d < dia0 && e !== 'aprovado') r.atrasados++;
      if (d >= dia0 && (!r.proximo || d < r.proximo.data)) r.proximo = { data: d, post: p };
    }
    r.progresso = r.total ? r.aprovado / r.total : 0;
    return r;
  }

  function somar(resumos) {
    const t = { total: 0, pendente: 0, ajuste: 0, aprovado: 0, revisao: 0, reserva: 0, atrasados: 0 };
    for (const r of resumos) for (const k in t) t[k] += r[k] || 0;
    return t;
  }

  // Segunda-feira da semana de uma data.
  function inicioSemana(d = new Date()) {
    const x = inicioDoDia(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  // Pauta: posts da semana por responsável e por dia (0 = segunda). Gaveta fica de fora.
  function pauta(posts, segunda) {
    const fim = new Date(segunda.getTime() + 7 * DIA);
    const linhas = new Map();
    for (const p of posts) {
      if (etapa(p) === 'reserva') continue;
      const d = dataDoPost(p, p._anoMes);
      if (!d || d < segunda || d >= fim) continue;
      const k = p.responsavel || '';
      if (!linhas.has(k)) linhas.set(k, Array.from({ length: 7 }, () => []));
      linhas.get(k)[Math.round((d - segunda) / DIA)].push(p);
    }
    return linhas;
  }

  // Números de aprovação de um conjunto de posts com aprovacoes (acao, origem, created_at).
  // Espera: para cada resposta do cliente (aprovado ou ajuste), o tempo desde o que a fez ficar
  // pendente: a última ação da agência antes dela, a publicação do mês ou a criação do post.
  function aprovacao(posts) {
    const esperas = [];
    let comRetorno = 0, deFirst = 0, ajustes = 0;
    for (const p of posts) {
      const ev = (p.aprovacoes || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const decisoes = ev.filter(a => a.origem !== 'agencia' && (a.acao === 'aprovado' || a.acao === 'ajuste'));
      if (!decisoes.length) continue;
      comRetorno++;
      if (decisoes[0].acao === 'aprovado') deFirst++;
      ajustes += decisoes.filter(a => a.acao === 'ajuste').length;
      let desde = Math.max(Date.parse(p.created_at) || 0, Date.parse(p._publicadoEm) || 0);
      for (const a of ev) {
        const t = Date.parse(a.created_at);
        if (a.origem === 'agencia') { desde = Math.max(desde, t); continue; }
        if (a.acao !== 'aprovado' && a.acao !== 'ajuste') continue;
        if (desde && t >= desde) esperas.push(t - desde);
        desde = 0;   // a próxima resposta só conta depois de outra ação da agência
      }
    }
    esperas.sort((a, b) => a - b);
    const mediana = esperas.length ? (esperas.length % 2 ? esperas[(esperas.length - 1) / 2] : (esperas[esperas.length / 2 - 1] + esperas[esperas.length / 2]) / 2) : null;
    return {
      comRetorno,
      espera: mediana,                                   // em milissegundos, ou null
      ajustesPorPost: comRetorno ? ajustes / comRetorno : null,
      deFirst: comRetorno ? deFirst / comRetorno : null   // fração aprovada sem nenhum ajuste antes
    };
  }

  function duracao(ms) {
    if (ms == null) return '—';
    const h = ms / 3600000;
    if (h < 1) return 'menos de 1 h';
    if (h < 24) return `${Math.round(h)} h`;
    const d = h / 24;
    return `${d < 10 ? d.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(d)} dia${d >= 1.95 ? 's' : ''}`;
  }

  return { mesAtual, somarMeses, nomeMes, dataDoPost, etapa, resumo, somar, inicioSemana, pauta, aprovacao, duracao };
})();
