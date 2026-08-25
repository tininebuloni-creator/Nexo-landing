(function () {
  function normalize(value) {
    return String(value || '').toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function mountSearch() {
    if (document.getElementById('pampaGlobalSearch')) return;
    const navigation = document.querySelector('.sidebar-nav, .nav, aside nav');
    if (!navigation) return;
    const items = [...navigation.querySelectorAll('[data-view], [data-module]')].filter((item) => (item.textContent || '').trim());
    if (!items.length) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'pampaGlobalSearch';
    wrapper.innerHTML = '<label for="pampaGlobalSearchInput">Buscar</label><input id="pampaGlobalSearchInput" type="search" placeholder="Buscar módulo..." autocomplete="off"><div id="pampaGlobalSearchResults" role="listbox" hidden></div>';
    wrapper.style.cssText = 'position:relative;margin:0 12px 16px;padding:0;z-index:20;';
    const style = document.createElement('style');
    style.textContent = '#pampaGlobalSearch label{display:block;color:#94a3b8;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px}#pampaGlobalSearch input{width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.35);border-radius:6px;padding:8px 9px;background:#fff;color:#18221d;font:inherit;font-size:12px}#pampaGlobalSearchResults{position:absolute;left:0;right:0;top:58px;max-height:220px;overflow:auto;background:#fff;border:1px solid #dbe4ee;border-radius:6px;box-shadow:0 8px 22px rgba(15,23,42,.2)}#pampaGlobalSearchResults button{display:block;width:100%;border:0;border-bottom:1px solid #eef2f7;padding:9px;text-align:left;background:#fff;color:#17231d;font:inherit;font-size:12px;cursor:pointer}#pampaGlobalSearchResults button:hover{background:#eef7ef}';
    document.head.appendChild(style);
    navigation.prepend(wrapper);
    const input = wrapper.querySelector('input');
    const results = wrapper.querySelector('[role="listbox"]');
    input.addEventListener('input', () => {
      const query = normalize(input.value);
      results.replaceChildren();
      if (!query) { results.hidden = true; return; }
      const matches = items.filter((item) => normalize(item.textContent).includes(query)).slice(0, 12);
      matches.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.textContent.trim().replace(/\s+/g, ' ');
        button.setAttribute('role', 'option');
        button.addEventListener('click', () => { item.click(); input.value = ''; results.hidden = true; });
        results.appendChild(button);
      });
      results.hidden = matches.length === 0;
    });
    document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) results.hidden = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSearch);
  else mountSearch();
}());
