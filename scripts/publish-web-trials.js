const fs = require('fs');
const path = require('path');

const landingRoot = path.resolve(__dirname, '..');
const projectsRoot = path.resolve(landingRoot, '..');
const targetRoot = path.join(landingRoot, 'public', 'trials');
const sources = {
  a7: path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaagro', 'Pampa-Packs', 'premium', 'movil'),
  g4: path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaganaderia', 'public'),
  t8: path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampatambo', 'public'),
  p6: path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaporcinos'),
  r3: path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampaprecision', 'public'),
  x9: path.join(projectsRoot, 'pampatopo-app')
};

const ignored = new Set(['node_modules', '.git', '.wrangler', 'data', 'services', 'server', 'controllers', 'models', 'routes', 'scripts', 'dist', 'public_protected']);
const ignoredPrefixes = ['dist-', 'release-'];
const privacyPopup = path.join(projectsRoot, 'PAMPA N-ecosystem', 'packages', 'pampa-privacy-popup.js');

// El catálogo usa /trials/<código>/; eliminar el bundle histórico que incluía node_modules y excedía el límite de Cloudflare.
fs.rmSync(path.join(landingRoot, 'public', 'pampaagro-erp'), { recursive: true, force: true });

for (const [code, source] of Object.entries(sources)) {
  if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error(`No se encontró la aplicación web para ${code}: ${source}`);
  const destination = path.join(targetRoot, code);
  fs.rmSync(destination, { recursive: true, force: true });
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
  const entryPoint = path.join(destination, 'index.html');
  const html = fs.readFileSync(entryPoint, 'utf8');
  const popupTag = '<script src="./pampa-privacy-popup.js"></script>';
  if (!html.includes(popupTag)) {
    fs.writeFileSync(entryPoint, html.replace('</body>', `  ${popupTag}\n</body>`));
  }
  console.log(`Trial publicado: ${code}`);
}

fs.copyFileSync(path.join(landingRoot, 'index.html'), path.join(landingRoot, 'public', 'index.html'));
console.log('Catálogo publicado en public/index.html');