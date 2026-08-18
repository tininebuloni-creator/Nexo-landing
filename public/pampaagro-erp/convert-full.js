const fs = require('fs');
const path = require('path');
const http = require('http');
const PptxGenJS = require('pptxgenjs');

// Crear servidor local temporal
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    const htmlPath = path.join(__dirname, 'presentacion-pampaagro.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function convertHtmlToPptx() {
  return new Promise((resolve, reject) => {
    server.listen(3000, async () => {
      try {
        console.log('🌐 Iniciando renderizado con Puppeteer...');
        const puppeteer = require('puppeteer');
        
        const browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const prs = new PptxGenJS();
        
        // Procesar cada diapositiva (1 a 11)
        for (let slideNum = 1; slideNum <= 11; slideNum++) {
          const page = await browser.newPage();
          
          // Configurar viewport
          await page.setViewport({ width: 1280, height: 960 });
          
          // Navegar a la página
          await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
          });
          
          // Simular click en la diapositiva correcta
          if (slideNum > 1) {
            await page.evaluate((num) => {
              const goTo = window.goTo;
              if (goTo) goTo(num);
            }, slideNum);
            
            // Esperar a que se renderice
            await new Promise(resolve => setTimeout(resolve, 600));
          }
          
          // Capturar la diapositiva como PNG
          const screenshot = await page.screenshot({ 
            type: 'png',
            fullPage: false 
          });
          
          // Convertir a base64
          const imgData = 'data:image/png;base64,' + screenshot.toString('base64');
          
          // Agregar a la presentación
          const slide = prs.addSlide();
          slide.background = { color: '0f1419' };
          
          slide.addImage({
            data: imgData,
            x: 0,
            y: 0,
            w: '100%',
            h: '100%'
          });
          
          await page.close();
          console.log(`✓ Diapositiva ${slideNum}/11 capturada`);
        }
        
        await browser.close();
        
        // Guardar presentación
        const outputPath = path.join(__dirname, 'presentacion-pampaagro-full.pptx');
        await prs.writeFile({ fileName: outputPath });
        
        console.log(`\n✅ PPTX completo generado: ${outputPath}`);
        resolve();
        
      } catch (err) {
        console.error('❌ Error:', err.message);
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

convertHtmlToPptx()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
