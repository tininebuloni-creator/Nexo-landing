const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');
const isSignedBuild = process.argv.includes('--signed');
const skipObfuscation = process.argv.includes('--no-obfuscate');

const PACK_DEFINITIONS = [
  {
    key: 'basica',
    label: 'Básica',
    fileLabel: 'Basica',
    defaultRole: 'oficina',
    defaultLicensePlan: 'basica',
    moduleHighlights: ['dashboard', 'caja', 'bancos', 'creditos', 'costos', 'reportes']
  },
  {
    key: 'profesional',
    label: 'Profesional',
    fileLabel: 'Profesional',
    defaultRole: 'administracion',
    defaultLicensePlan: 'profesional',
    moduleHighlights: ['dashboard', 'campos', 'lotes', 'siembra', 'hacienda', 'caja', 'bancos', 'creditos', 'costos', 'reportes']
  },
  {
    key: 'premium',
    label: 'Premium',
    fileLabel: 'Premium',
    defaultRole: 'propietario',
    defaultLicensePlan: 'premium',
    moduleHighlights: ['acceso completo', 'maquinarias', 'inventario', 'finanzas', 'documentos', 'reportes']
  }
];

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

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function writeJsonFile(targetPath, data) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
}

function listExeArtifacts(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => path.join(outputDir, name));
}

function pickMainExe(exeArtifacts) {
  return (
    exeArtifacts.find((file) => /portable/i.test(path.basename(file))) ||
    exeArtifacts.find((file) => /setup/i.test(path.basename(file))) ||
    exeArtifacts[0] ||
    null
  );
}

function buildPackReadme(pack) {
  const highlights = Array.isArray(pack.moduleHighlights) ? pack.moduleHighlights : [];
  return [
    `# Pack ${pack.label}`,
    '',
    'Contenido del pack:',
    '- Ejecutable de escritorio para la version correspondiente',
    '- index.html de la app',
    '- settings.json con la configuracion por defecto',
    '- README de entrega',
    '',
    'Configuracion base:',
    `- Rol inicial: ${pack.defaultRole}`,
    `- Plan inicial: ${pack.defaultLicensePlan}`,
    '',
    'Modulos destacados incluidos:',
    ...highlights.map((moduleName) => `- ${moduleName}`),
    '',
    'Nota comercial:',
    'El codigo de activacion se entrega al cliente al momento de la compra.',
    '',
    'Uso sugerido:',
    `- Pack ${pack.label} para clientes que contratan la version ${pack.label.toLowerCase()}.`
  ].join('\n');
}

function createVersionPacks(outputDir) {
  const exeArtifacts = listExeArtifacts(outputDir);
  if (!exeArtifacts.length) {
    throw new Error(`No se encontraron ejecutables en ${outputDir}`);
  }

  const mainExe = pickMainExe(exeArtifacts);
  if (!mainExe) {
    throw new Error(`No se pudo determinar el ejecutable principal en ${outputDir}`);
  }

  const packRoot = path.join(outputDir, 'pack-cliente');
  const webIndex = path.join(__dirname, '..', 'public', 'index.html');

  PACK_DEFINITIONS.forEach((pack) => {
    const packDir = path.join(packRoot, pack.key);
    ensureDir(packDir);

    const exeName = `PampaAgro ERP - ${pack.fileLabel}.exe`;
    copyFileSafe(mainExe, path.join(packDir, exeName));

    exeArtifacts.forEach((artifactPath) => {
      if (artifactPath === mainExe) return;
      copyFileSafe(artifactPath, path.join(packDir, path.basename(artifactPath)));
    });

    if (fs.existsSync(webIndex)) {
      copyFileSafe(webIndex, path.join(packDir, 'index.html'));
    }

    writeJsonFile(path.join(packDir, 'settings.json'), {
      appRole: pack.defaultRole,
      defaultLicensePlan: pack.defaultLicensePlan,
      packName: `PACK-${pack.defaultLicensePlan.toUpperCase()}`,
      versionLabel: pack.label,
      deliveredCode: 'Se entrega al momento de la compra'
    });

    fs.writeFileSync(path.join(packDir, 'README.md'), buildPackReadme(pack), 'utf8');
  });

  console.log(`Packs por version generados en: ${packRoot}`);
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

  createVersionPacks(outputDir);
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
