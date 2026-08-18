// config/module.js
// Metadatos del módulo para registrarlo en el ERP principal.
module.exports = {
  code: 'tambo',
  name: 'Tambo',
  version: '0.1.0',
  description: 'Gestión de explotación lechera: rodeo, producción, reproducción, sanidad, alimentación, pasturas, entrega a usina y personal.',
  basePath: '/tambo',
  menu: [
    { label: 'Rodeo',         path: '/tambo/rodeo' },
    { label: 'Producción',    path: '/tambo/produccion' },
    { label: 'Reproducción',  path: '/tambo/reproduccion' },
    { label: 'Sanidad',       path: '/tambo/sanidad' },
    { label: 'Alimentación',  path: '/tambo/alimentacion' },
    { label: 'Pasturas',      path: '/tambo/pasturas' },
    { label: 'Usina',         path: '/tambo/usina' },
    { label: 'Personal',      path: '/tambo/personal' },
  ],
};
