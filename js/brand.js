/* Identidade por agência, pelo id. Nomes vêm só do banco, e cada pessoa recebe apenas a própria agência. */
window.BRAND = (() => {
  const TEMAS = {
    '10000000-0000-4000-8000-000000000001': { tema: 'classico', logo: 'assets/marcas/m1/horizontal.svg', icone: 'assets/marcas/m1/icone.svg' },
    '10000000-0000-4000-8000-000000000002': { tema: 'escuro', logo: 'assets/marcas/m2/marca.svg', icone: 'assets/marcas/m2/marca.svg' }
  };
  const NOME = 'Vistto';
  return {
    NOME,
    apply(g) {
      const t = g && TEMAS[g.id];
      document.body.dataset.tema = t ? t.tema : 'neutro';
      document.title = (g?.nome ? g.nome + ' · ' : '') + NOME;
      for (const id of ['agencyLogo', 'mark']) {
        const el = document.getElementById(id); if (!el) continue;
        el.replaceChildren();
        if (!t) { el.textContent = g?.nome || NOME; el.classList.add('wordmark'); continue; }
        el.classList.remove('wordmark');
        const img = document.createElement('img'); img.alt = g.nome || '';
        img.src = id === 'mark' ? t.icone : t.logo;
        el.append(img);
      }
      const tag = document.getElementById('agencyTag'); if (tag) tag.textContent = 'Aprovação de posts';
    }
  };
})();
