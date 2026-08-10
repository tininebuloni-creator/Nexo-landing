const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKUP_SUFFIX = '.obf-backup';
const STRICT_EXCLUSION_PATHS = [
  'node_modules/**',
  'electron/**',
  'scripts/**',
  'build/**',
  'release/**',
  'release-dist/**',
  'release-dist-*/**',
  'dist/**',
  'pack-*/**',
  '*.exe',
  '*.blockmap',
  '*.zip',
  '*.json',
  '*.pdf',
  '*.docx'
];

// Hook de ofuscacion: solo procesa logica de modulos en renderer.
const targets = [
  { type: 'html-inline-script', file: path.join(ROOT_DIR, 'nexo-agro-erp.html') }
];

const OBFUSCATION_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,
  selfDefending: true,
  simplify: true,
  numbersToExpressions: true,
  splitStrings: true,
  splitStringsChunkLength: 4,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: true
};

function getBackupPath(filePath) {
  return filePath + BACKUP_SUFFIX;
}

function normalizeRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function isStrictlyExcluded(filePath) {
  const rel = normalizeRelative(filePath);
  if (!rel || rel.startsWith('..')) return true;

  return STRICT_EXCLUSION_PATHS.some((rule) => {
    const normalizedRule = String(rule).replace(/\\/g, '/');

    if (!normalizedRule.includes('*')) {
      return rel === normalizedRule;
    }

    const regexText = normalizedRule
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DOUBLE_STAR::')
      .replace(/\*/g, '[^/]*')
      .replace(/::DOUBLE_STAR::/g, '.*');

    return new RegExp('^' + regexText + '$', 'i').test(rel);
  });
}

function ensureTargetExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo objetivo: ${filePath}`);
  }
}

function backupFile(filePath) {
  const backupPath = getBackupPath(filePath);
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

function restoreFile(filePath) {
  const backupPath = getBackupPath(filePath);
  if (!fs.existsSync(backupPath)) return false;

  fs.copyFileSync(backupPath, filePath);
  fs.unlinkSync(backupPath);
  return true;
}

function obfuscateJavaScript(code, optionOverrides = {}) {
  const options = { ...OBFUSCATION_OPTIONS, ...optionOverrides };
  const result = JavaScriptObfuscator.obfuscate(code, options);
  return result.getObfuscatedCode();
}

function getReservedGlobalNamesFromHtml(html) {
  const names = new Set();
  const attrCallRegex = /\bon\w+\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/gi;
  const jsHrefRegex = /\bhref\s*=\s*["']\s*javascript:\s*([A-Za-z_$][\w$]*)\s*\(/gi;

  let match = null;
  while ((match = attrCallRegex.exec(html)) !== null) {
    names.add(match[1]);
  }

  while ((match = jsHrefRegex.exec(html)) !== null) {
    names.add(match[1]);
  }

  return Array.from(names);
}

function obfuscateJsFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const obfuscated = obfuscateJavaScript(original);
  fs.writeFileSync(filePath, obfuscated, 'utf8');
}

function obfuscateInlineScriptsInHtml(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const reservedNames = getReservedGlobalNamesFromHtml(html);
  const optionOverrides = {
    reservedNames
  };

  const nextHtml = html.replace(scriptRegex, (fullMatch, attrs, body) => {
    if (/\bsrc\s*=\s*/i.test(attrs)) return fullMatch;
    if (!String(body || '').trim()) return fullMatch;
    if (/\btype\s*=\s*["']application\/(ld\+json|json)["']/i.test(attrs)) return fullMatch;

    const obfuscated = obfuscateJavaScript(body, optionOverrides).replace(/<\/script>/gi, '<\\/script>');
    return `<script${attrs}>${obfuscated}</script>`;
  });

  fs.writeFileSync(filePath, nextHtml, 'utf8');
}

function applyObfuscation() {
  targets.forEach(({ file }) => ensureTargetExists(file));

  targets.forEach(({ file, type }) => {
    if (isStrictlyExcluded(file)) {
      throw new Error(`Archivo excluido por politica estricta: ${normalizeRelative(file)}`);
    }

    backupFile(file);

    if (type === 'js') {
      obfuscateJsFile(file);
    } else if (type === 'html-inline-script') {
      obfuscateInlineScriptsInHtml(file);
    }

    console.log(`Ofuscado: ${path.relative(ROOT_DIR, file)}`);
  });
}

function restoreObfuscation() {
  let restored = 0;

  targets.forEach(({ file }) => {
    if (restoreFile(file)) {
      restored += 1;
      console.log(`Restaurado: ${path.relative(ROOT_DIR, file)}`);
    }
  });

  if (restored === 0) {
    console.log('No habia backups para restaurar.');
  }
}

function printHelp() {
  console.log('Uso: node scripts/obfuscate-electron.js <apply|restore>');
  console.log('Exclusion estricta activa (no se ofusca electron-builder ni estructura interna).');
}

function main() {
  const action = String(process.argv[2] || '').toLowerCase();

  if (action === 'apply') {
    applyObfuscation();
    return;
  }

  if (action === 'restore') {
    restoreObfuscation();
    return;
  }

  printHelp();
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error('Error en obfuscacion:', error.message);
  process.exit(1);
}
