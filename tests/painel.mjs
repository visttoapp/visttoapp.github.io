import fs from 'node:fs';
import assert from 'node:assert/strict';

// carrega js/painel.js num "window" de mentira
const window = {};
new Function('window', fs.readFileSync(new URL('../js/painel.js', import.meta.url), 'utf8'))(window);
const P = window.PAINEL;
let checks = 0; const ok = () => checks++;
const ymd = d => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// meses
assert.equal(P.mesAtual(new Date(2026, 9, 9)), '2026-10'); ok();
assert.equal(P.somarMeses('2026-01', -2), '2025-11'); ok();
assert.equal(P.somarMeses('2026-11', 3), '2027-02'); ok();
assert.equal(P.nomeMes('2026-10'), 'Outubro 2026'); ok();

// data do post: texto livre, ano vem do mês
const dt = (data, anoMes) => ymd(P.dataDoPost({ data }, anoMes));
assert.equal(dt('09/10', '2026-10'), '2026-10-09'); ok();
assert.equal(dt('9/10/27', '2026-10'), '2027-10-09'); ok();
assert.equal(dt('09.10.2026', '2026-10'), '2026-10-09'); ok();
assert.equal(dt('15', '2026-10'), '2026-10-15'); ok();
assert.equal(dt('05/01', '2026-12'), '2027-01-05'); ok();     // virada de ano
assert.equal(dt('28/12', '2027-01'), '2026-12-28'); ok();
assert.equal(dt('seg 09/10', '2026-10'), null); ok();     // não começa com número: não chuta
assert.equal(dt('31/02', '2026-02'), null); ok();
assert.equal(dt('', '2026-10'), null); ok();

// etapa: revisão interna e gaveta valem mais que o status
assert.equal(P.etapa({ status: 'pendente', interno: 'revisao' }), 'revisao'); ok();
assert.equal(P.etapa({ status: 'ajuste', interno: null }), 'ajuste'); ok();

// resumo de um cliente no mês
const hoje = new Date(2026, 9, 9, 15);
const posts = [
  { status: 'aprovado', data: '02/10' },
  { status: 'pendente', data: '05/10' },                     // atrasado
  { status: 'ajuste', data: '08/10' },                       // atrasado
  { status: 'pendente', data: '09/10' },                     // hoje: não atrasou
  { status: 'pendente', data: '20/10', interno: 'revisao' },
  { status: 'pendente', data: '01/10', interno: 'reserva' }, // gaveta não conta
  { status: 'aprovado', data: '' }
];
let r = P.resumo(posts, '2026-10', hoje);
assert.equal(r.total, 6); ok();
assert.equal(r.aprovado, 2); ok();
assert.equal(r.atrasados, 2); ok();
assert.equal(r.revisao, 1); ok();
assert.equal(r.reserva, 1); ok();
assert.equal(ymd(r.proximo.data), '2026-10-09'); ok();
assert.equal(r.progresso, 2 / 6); ok();
const t = P.somar([r, P.resumo([{ status: 'ajuste', data: '01/10' }], '2026-10', hoje)]);
assert.equal(t.total, 7); ok();
assert.equal(t.atrasados, 3); ok();
assert.equal(P.resumo([], '2026-10', hoje).progresso, 0); ok();

// semana começa na segunda
assert.equal(ymd(P.inicioSemana(new Date(2026, 9, 9))), '2026-10-05'); ok();   // sexta
assert.equal(ymd(P.inicioSemana(new Date(2026, 9, 11))), '2026-10-05'); ok();  // domingo
assert.equal(ymd(P.inicioSemana(new Date(2026, 9, 5))), '2026-10-05'); ok();   // segunda

// pauta: por responsável e dia, gaveta fora, outra semana fora
const seg = P.inicioSemana(new Date(2026, 9, 9));
const pa = P.pauta([
  { _anoMes: '2026-10', data: '05/10', responsavel: 'ana', status: 'pendente' },
  { _anoMes: '2026-10', data: '09/10', responsavel: 'ana', status: 'ajuste' },
  { _anoMes: '2026-10', data: '11/10', status: 'pendente' },
  { _anoMes: '2026-10', data: '12/10', responsavel: 'ana', status: 'pendente' },
  { _anoMes: '2026-10', data: '07/10', responsavel: 'ana', interno: 'reserva', status: 'pendente' }
], seg);
assert.deepEqual([...pa.keys()].sort(), ['', 'ana']); ok();
assert.deepEqual(pa.get('ana').map(d => d.length), [1, 0, 0, 0, 1, 0, 0]); ok();
assert.equal(pa.get('')[6].length, 1); ok();

// aprovação: espera, ajustes por post e aprovados de primeira
const h = n => new Date(Date.UTC(2026, 9, 1, n)).toISOString();
const ap = P.aprovacao([
  { created_at: h(0), _publicadoEm: h(10), aprovacoes: [{ acao: 'aprovado', origem: 'cliente', created_at: h(14) }] },        // 4 h, de primeira
  { created_at: h(0), _publicadoEm: h(10), aprovacoes: [
    { acao: 'ajuste', origem: 'cliente', created_at: h(30) },                                                                    // 20 h
    { acao: 'comentario', origem: 'agencia', created_at: h(40) },
    { acao: 'aprovado', origem: 'cliente', created_at: h(46) }] },                                                               // 6 h
  { created_at: h(0), aprovacoes: [{ acao: 'comentario', origem: 'cliente', created_at: h(5) }] }                                 // sem decisão: fora
]);
assert.equal(ap.comRetorno, 2); ok();
assert.equal(ap.espera, 6 * 3600000); ok();       // mediana de 4, 6 e 20 h
assert.equal(ap.ajustesPorPost, 0.5); ok();
assert.equal(ap.deFirst, 0.5); ok();
assert.deepEqual(P.aprovacao([]), { comRetorno: 0, espera: null, ajustesPorPost: null, deFirst: null }); ok();
// duas respostas seguidas sem ação da agência no meio: só a primeira conta como espera
assert.equal(P.aprovacao([{ created_at: h(0), aprovacoes: [{ acao: 'ajuste', origem: 'cliente', created_at: h(2) }, { acao: 'aprovado', origem: 'cliente', created_at: h(50) }] }]).espera, 2 * 3600000); ok();

assert.equal(P.duracao(null), '—'); ok();
assert.equal(P.duracao(30 * 60000), 'menos de 1 h'); ok();
assert.equal(P.duracao(5 * 3600000), '5 h'); ok();
assert.equal(P.duracao(36 * 3600000), '1,5 dia'); ok();
assert.equal(P.duracao(48 * 3600000), '2 dias'); ok();
assert.equal(P.duracao(15 * 86400000), '15 dias'); ok();

console.log('PASS:', checks, 'checks do painel: datas, resumo por cliente, atrasos, semana, pauta e números de aprovação.');
