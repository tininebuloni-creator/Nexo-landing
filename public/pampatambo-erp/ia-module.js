(function () {
  const MODULE_ID = 'pampa-core-ia';

  function addStyles() {
    if (document.getElementById(`${MODULE_ID}-styles`)) return;
    const style = document.createElement('style');
    style.id = `${MODULE_ID}-styles`;
    style.textContent = `
      #${MODULE_ID}-modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, .58); z-index: 10050; }
      #${MODULE_ID}-modal.is-open { display: flex; }
      .pampa-ia-dialog { width: min(680px, 100%); max-height: min(680px, 92vh); display: flex; flex-direction: column; gap: 14px; padding: 20px; border: 1px solid #5f8668; border-radius: 8px; color: #f4f7f2; background: #17261e; box-shadow: 0 20px 60px rgba(0,0,0,.45); font-family: inherit; }
      .pampa-ia-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:18px; font-weight:700; }
      .pampa-ia-close, .pampa-ia-send { border: 1px solid #779b60; border-radius: 5px; padding: 8px 12px; color: inherit; background: #254333; cursor: pointer; font: inherit; }
      .pampa-ia-close { background: transparent; }
      .pampa-ia-status { font-size: 13px; color: #c8d9c5; }
      .pampa-ia-chat { min-height: 160px; max-height: 320px; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid #476a52; border-radius:6px; background:#102018; }
      .pampa-ia-message { max-width:88%; padding:9px 11px; border-radius:6px; line-height:1.45; font-size:13px; white-space:pre-wrap; }
      .pampa-ia-user { align-self:flex-end; background:#2c5b48; }
      .pampa-ia-assistant { align-self:flex-start; background:#25362b; }
      .pampa-ia-compose { display:flex; gap:10px; }
      .pampa-ia-input { flex:1; min-height:72px; resize:vertical; padding:9px; border:1px solid #476a52; border-radius:5px; color:inherit; background:#102018; font:inherit; }
      .pampa-ia-nav { cursor:pointer; }
    `;
    document.head.appendChild(style);
  }

  function appendMessage(role, text) {
    const chat = document.querySelector(`#${MODULE_ID}-chat`);
    const message = document.createElement('div');
    message.className = `pampa-ia-message pampa-ia-${role}`;
    message.textContent = text;
    chat.appendChild(message);
    chat.scrollTop = chat.scrollHeight;
  }

  async function open() {
    const modal = document.querySelector(`#${MODULE_ID}-modal`);
    const status = document.querySelector(`#${MODULE_ID}-status`);
    const chat = document.querySelector(`#${MODULE_ID}-chat`);
    modal.classList.add('is-open');
    chat.replaceChildren();
    status.textContent = 'Verificando configuración...';
    try {
      const response = await fetch('/api/ia/estado');
      const data = await response.json();
      status.textContent = data.configurado ? `Listo (${data.modelo || data.modelos?.texto || 'IA'})` : 'Sin clave configurada';
      appendMessage('assistant', data.configurado ? 'Puedo analizar el contexto local de esta aplicación. No modifico registros.' : 'La IA está incluida, pero esta instalación todavía no tiene una clave configurada.');
    } catch {
      status.textContent = 'Servicio no disponible';
      appendMessage('assistant', 'No se pudo conectar al servicio local de IA.');
    }
  }

  function close() {
    document.querySelector(`#${MODULE_ID}-modal`).classList.remove('is-open');
  }

  async function send() {
    const input = document.querySelector(`#${MODULE_ID}-input`);
    const button = document.querySelector(`#${MODULE_ID}-send`);
    const pregunta = input.value.trim();
    if (!pregunta) return;
    appendMessage('user', pregunta);
    input.value = '';
    button.disabled = true;
    try {
      const response = await fetch('/api/ia/consulta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pregunta }) });
      const data = await response.json();
      appendMessage('assistant', data.ok ? data.respuesta : data.error || 'No se pudo procesar la consulta.');
    } catch {
      appendMessage('assistant', 'No se pudo contactar al servicio local de IA.');
    } finally {
      button.disabled = false;
    }
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.id = `${MODULE_ID}-modal`;
    modal.innerHTML = `
      <section class="pampa-ia-dialog" role="dialog" aria-modal="true" aria-label="Asistente IA">
        <div class="pampa-ia-heading"><span>🤖 Asistente de IA</span><button class="pampa-ia-close" type="button">Cerrar</button></div>
        <div class="pampa-ia-status" id="${MODULE_ID}-status"></div>
        <div class="pampa-ia-chat" id="${MODULE_ID}-chat"></div>
        <div class="pampa-ia-compose"><textarea class="pampa-ia-input" id="${MODULE_ID}-input" placeholder="Escribí tu consulta..."></textarea><button class="pampa-ia-send" id="${MODULE_ID}-send" type="button">Enviar</button></div>
      </section>`;
    modal.querySelector('.pampa-ia-close').addEventListener('click', close);
    modal.querySelector(`#${MODULE_ID}-send`).addEventListener('click', send);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.body.appendChild(modal);
  }

  function createMenuItem() {
    const precisionNav = document.querySelector('.nav');
    const item = document.createElement(precisionNav ? 'button' : 'div');
    item.className = precisionNav ? 'pampa-ia-nav' : 'nav-item pampa-ia-nav';
    if (precisionNav) item.type = 'button';
    item.dataset.coreIa = 'true';
    item.innerHTML = precisionNav ? '<b class="nav-icon">🤖</b><span>Asistente IA</span>' : '<span class="nav-icon">🤖</span> Asistente IA';
    item.addEventListener('click', open);
    const dashboardItem = document.querySelector('[data-module="dashboard"], [data-view="Centro operativo"]');
    if (dashboardItem) {
      dashboardItem.insertAdjacentElement('afterend', item);
      return;
    }
    (precisionNav || document.querySelector('.sidebar-nav, nav'))?.appendChild(item);
  }

  function init() {
    if (document.getElementById(MODULE_ID)) return;
    const marker = document.createElement('span');
    marker.id = MODULE_ID;
    marker.hidden = true;
    document.body.appendChild(marker);
    addStyles();
    createModal();
    createMenuItem();
  }

  window.PampaCoreIA = { init, open };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());