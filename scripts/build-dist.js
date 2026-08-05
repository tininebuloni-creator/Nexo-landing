const { spawnSync } = require('child_process');
const path = require('path');
const isSignedBuild = process.argv.includes('--signed');
const skipObfuscation = process.argv.includes('--no-obfuscate');

function runNodeScript(scriptRelativePath, args = []) {
  const scriptPath = path.join(__dirname, scriptRelativePath);
  const step = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false
  });

  if (step.status !== 0) {
    const error = new Error(`Fallo ejecutando ${scriptRelativePath} ${args.join(' ')}`.trim());
    error.exitCode = step.status || 1;
    throw error;
  }
}

let exitCode = 0;

try {
  if (!skipObfuscation) {
    console.log('Aplicando ofuscacion de JavaScript...');
    runNodeScript('obfuscate-electron.js', ['apply']);
  }

  const iconStep = spawnSync(process.execPath, ['scripts/make-icon.js'], {
    stdio: 'inherit',
    shell: false
  });

  if (iconStep.status !== 0) {
    const error = new Error('Fallo la generacion de icono');
    error.exitCode = iconStep.status || 1;
    throw error;
  }

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+$/, '')
  .replace('T', '-');

const outputDir = `release-dist-${stamp}`;
console.log(`Generando instaladores en: ${outputDir}`);

const builderCli = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron-builder',
  'out',
  'cli',
  'cli.js'
);

const args = [
  builderCli,
  '--win',
  'nsis',
  'portable',
  `--config.directories.output=${outputDir}`
];

if (isSignedBuild) {
  if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) {
    const error = new Error('Build firmado requiere CSC_LINK y CSC_KEY_PASSWORD en variables de entorno.');
    error.exitCode = 1;
    throw error;
  }

  args.push('--config.win.signAndEditExecutable=true');
  console.log('Modo firmado activado.');
}

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  const error = new Error(`Error ejecutando electron-builder: ${result.error.message}`);
  error.exitCode = 1;
  throw error;
}

if (result.status !== 0) {
  const error = new Error(`electron-builder finalizo con codigo ${result.status}`);
  error.exitCode = result.status || 1;
  throw error;
}

console.log(`Build finalizado en: ${outputDir}`);
} catch (error) {
  exitCode = error.exitCode || 1;
  console.error(error.message || 'Error en build-dist');
} finally {
  if (!skipObfuscation) {
    try {
      console.log('Restaurando fuentes sin ofuscar...');
      runNodeScript('obfuscate-electron.js', ['restore']);
    } catch (restoreError) {
      console.error(restoreError.message || 'Error restaurando fuentes');
      if (exitCode === 0) exitCode = restoreError.exitCode || 1;
    }
  }
}

process.exit(exitCode);
