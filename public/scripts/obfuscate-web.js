const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT_DIR, 'pampaganaderia-erp', 'index.html');
const BACKUP = `${TARGET}.obf-backup`;

const OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayCallsTransform: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  transformObjectKeys: true
};

function getReservedGlobalNames(html) {
  const names = new Set();
  const attributeCalls = /\bon\w+\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/gi;
  const javascriptLinks = /\bhref\s*=\s*["']\s*javascript:\s*([A-Za-z_$][\w$]*)\s*\(/gi;

  for (const match of html.matchAll(attributeCalls)) names.add(match[1]);
  for (const match of html.matchAll(javascriptLinks)) names.add(match[1]);

  return [...names];
}

function obfuscateHtml(html) {
  const reservedNames = getReservedGlobalNames(html);
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  return html.replace(scriptRegex, (fullMatch, attributes, body) => {
    if (!body.trim() || /\bsrc\s*=\s*/i.test(attributes)) return fullMatch;
    if (/\btype\s*=\s*["']application\/(ld\+json|json)["']/i.test(attributes)) return fullMatch;

    const code = JavaScriptObfuscator.obfuscate(body, {
      ...OPTIONS,
      reservedNames
    }).getObfuscatedCode();

    return `<script${attributes}>${code.replace(/<\/script>/gi, '<\\/script>')}</script>`;
  });
}

function apply() {
  if (!fs.existsSync(TARGET)) throw new Error(`No existe ${TARGET}`);
  if (!fs.existsSync(BACKUP)) fs.copyFileSync(TARGET, BACKUP);
  const source = fs.readFileSync(TARGET, 'utf8');
  fs.writeFileSync(TARGET, obfuscateHtml(source), 'utf8');
  console.log(`Ofuscado: ${path.relative(process.cwd(), TARGET)}`);
}

function restore() {
  if (!fs.existsSync(BACKUP)) throw new Error('No existe una copia de respaldo para restaurar.');
  fs.copyFileSync(BACKUP, TARGET);
  fs.unlinkSync(BACKUP);
  console.log(`Restaurado: ${path.relative(process.cwd(), TARGET)}`);
}

const action = String(process.argv[2] || '').toLowerCase();
if (action === 'apply') apply();
else if (action === 'restore') restore();
else throw new Error('Uso: node scripts/obfuscate-web.js <apply|restore>');
