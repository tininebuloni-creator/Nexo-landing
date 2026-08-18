const path = require('path');
const fs = require('fs');
const express = require('express');

let bytenodeReady = false;

function ensureBytenode() {
  if (bytenodeReady) return true;
  try {
    require('bytenode');
    bytenodeReady = true;
    return true;
  } catch {
    return false;
  }
}

function requireProtected(modulePath) {
  const basePath = path.resolve(__dirname, modulePath);
  const jscPath = `${basePath}.jsc`;
  if (fs.existsSync(jscPath) && ensureBytenode()) {
    return require(jscPath);
  }
  const jscIndexPath = path.join(basePath, 'index.jsc');
  if (fs.existsSync(jscIndexPath) && ensureBytenode()) {
    return require(jscIndexPath);
  }
  return require(modulePath);
}

const tamboRoutes = requireProtected('./routes');

function createApp() {
  const app = express();
  const preferredPublicDir = process.env.TAMBO_PUBLIC_DIR || 'public_protected';
  const preferredPublicPath = path.join(__dirname, preferredPublicDir);
  const fallbackPublicPath = path.join(__dirname, 'public');
  const publicPath = fs.existsSync(preferredPublicPath) ? preferredPublicPath : fallbackPublicPath;

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(express.json());
  app.use('/tambo', tamboRoutes);
  app.use(express.static(publicPath));

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Error interno',
    });
  });

  return app;
}

function startServer(port = process.env.PORT || 3000) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[tambo] http://localhost:${port}`);
  });
  return { app, server, port };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer,
};
