const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createIAHandlers } = require('@pampa/core-ia/httpApi');

const app = express();
const port = Number(process.env.PORT || 3121);
const publicDir = __dirname;
const iaHandlers = createIAHandlers();
const isDesktopMode = process.env.PAMPA_DESKTOP_MODE === '1';

app.use('/api/ia', express.json({ limit: process.env.AI_PAYLOAD_LIMIT || '25mb' }));
app.get('/api/ia/estado', iaHandlers.status);
app.post('/api/ia/consulta', iaHandlers.consulta);
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'PampaPorcinos', version: '1.1.1' }));
app.get('/', (req, res, next) => {
  if (!isDesktopMode) return next();
  try {
    const desktopIndex = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
      .replace(/\s*<script src="\.\/pampa-trial-links\.js"><\/script>/, '')
      .replace('</head>', `<script>(function(){try{const raw=JSON.parse(localStorage.getItem('PampaPorcinosLicense')||'null');if(raw&&raw.type==='trial')localStorage.removeItem('PampaPorcinosLicense')}catch(error){localStorage.removeItem('PampaPorcinosLicense')}window.history.replaceState({},document.title,window.location.pathname+window.location.hash)})()</script></head>`);
    return res.type('html').send(desktopIndex);
  } catch (error) {
    return next(error);
  }
});
app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

function startServer(listenPort = port) {
  const server = app.listen(listenPort, '127.0.0.1', () => {
    console.log(`PampaPorcinos ERP disponible en http://127.0.0.1:${listenPort}/`);
  });
  return { app, server };
}

if (require.main === module) startServer();

module.exports = { app, startServer };
