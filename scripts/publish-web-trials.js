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
const argApps = process.argv.slice(2);
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
        && !entry.endsWith('.env')
        && !entry.endsWith('.key')
        && !entry.endsWith('.crt');
    }
  });
  fs.copyFileSync(privacyPopup, path.join(destination, 'pampa-privacy-popup.js'));
  if (fs.existsSync(trialProgress)) fs.copyFileSync(trialProgress, path.join(destination, 'trial-progress.js'));
  const entryPoint = path.join(destination, 'index.html');
  if (indexOverrides[folderName] && fs.existsSync(indexOverrides[folderName])) {
    fs.copyFileSync(indexOverrides[folderName], entryPoint);
  }
  let html = fs.readFileSync(entryPoint, 'utf8');
  html = html.replace(/\bconst\s+TRIAL_DAYS\s*=\s*10\s*;/g, 'var TRIAL_DAYS = 10;');
  html = html.replace(/\bawait\s+activateTrial\s*\(\s*\)\s*;/g, '');
  html = html.replace(/\bmaybeAutoActivateTrialFromQuery\s*\(\s*\)\s*;/g, '');
  html = html.replace(/\bactivateTrial\s*\(\s*\)\s*;/g, '');
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
  if (!html.includes(trialProgressTag)) {
    html = injectBeforeFinalBody(html, trialProgressTag);
  }
  if (!html.includes(popupTag)) {
    html = injectBeforeFinalBody(html, popupTag);
  }
  fs.writeFileSync(entryPoint, html, 'utf8');
  console.log(`Aplicación publicada: ${folderName}`);
}

fs.copyFileSync(path.join(landingRoot, 'index.html'), path.join(landingRoot, 'public', 'index.html'));
console.log('Catálogo publicado en public/index.html');