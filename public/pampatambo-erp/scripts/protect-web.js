const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'public');
const OUT_DIR = path.join(ROOT, 'public_protected');
const HTML_FILES = ['index.html', 'generador-licencias.html'];
const STATIC_FILES = ['logo2.png'];

const OBFUSCATOR_OPTIONS = {
  compact: true,
  simplify: true,
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  rotateStringArray: true,
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  unicodeEscapeSequence: false,
  deadCodeInjection: false,
  controlFlowFlattening: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function obfuscateInlineScripts(html) {
  return html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, content) => {
    const code = content.trim();
    if (!code) return full;

    const result = JavaScriptObfuscator
      .obfuscate(code, OBFUSCATOR_OPTIONS)
      .getObfuscatedCode()
      .replace(/<\/script/gi, '<\\/script');
    return `<script${attrs}>\n${result}\n</script>`;
  });
}

function processHtmlFile(fileName) {
  const inputPath = path.join(SRC_DIR, fileName);
  const outputPath = path.join(OUT_DIR, fileName);

  const source = fs.readFileSync(inputPath, 'utf8');
  const withObfuscatedJs = obfuscateInlineScripts(source);
  fs.writeFileSync(outputPath, withObfuscatedJs, 'utf8');
}

function copyStaticFiles() {
  for (const fileName of STATIC_FILES) {
    const src = path.join(SRC_DIR, fileName);
    const dst = path.join(OUT_DIR, fileName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }
}

async function main() {
  ensureDir(OUT_DIR);

  for (const fileName of HTML_FILES) processHtmlFile(fileName);

  copyStaticFiles();
  console.log('[protect:web] Assets protegidos en public_protected/');
}

main().catch((error) => {
  console.error('[protect:web] Error:', error);
  process.exit(1);
});
