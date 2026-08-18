const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  'electron/main.js',
  'electron/preload.js',
  'server.js',
  'routes/index.js',
  'controllers/license.controller.js',
];

function compileTarget(relativeFile) {
  const input = path.join(ROOT, relativeFile);
  const output = input.replace(/\.js$/i, '.jsc');
  if (!fs.existsSync(input)) {
    throw new Error(`No existe el archivo a compilar: ${relativeFile}`);
  }

  bytenode.compileFile({
    filename: input,
    output,
  });

  console.log(`[protect:bytecode] Compilado: ${relativeFile} -> ${path.relative(ROOT, output)}`);
}

function main() {
  TARGETS.forEach(compileTarget);
  console.log('[protect:bytecode] Bytecode listo.');
}

try {
  main();
} catch (error) {
  console.error('[protect:bytecode] Error:', error.message || error);
  process.exit(1);
}
