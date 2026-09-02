const path = require('path');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createAIRouter } = require('../pampaagro/services/aiRoutes');

const app = express();
const port = Number(process.env.PORT || 3121);
const publicDir = __dirname;

app.use(express.static(publicDir));
app.use('/api/ia', createAIRouter());
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'PampaPorcinos', version: '1.1.1' }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

if (require.main === module) {
  app.listen(port, '127.0.0.1', () => console.log(`PampaPorcinos ERP disponible en http://127.0.0.1:${port}/`));
}

module.exports = app;
