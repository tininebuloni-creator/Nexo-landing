(function attachSyncEnvelope(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PampaSyncEnvelope = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  const FORMAT = 'pampa-sync-envelope';
  const SCHEMA_VERSION = 1;

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function copyDefined(target, source, names) {
    names.forEach((name) => {
      if (source[name] !== undefined) target[name] = source[name];
    });
    return target;
  }

  function parsePayload(value) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        throw new TypeError('El respaldo no contiene JSON válido.');
      }
    }
    return value;
  }

  function assertObject(value, message) {
    if (!isPlainObject(value)) throw new TypeError(message);
  }

  function buildEnvelope(input) {
    assertObject(input, 'La entrada del envelope debe ser un objeto.');
    if (typeof input.app !== 'string' || !input.app.trim()) {
      throw new TypeError('El envelope requiere un identificador de app.');
    }

    const payload = {};
    copyDefined(payload, input, ['data', 'stores', 'settings', 'syncLog', 'legacy']);
    if (input.payload !== undefined) {
      assertObject(input.payload, 'payload debe ser un objeto.');
      Object.assign(payload, input.payload);
    }

    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      meta: copyDefined({
        app: input.app,
        exportedAt: input.exportedAt || input.exportadoEn || new Date().toISOString()
      }, {
        appVersion: input.appVersion || input.version,
        company: input.company !== undefined ? input.company : input.empresa,
        deviceId: input.deviceId,
        user: input.user,
        sourceFormat: input.sourceFormat
      }, ['appVersion', 'company', 'deviceId', 'user', 'sourceFormat']),
      payload
    };
  }

  function isEnvelope(value) {
    return isPlainObject(value)
      && value.format === FORMAT
      && Number.isInteger(value.schemaVersion)
      && isPlainObject(value.meta)
      && isPlainObject(value.payload);
  }

  function normalizeEnvelope(value, options) {
    const parsed = parsePayload(value);
    assertObject(parsed, 'El respaldo debe ser un objeto JSON.');
    if (isEnvelope(parsed)) return parsed;
    const configuredStores = options && Array.isArray(options.storeNames)
      ? new Set(options.storeNames)
      : null;

    if (isPlainObject(parsed.data)) {
      return buildEnvelope({
        app: typeof parsed.app === 'string' ? parsed.app : 'legacy-state',
        version: parsed.version,
        exportadoEn: parsed.exportadoEn || parsed.exportedAt,
        empresa: parsed.empresa,
        sourceFormat: 'legacy-state-v1',
        data: parsed.data,
        legacy: parsed
      });
    }

    if (isPlainObject(parsed.state)) {
      return buildEnvelope({
        app: typeof parsed.app === 'string' ? parsed.app : 'legacy-state',
        version: parsed.version,
        exportadoEn: parsed.exportadoEn || parsed.exportedAt,
        empresa: parsed.empresa || parsed.state.empresa,
        sourceFormat: 'legacy-state-v1',
        data: parsed.state,
        legacy: parsed
      });
    }

    const stores = {};
    const settings = {};
    Object.keys(parsed).forEach((key) => {
      if (Array.isArray(parsed[key]) && (!configuredStores || configuredStores.has(key))) stores[key] = parsed[key];
      else settings[key] = parsed[key];
    });
    return buildEnvelope({
      app: typeof parsed.app === 'string' ? parsed.app : 'legacy-stores',
      version: parsed.version,
      exportadoEn: parsed.exportadoEn || parsed.exportedAt,
      empresa: parsed.empresa || parsed.company,
      sourceFormat: 'legacy-stores-v1',
      stores,
      settings,
      legacy: parsed
    });
  }

  function normalizeImport(value, options) {
    const envelope = normalizeEnvelope(value, options);
    return {
      envelope,
      meta: envelope.meta,
      data: envelope.payload.data,
      stores: envelope.payload.stores || {},
      settings: envelope.payload.settings || {},
      syncLog: envelope.payload.syncLog,
      legacy: envelope.payload.legacy || null
    };
  }

  return { FORMAT, SCHEMA_VERSION, buildEnvelope, isEnvelope, normalizeEnvelope, normalizeImport };
}));