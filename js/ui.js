/* Vistto · avisos e confirmações no visual do painel, no lugar de alert(), confirm() e prompt(). */
window.UI = (() => {
  let pilha = null;
  // aviso('Salvo.') ou aviso('Não foi possível…', 'erro'). Some sozinho; clicar fecha antes.
  function aviso(texto, tipo = 'ok') {
    if (!pilha) {
      pilha = document.createElement('div');
      pilha.className = 'avisos'; pilha.setAttribute('role', 'status'); pilha.setAttribute('aria-live', 'polite');
      document.body.appendChild(pilha);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (tipo === 'erro' ? 'erro' : 'ok');
    el.textContent = texto;
    pilha.appendChild(el);
    const sair = () => { if (!el.isConnected) return; el.classList.add('saindo'); setTimeout(() => el.remove(), 180); };
    el.onclick = sair;
    setTimeout(sair, tipo === 'erro' ? 7000 : 4000);
  }
  // confirmar('texto', { titulo, ok: 'Excluir', perigo: true, digitar: 'Nome do cliente' }) → Promise<boolean>.
  // Esc, clique fora e Cancelar devolvem false. Com "digitar", o botão só libera quando o texto confere.
  function confirmar(texto, o = {}) {
    return new Promise(resolve => {
      const antes = document.activeElement;
      const fundo = document.createElement('div');
      fundo.className = 'dialogo-fundo';
      fundo.innerHTML = `<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitulo" aria-describedby="dlgTexto">
        <h3 id="dlgTitulo"></h3><p id="dlgTexto"></p>${o.digitar ? '<input id="dlgDigitar" autocomplete="off" spellcheck="false">' : ''}
        <div class="actions"><button class="btn ghost" data-r="0"></button><button class="btn" data-r="1"></button></div></div>`;
      fundo.querySelector('h3').textContent = o.titulo || (o.perigo ? 'Tem certeza?' : 'Confirmar');
      fundo.querySelector('p').textContent = texto;
      fundo.querySelector('[data-r="0"]').textContent = o.cancelar || 'Cancelar';
      const ok = fundo.querySelector('[data-r="1"]');
      ok.textContent = o.ok || 'Confirmar';
      ok.classList.add(o.perigo ? 'perigo' : 'primary');
      const campo = fundo.querySelector('#dlgDigitar');
      const confere = () => !o.digitar || campo.value.trim().toLowerCase() === String(o.digitar).trim().toLowerCase();
      if (campo) { campo.placeholder = o.digitar; ok.disabled = true; campo.oninput = () => { ok.disabled = !confere(); }; }
      const fim = v => { document.removeEventListener('keydown', tecla, true); fundo.remove(); if (antes && antes.focus) antes.focus(); resolve(v); };
      function tecla(e) {
        if (e.key === 'Escape') { e.preventDefault(); fim(false); }
        else if (e.key === 'Enter' && campo && document.activeElement === campo && confere()) { e.preventDefault(); fim(true); }
        else if (e.key === 'Tab') {   // o foco não sai da caixa
          const f = [...fundo.querySelectorAll('input,button:not([disabled])')];
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      fundo.addEventListener('click', e => {
        if (e.target === fundo) return fim(false);
        const b = e.target.closest('[data-r]');
        if (b && !b.disabled) fim(b.dataset.r === '1');
      });
      document.addEventListener('keydown', tecla, true);
      document.body.appendChild(fundo);
      (campo || fundo.querySelector('[data-r="0"]')).focus();
    });
  }
  return { aviso, confirmar };
})();
