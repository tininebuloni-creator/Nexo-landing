(function () {
  function normalize(value) {
    return String(value || '').toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  const aliases = {
    rrhh: 'rrhh empleados personal recursos humanos asistencia liquidaciones',
    empleados: 'rrhh empleados personal recursos humanos asistencia liquidaciones',
    personal: 'rrhh empleados personal recursos humanos asistencia liquidaciones'
  };

  function mountSearch() {
    if (document.getElementById('pampaGlobalSearch')) return;
    const navigation = document.querySelector('.sidebar-nav, .nav, aside nav, aside.sidebar, .sidebar');
    if (!navigation) return;
    const navigationItems = () => [...navigation.querySelectorAll('[data-view], [data-module]')];
    const contentItems = () => [...document.querySelectorAll('.view h1, .view h2, .view h3, .view h4, .view label, .view button, .view td, .view th, .view option, .module h1, .module h2, .module h3, .module h4, .module label, .module button, .module td, .module th, .module option, [id^="mod-"] h1, [id^="mod-"] h2, [id^="mod-"] h3, [id^="mod-"] h4, [data-searchable]')];
    const wrapper = document.createElement('div');
    wrapper.id = 'pampaGlobalSearch';
    wrapper.innerHTML = '<label for="pampaGlobalSearchInput">Buscar en todo el ERP</label><input id="pampaGlobalSearchInput" type="search" placeholder="Buscar módulo, campo o acción..." autocomplete="off"><div id="pampaGlobalSearchCount" aria-live="polite"></div><div id="pampaGlobalSearchResults" role="listbox" hidden></div>';
    wrapper.style.cssText = 'position:relative;margin:0 12px 16px;padding:0;z-index:20;';
    const style = document.createElement('style');
    style.textContent = '#pampaGlobalSearch label{display:block;color:#94a3b8;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px}#pampaGlobalSearch input{width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.35);border-radius:6px;padding:8px 9px;background:#fff;color:#18221d;font:inherit;font-size:12px}#pampaGlobalSearchCount{min-height:16px;margin-top:4px;color:#94a3b8;font-size:10px}#pampaGlobalSearchResults{position:absolute;left:0;right:0;top:78px;max-height:260px;overflow:auto;background:#fff;border:1px solid #dbe4ee;border-radius:6px;box-shadow:0 8px 22px rgba(15,23,42,.2)}#pampaGlobalSearchResults button{display:block;width:100%;border:0;border-bottom:1px solid #eef2f7;padding:9px;text-align:left;background:#fff;color:#17231d;font:inherit;font-size:12px;cursor:pointer}#pampaGlobalSearchResults button:hover{background:#eef7ef}';
    document.head.appendChild(style);
    navigation.prepend(wrapper);
    const input = wrapper.querySelector('input');
    const results = wrapper.querySelector('[role="listbox"]');
    input.addEventListener('input', () => {
      const query = normalize(input.value);
      results.replaceChildren();
      const count = wrapper.querySelector('#pampaGlobalSearchCount');
      if (!query) { results.hidden = true; count.textContent = ''; return; }
      const items = [...new Set([...navigationItems(), ...contentItems()])].filter((item) => (item.textContent || '').trim());
      const matches = items.filter((item) => {
        const text = normalize(item.textContent);
        const module = normalize(item.dataset?.view || item.dataset?.module || '');
        return text.includes(query) || module.includes(query) || Boolean(module && aliases[query] && aliases[query].includes(module));
      }).slice(0, 20);
      count.textContent = `${matches.length} coincidencia(s)`;
      matches.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        const view = item.closest('.view, .module, [id^="mod-"]')?.querySelector('h1, h2')?.textContent?.trim();
        button.textContent = `${item.textContent.trim().replace(/\s+/g, ' ')}${view && view !== item.textContent.trim() ? ` · ${view}` : ''}`;
        button.setAttribute('role', 'option');
        button.addEventListener('click', () => {
          const directTarget = item.matches('[data-view], [data-module]') ? item : null;
          const view = item.closest('.view, .module, [id^="mod-"]');
          const viewTarget = view ? navigation.querySelector(`[data-view="${view.id}"], [data-module="${view.id}"]`) : null;
          (directTarget || viewTarget || item).click();
          input.value = '';
          count.textContent = '';
          results.hidden = true;
        });
        results.appendChild(button);
      });
      results.hidden = matches.length === 0;
    });
    document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) results.hidden = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSearch);
  else mountSearch();
}());
