// Clave publica Ed25519 para verificar licencias de PampaAgro ERP.
// Generada por scripts/generate-keypair.js. Puede distribuirse con la app.
(function (root, factory) {
  const key = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = key;
  if (root) root.PAMPAAGRO_LICENSE_PUBLIC_KEY = key;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAL9DPyz4V/LmNh6qx1k3mvLKE7ymnGubbN5FImnBpQ+0=
-----END PUBLIC KEY-----
`;
}));
