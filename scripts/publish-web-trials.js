const fs = require('fs');
const path = require('path');

const landingRoot = path.resolve(__dirname, '..');
const projectsRoot = path.resolve(landingRoot, '..');
const targetRoot = path.join(landingRoot, 'public');
const sources = {
  // Antes apuntaba a "Pampa-Packs/premium/movil", una carpeta de un empaquetado viejo que ya
  // ni existe en disco. La fuente real de la PWA (igual que Ganaderia/Tambo) es public/.
  'pampaagro-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaagro', 'public'),
  'pampaganaderia-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaganaderia', 'public'),
  'pampatambo-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampatambo', 'public'),
  'pampaporcinos-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaporcinos'),
  'pampaprecision-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaprecision', 'public'),
  // pampatopo-app es un repo HERMANO de "PAMPA N-ecosystem" (vive directo en Proyectos/), no
  // esta anidado adentro de PAMPA N-ecosystem/apps/. Ese path viejo apuntaba a una copia vieja
  // e incompleta que quedo suelta ahi (sin package.json, sin scripts, con index.html desactualizado).
  PampaTopografia: path.join(projectsRoot, 'pampatopo-app')
};

// Por defecto solo se publican estas 4 (las que ya estan completas y en uso). Para publicar
// tambien Porcinos y Precision, correr: node scripts/publish-web-trials.js all
// Para elegir puntualmente cuales, pasar sus nombres de carpeta: node scripts/publish-web-trials.js pampaagro-erp pampatambo-erp
const DEFAULT_APPS = ['pampaagro-erp', 'pampaganaderia-erp', 'pampatambo-erp', 'PampaTopografia'];
// --sin-copiar: no recopia desde PAMPA N-ecosystem; solo reaplica las transformaciones web
// (guard, trial-progress, popup) sobre lo que ya esta publicado en public/<app>.
const args = process.argv.slice(2);
const skipCopy = args.includes('--sin-copiar');
const argApps = args.filter((arg) => !arg.startsWith('--'));
let selectedKeys;
if (argApps.length === 0) {
  selectedKeys = DEFAULT_APPS;
} else if (argApps.length === 1 && argApps[0] === 'all') {
  selectedKeys = Object.keys(sources);
} else {
  selectedKeys = argApps;
}
const invalidKeys = selectedKeys.filter((k) => !(k in sources));
if (invalidKeys.length) {
  throw new Error(`App(s) desconocida(s): ${invalidKeys.join(', ')}. Disponibles: ${Object.keys(sources).join(', ')}`);
}
console.log(`Publicando: ${selectedKeys.join(', ')}`);

const ignored = new Set(['node_modules', '.git', '.wrangler', 'data', 'services', 'server', 'controllers', 'models', 'routes', 'scripts', 'dist', 'release', 'build', 'public_protected']);
const ignoredPrefixes = ['dist-', 'release-'];
const privacyPopup = path.join(projectsRoot, 'PAMPA N-ecosystem', 'packages', 'pampa-privacy-popup.js');
const trialProgress = path.join(landingRoot, 'trial-progress.js');
// OJO: pampatambo-erp tenía acá un override que pisaba el index.html publicado con el
// index.html de ESCRITORIO (apps/pampatambo/index.html), no con el de public/. Ese archivo
// de escritorio ya no lleva el botón "Iniciar prueba gratis" (la prueba gratis es solo para
// la web, a pedido explícito), así que con el override puesto el trial publicado se quedaba
// sin botón de prueba. Se saca el override: ahora, igual que el resto de las apps, se usa
// directo apps/pampatambo/public/index.html (que sí mantiene el botón de trial).
const indexOverrides = {};

// Codigo del guard. Se serializa con toString() y se inyecta como PRIMER script de <head>.
function pampaWebTrialGuard(appId, trialDays) {
  // 1) Link ?trial=auto: se guarda la intencion antes de limpiar la URL, para que
  //    maybeAutoActivateTrialFromQuery() (que corre mas abajo) la pueda leer igual.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('trial') === 'auto') {
      window.__pampaTrialAutoRequested = true;
      url.searchParams.delete('trial');
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    }
  } catch (error) {}

  // 2) Aislamiento por app: todas las demos comparten dominio y localStorage. PampaAgro,
  //    PampaGanaderia e Hidroponia guardan la licencia en la misma clave 'nexoAgroLicense', asi
  //    que el trial de una pisaba al de otra. Se redirige esa clave a una propia de esta app para
  //    todos los scripts de la pagina (index, vendor/*, pampaia-source, seat-control, etc.).
  window.PAMPA_TRIAL_APP_ID = appId;
  const SHARED_KEYS = ['nexoAgroLicense'];
  try {
    const proto = Storage.prototype;
    const scoped = (storage, key) => (storage === window.localStorage && SHARED_KEYS.includes(key) ? `${key}:${appId}` : key);
    const { getItem, setItem, removeItem } = proto;
    proto.getItem = function (key) { return getItem.call(this, scoped(this, key)); };
    proto.setItem = function (key, value) { return setItem.call(this, scoped(this, key), value); };
    proto.removeItem = function (key) { return removeItem.call(this, scoped(this, key)); };
  } catch (error) {}

  // 3) El trial web no tiene pantalla de activacion: la primera visita arranca la prueba sola.
  //    checkLicense() llama a esta funcion primero. Arma la licencia de trial a partir de la misma
  //    fecha de inicio que usa el cartel (trial-progress.js), asi badge, plan y cartel coinciden.
  //    Si la prueba vencio igual devuelve true: el bloqueo lo hace el cartel, no una pantalla.
  //    Una licencia real (firmada) no se toca y sigue la validacion normal.
  window.pampaWebTrialEnsure = function () {
    try {
      const initKey = `pampa_trial_init:${appId}`;
      const raw = localStorage.getItem('nexoAgroLicense');
      const current = raw ? JSON.parse(raw) : null;
      if (current && current.type && current.type !== 'trial') return false;
      let start = localStorage.getItem(initKey);
      if (!start || Number.isNaN(Date.parse(start))) {
        start = new Date().toISOString();
        localStorage.setItem(initKey, start);
      }
      localStorage.setItem('nexoAgroLicense', JSON.stringify({
        type: 'trial',
        key: 'TRIAL-WEB',
        activatedAt: start,
        expiresAt: new Date(Date.parse(start) + trialDays * 24 * 60 * 60 * 1000).toISOString(),
        deviceId: (current && current.deviceId) || `web-${Math.random().toString(36).slice(2)}`
      }));
      return true;
    } catch (error) {
      return false;
    }
  };
}

function webTrialGuard(appId) {
  return `<script id="pampa-web-trial-guard">(${pampaWebTrialGuard.toString()})(${JSON.stringify(appId)}, 10);</script>`;
}

// Engancha el trial web al principio de checkLicense(). Sin esto, checkLicense() devolvia true
// sin licencia (la llamada a activateTrial() que tenia se borra mas abajo al publicar) y la demo
// quedaba como Premium sin trial: sin badge, sin dias restantes y sin vencimiento propio.
const CHECK_LICENSE_HOOK = 'if (window.pampaWebTrialEnsure && window.pampaWebTrialEnsure()) return true; // pampa-web-trial-hook';

for (const [folderName, source] of Object.entries(sources)) {
  if (!selectedKeys.includes(folderName)) continue;
  const destination = path.join(targetRoot, folderName);
  if (skipCopy) {
    if (!fs.existsSync(path.join(destination, 'index.html'))) throw new Error(`No hay una versión publicada de ${folderName} en ${destination}`);
  } else {
    if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error(`No se encontró la aplicación web para ${folderName}: ${source}`);
    try {
      fs.rmSync(destination, { recursive: true, force: true });
    } catch (e) {
      // Si algún archivo queda bloqueado momentáneamente en Windows
    }
    fs.cpSync(source, destination, {
      recursive: true,
      filter: (entry) => {
        const name = path.basename(entry);
        return !ignored.has(name)
          && !ignoredPrefixes.some(prefix => name.startsWith(prefix))
          && !entry.endsWith('.env')
          && !entry.endsWith('.key')
          && !entry.endsWith('.crt');
      }
    });
    fs.copyFileSync(privacyPopup, path.join(destination, 'pampa-privacy-popup.js'));
  }
  if (fs.existsSync(trialProgress)) fs.copyFileSync(trialProgress, path.join(destination, 'trial-progress.js'));
  const entryPoint = path.join(destination, 'index.html');
  if (indexOverrides[folderName] && fs.existsSync(indexOverrides[folderName])) {
    fs.copyFileSync(indexOverrides[folderName], entryPoint);
  }
  let html = fs.readFileSync(entryPoint, 'utf8');
  html = html.replace(/\bconst\s+TRIAL_DAYS\s*=\s*10\s*;/g, 'var TRIAL_DAYS = 10;');
  html = html.replace(/\bawait\s+activateTrial\s*\(\s*\)\s*;/g, '');
  html = html.replace(/\bactivateTrial\s*\(\s*\)\s*;/g, '');
  // OJO: acá antes se borraba también el llamado a maybeAutoActivateTrialFromQuery() al
  // publicar. Eso dejaba completamente muerto el link de trial que se manda por WhatsApp
  // (?trial=auto): pampa-web-trial-guard ya guarda la intención en
  // window.__pampaTrialAutoRequested, pero si esta función nunca se llama, nadie la lee
  // y el link no activa nada. Se saca el borrado para que el link automático funcione.
  const trialProgressTag = '<script src="./trial-progress.js"></script>';
  const popupTag = '<script src="./pampa-privacy-popup.js"></script>';
  const guardTag = webTrialGuard(folderName);
  function injectBeforeFinalBody(sourceHtml, tag) {
    if (sourceHtml.includes(tag)) return sourceHtml;
    const index = sourceHtml.toLowerCase().lastIndexOf('</body>');
    if (index < 0) return `${sourceHtml}\n${tag}\n`;
    return `${sourceHtml.slice(0, index)}  ${tag}\n${sourceHtml.slice(index)}`;
  }
  // Si la fuente ya trae un guard viejo (por ejemplo, sincronizado de vuelta desde un build de
  // escritorio anterior), lo sacamos y ponemos siempre el guard actual — sino, un guard viejo
  // sin el flag de arriba se coló y esta actualización nunca llega a lo publicado.
  html = html.replace(/<script id="pampa-web-trial-guard">[\s\S]*?<\/script>\s*\n?/i, '');
  if (!html.includes('id="pampa-web-trial-guard"')) {
    html = html.replace(/<head>/i, `<head>\n${guardTag}`);
  }
  if (!html.includes('pampa-web-trial-hook')) {
    html = html.replace(/(async\s+function\s+checkLicense\s*\(\s*\)\s*\{)/, `$1\n  ${CHECK_LICENSE_HOOK}`);
  }
  if (!html.includes(trialProgressTag)) {
    html = injectBeforeFinalBody(html, trialProgressTag);
  }
  if (!html.includes(popupTag)) {
    html = injectBeforeFinalBody(html, popupTag);
  }
  fs.writeFileSync(entryPoint, html, 'utf8');
  // Con el trial web ahora hay una licencia 'trial' con expiresAt: sin esto, al vencer,
  // pampa-license-expiry-ui.js tapaba todo con "Suscripción temporal inactiva" (mensaje de abono
  // pago). Al vencer el trial web solo se bloquea la edición desde el cartel de trial-progress.js,
  // que deja guardar/importar el progreso.
  const expiryUi = path.join(destination, 'pampa-license-expiry-ui.js');
  if (fs.existsSync(expiryUi)) {
    const code = fs.readFileSync(expiryUi, 'utf8');
    const patched = code.replace(/if \(!expiration\) continue;/, "if (!expiration || record.type === 'trial') continue;");
    if (patched !== code) fs.writeFileSync(expiryUi, patched, 'utf8');
  }
  console.log(`Aplicación publicada: ${folderName}`);
}

fs.copyFileSync(path.join(landingRoot, 'index.html'), path.join(landingRoot, 'public', 'index.html'));
console.log('Catálogo publicado en public/index.html');