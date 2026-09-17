const fs = require('fs');
const path = require('path');

const landingRoot = path.resolve(__dirname, '..');
const projectsRoot = path.resolve(landingRoot, '..');
const appRoot = path.join(projectsRoot, 'PAMPA N-ecosystem', 'apps', 'pampatambo');
const publicSource = path.join(appRoot, 'public');
const indexSource = path.join(appRoot, 'index.html');
const targets = [
  path.join(landingRoot, 'pampatambo-erp'),
  path.join(landingRoot, 'public', 'pampatambo-erp')
];

function copyDirContents(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) fs.cpSync(src, dest, { recursive: true, force: true });
    else fs.copyFileSync(src, dest);
  }
}

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
  copyDirContents(publicSource, target);
  fs.copyFileSync(indexSource, path.join(target, 'index.html'));
  console.log(`[tambo-app] actualizado: ${path.relative(landingRoot, target)}`);
}
