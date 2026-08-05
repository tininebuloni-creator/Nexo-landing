const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');
const jimpModule = require('jimp');
const Jimp = jimpModule.Jimp || jimpModule;

async function createBlankImage(width, height, background) {
  try {
    return await new Jimp({ width, height, background });
  } catch (_err) {
    return await new Promise((resolve, reject) => {
      new Jimp(width, height, background, (err, img) => {
        if (err) reject(err);
        else resolve(img);
      });
    });
  }
}

async function writeImage(image, filePath) {
  if (typeof image.writeAsync === 'function') {
    await image.writeAsync(filePath);
    return;
  }

  await new Promise((resolve, reject) => {
    image.write(filePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const inputPng = path.join(root, 'logo.png');
  const outDir = path.join(root, 'build');
  const tempPng = path.join(outDir, 'icon-square-temp.png');
  const outputIco = path.join(outDir, 'icon.ico');

  if (!fs.existsSync(inputPng)) {
    throw new Error(`No se encontro logo base: ${inputPng}`);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const image = await Jimp.read(inputPng);
  const side = 256;
  const maxInner = 220;

  // Compatibilidad: Jimp antiguo usa (w, h), Jimp nuevo usa objeto.
  try {
    image.scaleToFit(maxInner, maxInner);
  } catch (_err) {
    image.scaleToFit({ w: maxInner, h: maxInner });
  }

  const canvas = await createBlankImage(side, side, 0x00000000);
  const x = Math.floor((side - image.bitmap.width) / 2);
  const y = Math.floor((side - image.bitmap.height) / 2);
  canvas.composite(image, x, y);
  await writeImage(canvas, tempPng);

  const icoBuffer = await pngToIco([tempPng]);
  if (!icoBuffer) {
    throw new Error('No se pudo generar el buffer .ico');
  }
  fs.writeFileSync(outputIco, icoBuffer);
  if (fs.existsSync(tempPng)) fs.unlinkSync(tempPng);

  console.log(`Icono generado: ${outputIco}`);
}

main().catch((error) => {
  console.error('Error generando icono .ico:', error.message);
  if (error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
