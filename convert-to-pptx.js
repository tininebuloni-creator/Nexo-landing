const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const html2canvas = require('html2canvas');
const { JSDOM } = require('jsdom');

async function convertHtmlToPptx() {
  // Leer el archivo HTML
  const htmlPath = path.join(__dirname, 'presentacion-pampa-agro.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Crear una instancia de JSDOM para renderizar el HTML
  const dom = new JSDOM(htmlContent, {
    url: `file://${htmlPath}`,
    pretendToBeVisualBrowser: true,
    resources: 'usable'
  });

  const { document, window } = dom.window;
  
  // Obtener todas las diapositivas
  const slides = document.querySelectorAll('.slide');
  console.log(`Encontradas ${slides.length} diapositivas`);

  // Crear presentación
  const prs = new PptxGenJS();
  prs.defineLayout({ name: 'LAYOUT1', width: 10, height: 7.5 });
  prs.defineLayout({ name: 'LAYOUT2', width: 13.333, height: 7.5 });
  prs.defineLayout({ name: 'BLANK', width: 10, height: 7.5 });
  
  // Procesar cada diapositiva
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    
    try {
      // Mostrar solo esta diapositiva
      slides.forEach((s, idx) => {
        s.style.display = idx === i ? 'flex' : 'none';
      });

      // Renderizar la diapositiva a canvas
      const canvas = await html2canvas(slide, {
        scale: 2,
        logging: false,
        useCORS: true,
        backgroundColor: '#0f1419',
        width: slide.offsetWidth || 1280,
        height: slide.offsetHeight || 960
      });

      // Convertir canvas a imagen base64
      const imgData = canvas.toDataURL('image/png');

      // Agregar página a la presentación
      const pageLayout = 'LAYOUT1';
      const slide_obj = prs.addSlide();
      slide_obj.background = { color: '0f1419' };
      
      // Agregar imagen a toda la página
      slide_obj.addImage({
        data: imgData,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%'
      });

      console.log(`✓ Diapositiva ${i + 1}/${slides.length} procesada`);
    } catch (err) {
      console.error(`✗ Error en diapositiva ${i + 1}:`, err.message);
    }
  }

  // Guardar la presentación
  const outputPath = path.join(__dirname, 'presentacion-pampa-agro.pptx');
  await prs.writeFile(outputPath);
  
  console.log(`\n✅ PPTX generado correctamente: ${outputPath}`);
}

convertHtmlToPptx().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
