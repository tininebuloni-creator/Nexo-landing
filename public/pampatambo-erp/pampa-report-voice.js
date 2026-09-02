(function (global) {
  'use strict';

  const SELECTOR = '#waReporteMensaje, #reportMessage, textarea[data-pampa-report-message]';
  const recognitionByField = new WeakMap();

  function getRecognitionConstructor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }

  function setStatus(field, text, isError) {
    const status = field.parentElement?.querySelector('[data-pampa-report-voice-status]');
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#dc2626' : '';
  }

  function appendTranscript(field, transcript) {
    const prefix = field.value.trim() ? `${field.value.trim()}\n` : '';
    field.value = `${prefix}${transcript}`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function toggleDictation(field, button) {
    const activeRecognition = recognitionByField.get(field);
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }

    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setStatus(field, 'El navegador no admite dictado. Escribí el reporte o usá un navegador compatible.', true);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'es-AR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => {
      recognitionByField.set(field, recognition);
      button.textContent = 'Detener dictado';
      button.setAttribute('aria-pressed', 'true');
      setStatus(field, 'Escuchando. Dictá el texto que querés sumar al reporte.');
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript?.trim())
        .filter(Boolean)
        .join(' ');
      if (transcript) appendTranscript(field, transcript);
    };
    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed'
        ? 'Se requiere permiso de micrófono para dictar el reporte.'
        : `No se pudo dictar el reporte: ${event.error || 'error de reconocimiento'}.`;
      setStatus(field, message, true);
    };
    recognition.onend = () => {
      recognitionByField.delete(field);
      button.textContent = 'Dictar reporte';
      button.setAttribute('aria-pressed', 'false');
      if (!field.parentElement?.querySelector('[data-pampa-report-voice-status]')?.textContent.includes('No se pudo')) {
        setStatus(field, 'Dictado detenido. El texto quedó listo para WhatsApp.');
      }
    };
    recognition.start();
  }

  function mountField(field) {
    if (field.dataset.pampaReportVoiceMounted === 'true') return;
    field.dataset.pampaReportVoiceMounted = 'true';
    const controls = document.createElement('div');
    controls.dataset.pampaReportVoiceControls = 'true';
    controls.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;';
    controls.innerHTML = '<button type="button" class="topbar-btn" data-pampa-report-voice-button="true" aria-pressed="false">Dictar reporte</button><span data-pampa-report-voice-status="true" style="font-size:11px;color:var(--text-dim,#64748b);">El texto dictado se enviará por WhatsApp junto al reporte.</span>';
    field.insertAdjacentElement('afterend', controls);
    const button = controls.querySelector('[data-pampa-report-voice-button]');
    button?.addEventListener('click', () => toggleDictation(field, button));
  }

  function mount(root) {
    (root || document).querySelectorAll?.(SELECTOR).forEach(mountField);
  }

  function start() {
    mount(document);
    new MutationObserver(() => mount(document)).observe(document.documentElement, { childList: true, subtree: true });
  }

  global.PampaReportVoice = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);