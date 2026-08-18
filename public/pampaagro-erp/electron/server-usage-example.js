/**
 * EJEMPLO DE USO DEL SERVIDOR DINÁMICO
 * 
 * El servidor Express se inicia automáticamente cuando abre la app.
 * Usa un puerto dinámico (asignado por el SO).
 */

// Obtener el puerto del servidor
async function getServerInfo() {
  const result = await window.electronAPI.getServerUrl();
  
  if (result.ok && result.url) {
    console.log('✓ Servidor activo en:', result.url);
    console.log('Puerto:', result.port);
    return result;
  } else {
    console.error('✗ No hay servidor disponible');
    return null;
  }
}

// Ejemplo 1: Verificar salud del servidor
async function checkServerHealth() {
  const info = await getServerInfo();
  if (!info) return;

  try {
    const response = await fetch(`${info.url}/api/health`);
    const data = await response.json();
    console.log('Health Check:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Ejemplo 2: Obtener información del servidor
async function getServerData() {
  const info = await getServerInfo();
  if (!info) return;

  try {
    const response = await fetch(`${info.url}/api/server-info`);
    const data = await response.json();
    console.log('Server Info:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Ejemplo 3: Enviar datos POST
async function sendData(payload) {
  const info = await getServerInfo();
  if (!info) return;

  try {
    const response = await fetch(`${info.url}/api/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log('Response:', data);
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}

// Uso en HTML
/*
<button onclick="checkServerHealth()">Check Server</button>
<button onclick="getServerData()">Get Server Info</button>
<button onclick="sendData({test: 'data'})">Send Data</button>
*/

// Al cargar la página
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Inicializando...');
  await getServerInfo();
});
