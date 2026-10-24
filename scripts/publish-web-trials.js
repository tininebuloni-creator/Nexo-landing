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
  // Topografia se integro al ecosistema en apps/PampaTopografia (fuente oficial desde 28/9/2026).
  // El repo hermano Proyectos/pampatopo-app queda como copia historica y ya no se publica.
  PampaTopografia: path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'PampaTopografia'),
  // PampaFiscal: app fiscal independiente (módulos fiscales agropecuarios).
  'pampafiscal-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampafiscal', 'public'),
  // Pampa PBP: su servidor corre en el navegador; la carpeta la arma PAMPA N-ecosystem/scripts/build-web-trial-pbp.js
  'pampapbp-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'PampaBalanceadosPorcinos', 'web-dist'),
  // PampaCoop: la carpeta la arma PAMPA N-ecosystem/apps/pampacooperativas/armar-trial-web.js
  'pampacooperativas-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampacooperativas', 'public'),
  // PampaBiogas: public/ lo arma apps/pampabiogas/scripts/sync-public.js (npm run public:sync).
  'pampabiogas-erp': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampabiogas', 'public'),
  // Pampa Hidroponía: public/ es el espejo web que arma apps/pampahidroponia/scripts/sync-public.js (npm run public:sync);
  // la raíz de la app queda como fuente pura de los exe. Se publica en la carpeta que ya enlazaba el catálogo.
  'pampa-hidroponia': path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampahidroponia', 'public')
};
// Apps que traen su propio control de prueba (barra, respaldo y bloqueo): no llevan trial-progress.js de la landing,
// que guarda el progreso en otro lugar y pondría una segunda barra.
// PampaBiogas trae su trial-progress.js (registra el inicio en el servidor y bloquea al vencer) y lo carga solo en la web.
// Pampa Hidroponía carga su barra de prueba desde pampa/trial-progress.js (packages/core-licensing).
const conPruebaPropia = new Set(['pampacooperativas-erp', 'pampabiogas-erp', 'pampa-hidroponia']);

// Por defecto solo se publican estas 4 (las que ya estan completas y en uso). Para publicar
// tambien Porcinos y Precision, correr: node scripts/publish-web-trials.js all
// Para elegir puntualmente cuales, pasar sus nombres de carpeta: node scripts/publish-web-trials.js pampaagro-erp pampatambo-erp
// Ofuscación del código publicado (nunca del código fuente de apps/): ver PAMPA N-ecosystem/scripts/ofuscar-codigo.js.
// --sin-ofuscar publica legible (solo para depurar; no subir así).
const { ofuscarCarpeta } = require(path.join(projectsRoot, 'PAMPA N-ecosystem', 'scripts', 'ofuscar-codigo.js'));
const sinOfuscar = process.argv.includes('--sin-ofuscar');
const DEFAULT_APPS = ['pampaagro-erp', 'pampaganaderia-erp', 'pampatambo-erp', 'PampaTopografia'];
const argApps = process.argv.slice(2).filter((a) => !a.startsWith('--'));
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

// packs, desktop-public y electron son del build de escritorio (instaladores, UI protegida, main de
// Electron): aparecen en las apps que se publican desde su raíz (PampaTopografia, Porcinos) y no
// tienen que llegar a la web. package.json, package-lock.json y wrangler.jsonc son configuración de build/deploy.
// Código de servidor que nunca se publica: server.js (Express de Porcinos, que se publica desde la
// raíz de la app), _worker.js (Worker de Cloudflare; Pages no lo ejecuta fuera de la raíz y quedaba
// descargable) y Pampa-Packs (entregas de clientes).
const ignored = new Set(['node_modules', '.git', '.wrangler', 'data', 'services', 'server', 'controllers', 'models', 'routes', 'scripts', 'dist', 'release', 'build', 'public_protected', 'packs', 'Pampa-Packs', 'desktop-public', 'electron', 'server.js', '_worker.js', 'package.json', 'package-lock.json', 'wrangler.jsonc', 'wrangler.toml',
  // Pruebas, copias anteriores, certificados de ARCA y archivos del servidor local (Hidroponía, Porcinos).
  'tests', '_anterior', 'arca', 'dataDir.js', '.env.example', '.gitignore']);
// '~$': archivos de bloqueo que crea Office mientras un documento está abierto (ej: ~$Planilla_...xlsx)
// 'electron-builder': configs del instalador de escritorio (ej: electron-builder-premium.json)
// 'Manual': borradores de manuales en la carpeta de la app (Manual_Operativo_..._v1.docx, etc.);
// los PDF útiles para el cliente van en "Ver documentación" (public/documentos), no en la demo.
const ignoredPrefixes = ['dist-', 'release-', '~$', 'electron-builder', 'Manual'];
// Scripts de desarrollo que no tienen que llegar a la web (ej: aplicar_parche.py) y notas .txt
// internas (versiones, roles, LEEME): quedaban publicadas y descargables por cualquiera.
// .doc/.docx: borradores de Word, nunca se publican.
const ignoredExtensions = ['.env', '.key', '.crt', '.bat', '.py', '.sh', '.ps1', '.txt', '.doc', '.docx'];
// Copias sueltas que deja Windows al bajar/duplicar (ej: "index (9).html"): una vieja quedaba
// publicada con el manifest y el service worker, o sea instalable.
const copiaWindows = / \(\d+\)\.[^.]+$/;
const privacyPopup = path.join(projectsRoot, 'PAMPA N-ecosystem', 'packages', 'pampa-privacy-popup.js');
const trialProgress = path.join(landingRoot, 'trial-progress.js');
// OJO: pampatambo-erp tenía acá un override que pisaba el index.html publicado con el
// index.html de ESCRITORIO (apps/pampatambo/index.html), no con el de public/. Ese archivo
// de escritorio ya no lleva el botón "Iniciar prueba gratis" (la prueba gratis es solo para
// la web, a pedido explícito), así que con el override puesto el trial publicado se quedaba
// sin botón de prueba. Se saca el override: ahora, igual que el resto de las apps, se usa
// directo apps/pampatambo/public/index.html (que sí mantiene el botón de trial).
const indexOverrides = {};

function webTrialGuard() {
  // OJO: este guard corre como el PRIMER script de <head>, antes que cualquier otro codigo de
  // la app. Si solo borrara "?trial=auto" de la URL, cualquier chequeo posterior (initLicense,
  // maybeAutoActivateTrialFromQuery, etc., que corren mas abajo en la pagina o en DOMContentLoaded)
  // ya nunca veria ese parametro y el trial automatico por link jamas se activaria (aunque el
  // visitante haya entrado por el link correcto "Ver aplicación" de la landing). Por eso, antes
  // de borrar el parametro, dejamos la intencion guardada en window.__pampaTrialAutoRequested para
  // que el resto del codigo de la app la pueda consultar igual.
  return `<script id="pampa-web-trial-guard">(function(){try{const url=new URL(window.location.href);if(url.searchParams.get('trial')==='auto'){window.__pampaTrialAutoRequested=true;url.searchParams.delete('trial');window.history.replaceState({},document.title,url.pathname+url.search+url.hash);}}catch(error){}}());</script>`;
}

// La web es una demo de 10 días: no se tiene que poder instalar como app (PWA) ni andar sin
// internet, porque una copia instalada/cacheada seguiría abriendo sin pasar por el control de días
// del servidor. Sin manifest el navegador no ofrece "Instalar"; este script además anula el registro
// del service worker y da de baja los que hayan quedado de publicaciones anteriores.
function webNoInstallGuard() {
  return `<script id="pampa-web-no-install">(function(){try{window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();});var sw=navigator.serviceWorker;if(sw){sw.register=function(){return Promise.reject(new Error('La prueba web no se instala'));};sw.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}).catch(function(){});}}catch(error){}}());</script>`;
}

// La web es la demo de 10 días: la gestión y activación de licencia es solo de las versiones puras
// (escritorio / packs). Varias apps la traían igual en el menú o en el panel (Agro, Ganadería, Tambo,
// Porcinos, Precisión, Fiscal). Se ocultan los accesos por id y por texto ("Gestión de licencia",
// "Licencia(s)", "Activar licencia"), también los que la app dibuja después de cargar.
function webNoLicenseGuard() {
  return `<script id="pampa-web-sin-licencia">(function(){try{var ids=['btnActivarLicencia','licenseStatus','licenseExpiryNotice','roleSeatsCard'];var texto=/^[^a-z\\u00c0-\\u024f]*(gesti[o\\u00f3]n de licencias?|licencias?|activar licencia)\\b/i;var st=document.createElement('style');st.textContent=ids.map(function(i){return '#'+i;}).join(',')+',.pampa-web-sin-licencia{display:none!important}';document.head.appendChild(st);function ocultar(){document.querySelectorAll('.nav-item,[data-view],[data-module],nav button,button,a').forEach(function(el){if(el.classList.contains('pampa-web-sin-licencia'))return;var partes=[],w=document.createTreeWalker(el,4),n;while((n=w.nextNode()))partes.push(n.nodeValue);var t=partes.join(' ').replace(/\\s+/g,' ').trim();if(t.length<80&&texto.test(t))el.classList.add('pampa-web-sin-licencia');});}var pendiente=false;function programar(){if(pendiente)return;pendiente=true;setTimeout(function(){pendiente=false;ocultar();},50);}document.addEventListener('DOMContentLoaded',function(){ocultar();new MutationObserver(programar).observe(document.body,{childList:true,subtree:true});});}catch(error){}}());</script>`;
}

// Reemplaza el sw.js publicado: a quien ya tenga instalada una versión anterior, el navegador le
// baja este al buscar actualizaciones, que borra la copia offline y se da de baja solo.
const killSwitchSw = `self.addEventListener('install',function(){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}).then(function(){return self.registration.unregister();}));});
`;

for (const [folderName, source] of Object.entries(sources)) {
  if (!selectedKeys.includes(folderName)) continue;
  if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error(`No se encontró la aplicación web para ${folderName}: ${source}`);
  const destination = path.join(targetRoot, folderName);
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
        && !ignoredExtensions.some(ext => name.toLowerCase().endsWith(ext))
        && !copiaWindows.test(name);
    }
  });
  // La carpeta data/ no se publica (puede tener datos del servidor), pero los datos de ejemplo de
  // la demo sí: sin ellos, "Cargar datos de ejemplo" recibía la página del catálogo y fallaba.
  const datosDemo = path.join(source, 'data', 'datosSemillaDemo.json');
  if (fs.existsSync(datosDemo)) {
    fs.mkdirSync(path.join(destination, 'data'), { recursive: true });
    fs.copyFileSync(datosDemo, path.join(destination, 'data', 'datosSemillaDemo.json'));
  }
  fs.copyFileSync(privacyPopup, path.join(destination, 'pampa-privacy-popup.js'));
  if (fs.existsSync(trialProgress) && !conPruebaPropia.has(folderName)) fs.copyFileSync(trialProgress, path.join(destination, 'trial-progress.js'));
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
  const guardTag = webTrialGuard();
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
  // Demo no instalable: fuera el manifest (es lo que hace aparecer "Instalar" en la barra de
  // direcciones) y el service worker (ver webNoInstallGuard).
  html = html.replace(/[ \t]*<link\b[^>]*\brel=["']manifest["'][^>]*>\s*\n?/gi, '');
  html = html.replace(/<script id="pampa-web-no-install">[\s\S]*?<\/script>\s*\n?/i, '');
  html = html.replace(/(<script id="pampa-web-trial-guard">[\s\S]*?<\/script>)/i, `$1\n${webNoInstallGuard()}`);
  // Demo sin licencia (ver webNoLicenseGuard). El aviso Self-Hosted de Precisión es de la instalación
  // local del licenciatario: en la demo web no va.
  html = html.replace(/<script id="pampa-web-sin-licencia">[\s\S]*?<\/script>[ \t]*\r?\n?/i, '');
  html = html.replace(/(<script id="pampa-web-no-install">[\s\S]*?<\/script>)/i, `$1\n${webNoLicenseGuard()}`);
  html = html.replace(/[ \t]*<script\b[^>]*pampa-onpremise-disclaimer\.js[^>]*><\/script>[ \t]*\r?\n?/gi, '');
  for (const nombre of ['manifest.webmanifest', 'manifest.json']) {
    fs.rmSync(path.join(destination, nombre), { force: true });
  }
  if (fs.existsSync(path.join(destination, 'sw.js'))) {
    fs.writeFileSync(path.join(destination, 'sw.js'), killSwitchSw, 'utf8');
  }
  if (!html.includes(trialProgressTag) && !conPruebaPropia.has(folderName)) {
    html = injectBeforeFinalBody(html, trialProgressTag);
  }
  if (!html.includes('pampa-privacy-popup.js')) { // la fuente puede traerlo con ?v=
    html = injectBeforeFinalBody(html, popupTag);
  }
  fs.writeFileSync(entryPoint, html, 'utf8');
  if (!sinOfuscar) {
    const r = ofuscarCarpeta(destination);
    if (r.fallas.length) {
      r.fallas.forEach((x) => console.error(`  SIN OFUSCAR ${x.archivo}: ${x.error}`));
      throw new Error(`${folderName}: ${r.fallas.length} archivo(s) no se pudieron ofuscar; no se publica legible.`);
    }
    console.log(`  ofuscados ${r.archivos} archivo(s) (${r.scripts} script(s) inline)`);
  }
  console.log(`Aplicación publicada: ${folderName}`);
}

fs.copyFileSync(path.join(landingRoot, 'index.html'), path.join(landingRoot, 'public', 'index.html'));
console.log('Catálogo publicado en public/index.html');