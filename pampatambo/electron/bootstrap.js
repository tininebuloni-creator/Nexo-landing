const fs = require('fs');
const path = require('path');

try {
  require('bytenode');
} catch (error) {
  // Fallback a JS plano si bytenode no está disponible en entorno de desarrollo.
}

const mainJsc = path.join(__dirname, 'main.jsc');
if (fs.existsSync(mainJsc)) {
  require(mainJsc);
} else {
  require('./main.js');
}
