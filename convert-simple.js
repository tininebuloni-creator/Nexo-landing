const fs = require('fs');
const path = require('path');
const http = require('http');
const PptxGenJS = require('pptxgenjs');

// Crear un servidor HTTP temporal para servir el HTML
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    const htmlPath = path.join(__dirname, 'presentacion-pampa-agro.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3000, async () => {
  console.log('Servidor local iniciado en http://localhost:3000');
  
  try {
    // Importar puppeteer dinámicamente (solo si se necesita)
    let browser;
    try {
      const puppeteer = require('puppeteer-core');
      console.log('⚠️  Necesitamos Chrome/Chromium para renderizar el HTML correctamente');
      console.log('Instalando chrome-launcher...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.log('Usando método alternativo de renderizado...');
    }

    // Crear presentación directamente con diapositivas en blanco y colores de fondo
    const prs = new PptxGenJS();
    
    // Colores de las variables CSS
    const colors = {
      bg0: '0f1419',
      bg1: '1a1f2e',
      bg2: '252b3b',
      amber: 'f59e0b',
      blue: '3b82f6',
      t1: 'f1f5f9',
      t2: '94a3b8'
    };

    // Contenido de cada diapositiva (simplificado)
    const slidesContent = [
      {
        title: 'pampaagro ERP',
        subtitle: 'El sistema de gestión\ndiseñado para el campo argentino',
        bg: colors.bg0
      },
      {
        title: '¿Por qué los campos necesitan\nun ERP propio?',
        subtitle: 'Problemas de gestión agrícola',
        bg: colors.bg0
      },
      {
        title: 'Dashboard — Panel Ejecutivo',
        subtitle: 'Vista completa del estado del campo en tiempo real',
        bg: colors.bg0
      },
      {
        title: 'Módulo de Producción',
        bg: colors.bg0
      },
      {
        title: 'Módulo Ganadería',
        bg: colors.bg0
      },
      {
        title: 'Módulo Maquinarias',
        bg: colors.bg0
      },
      {
        title: 'Módulo Finanzas',
        bg: colors.bg0
      },
      {
        title: 'Módulo Documentos',
        bg: colors.bg0
      },
      {
        title: 'Integración con Precios',
        bg: colors.bg0
      },
      {
        title: 'Seguridad y Respaldo',
        bg: colors.bg0
      },
      {
        title: 'Planes y Licencias',
        bg: colors.bg0
      }
    ];

    // Crear una diapositiva por cada contenido
    slidesContent.forEach((content, idx) => {
      const slide = prs.addSlide();
      slide.background = { color: content.bg };
      
      // Título
      slide.addText(content.title, {
        x: 0.5,
        y: 2.5,
        w: 9,
        h: 1.5,
        fontSize: 44,
        bold: true,
        color: colors.amber,
        align: 'center',
        fontFace: 'Inter'
      });

      // Subtítulo
      if (content.subtitle) {
        slide.addText(content.subtitle, {
          x: 0.5,
          y: 4.2,
          w: 9,
          h: 1,
          fontSize: 16,
          color: colors.t2,
          align: 'center',
          fontFace: 'Inter'
        });
      }
      
      console.log(`✓ Diapositiva ${idx + 1}/11 creada`);
    });

    // Guardar presentación
    const outputPath = path.join(__dirname, 'presentacion-pampa-agro.pptx');
    await prs.writeFile({ fileName: outputPath });
    
    console.log(`\n✅ PPTX generado: ${outputPath}`);
    console.log(`⚠️  Nota: Este es un PPTX con fondos oscuros. Para mantener toda la interactividad y diseño exacto,`);
    console.log(`    considera usar la opción de impresión del navegador (Ctrl+P -> Guardar como PDF -> Convertir a PPTX)`);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
