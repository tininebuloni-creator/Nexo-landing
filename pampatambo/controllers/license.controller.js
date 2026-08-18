const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRIAL_DAYS = 10;
const TRIAL_TOKEN_FILE = path.join(__dirname, '..', 'data', 'trial-link-tokens.json');

function normalizeLicenseText(value) {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getLicensePrefixByVersion(version) {
  const v = normalizeLicenseText(version);
  if (v.includes('basica') || v.includes('basic')) return 'B';
  if (v.includes('profesional') || v.includes('professional') || v.includes('pro')) return 'P';
  if (v.includes('premium')) return 'M';
  return '';
}

function versionFromCode(code) {
  if (code === 'B') return 'Basica';
  if (code === 'P') return 'Profesional';
  if (code === 'M') return 'Premium';
  return 'Desconocida';
}

function hashLegacy(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function encodeBase64Url(text) {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(base64Url) {
  const base64 = `${base64Url || ''}`.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + pad, 'base64').toString('utf8');
}

function getSecret() {
  return process.env.TAMBO_LICENSE_SECRET || process.env.LICENSE_SECRET || 'NEXO_TAMBO_2026';
}

function toIsoDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = `${dateObj.getMonth() + 1}`.padStart(2, '0');
  const d = `${dateObj.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTrialTokenStore() {
  try {
    if (!fs.existsSync(TRIAL_TOKEN_FILE)) {
      return { used: {} };
    }
    const raw = fs.readFileSync(TRIAL_TOKEN_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return { used: {} };
    if (!parsed.used || typeof parsed.used !== 'object') parsed.used = {};
    return parsed;
  } catch {
    return { used: {} };
  }
}

function saveTrialTokenStore(store) {
  fs.mkdirSync(path.dirname(TRIAL_TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TRIAL_TOKEN_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function signTrialTokenPayload(encodedPayload) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(encodedPayload)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
}

function buildTrialToken(payload) {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const signature = signTrialTokenPayload(encoded);
  return `${encoded}.${signature}`;
}

function parseTrialToken(rawToken) {
  const token = `${rawToken || ''}`.trim();
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Token de trial inválido.');
  }

  const encoded = parts[0];
  const signature = `${parts[1] || ''}`.toUpperCase();
  const expected = signTrialTokenPayload(encoded);
  if (signature !== expected) {
    throw new Error('Firma de token inválida.');
  }

  const payload = JSON.parse(decodeBase64Url(encoded));
  if (!payload || typeof payload !== 'object' || payload.typ !== 'trial_link' || !payload.jti || !payload.exp) {
    throw new Error('Contenido de token inválido.');
  }

  return payload;
}

function buildTrialPayloadFromToken(tokenPayload) {
  const expDate = new Date(Number(tokenPayload.exp) || Date.now());
  return {
    owner: 'Prueba Gratis',
    version: 'Premium',
    versionCode: 'M',
    exp: toIsoDate(expDate),
    trial: true,
    trialDays: TRIAL_DAYS,
    issuedAt: new Date().toISOString(),
    trialTokenId: tokenPayload.jti,
  };
}

function signLicenseParts(versionCode, encodedPayload) {
  const secret = getSecret();
  const base = `${versionCode}.${encodedPayload}`;
  return crypto
    .createHmac('sha256', secret)
    .update(base)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function signLegacyParts(versionCode, encodedPayload) {
  return hashLegacy(`${versionCode}.${encodedPayload}.${getSecret()}`).slice(0, 12);
}

function buildLicenseKey(payload) {
  const versionCode = `${payload?.versionCode || getLicensePrefixByVersion(payload?.version) || ''}`.toUpperCase();
  if (!['B', 'P', 'M'].includes(versionCode)) {
    throw new Error('Version de licencia invalida.');
  }

  const normalizedPayload = {
    ...payload,
    versionCode,
    version: payload?.version || versionFromCode(versionCode),
  };

  const encoded = encodeBase64Url(JSON.stringify(normalizedPayload));
  const signature = signLicenseParts(versionCode, encoded);
  const key = `NXT1.${versionCode}.${encoded}.${signature}`;

  return {
    key,
    payload: normalizedPayload,
  };
}

function parseLicenseKey(rawKey) {
  const raw = `${rawKey || ''}`.trim();
  const legacyMatch = raw.match(/^NEXO-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/i);
  if (legacyMatch) {
    const versionCode = `${legacyMatch[1][0] || ''}`.toUpperCase();
    if (!['B', 'P', 'M'].includes(versionCode)) {
      throw new Error('Codigo de version invalido.');
    }
    return {
      owner: 'Cliente NEXO',
      version: versionFromCode(versionCode),
      versionCode,
      exp: '2099-12-31',
      legacy: true,
    };
  }

  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'NXT1') {
    throw new Error('Formato de licencia invalido.');
  }

  const versionCode = `${parts[1] || ''}`.toUpperCase();
  const encoded = parts[2];
  const signature = `${parts[3] || ''}`.toUpperCase();

  if (!['B', 'P', 'M'].includes(versionCode)) {
    throw new Error('Codigo de version invalido.');
  }

  const expectedStrong = signLicenseParts(versionCode, encoded);
  const expectedLegacy = signLegacyParts(versionCode, encoded);
  if (signature !== expectedStrong && signature !== expectedLegacy) {
    throw new Error('Firma de licencia invalida.');
  }

  const payload = JSON.parse(decodeBase64Url(encoded));
  if (!payload?.exp) {
    throw new Error('Contenido de licencia incompleto.');
  }

  const expectedCode = getLicensePrefixByVersion(payload.version);
  if (expectedCode && expectedCode !== versionCode) {
    throw new Error('Codigo de version no coincide con la licencia.');
  }

  return {
    ...payload,
    versionCode,
    signatureMode: signature === expectedStrong ? 'hmac' : 'legacy',
  };
}

function isLicenseExpired(expIsoDate) {
  const end = new Date(`${expIsoDate}T23:59:59`);
  if (Number.isNaN(end.getTime())) return true;
  return end.getTime() < Date.now();
}

exports.sign = (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Payload de licencia requerido.' });
    }

    if (!payload.exp) {
      return res.status(400).json({ error: 'La licencia debe incluir fecha de vencimiento.' });
    }

    const signed = buildLicenseKey(payload);
    return res.status(200).json(signed);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo firmar la licencia.' });
  }
};

exports.verify = (req, res) => {
  try {
    const key = `${req.body?.key || ''}`.trim();
    if (!key) {
      return res.status(400).json({ error: 'Clave de licencia requerida.' });
    }

    const payload = parseLicenseKey(key);
    const expired = isLicenseExpired(payload.exp);

    if (expired) {
      return res.status(200).json({ valid: false, expired: true, payload, error: 'La licencia esta vencida.' });
    }

    return res.status(200).json({ valid: true, expired: false, payload });
  } catch (error) {
    return res.status(200).json({ valid: false, expired: false, error: error.message || 'Licencia invalida.' });
  }
};

exports.capabilities = (_req, res) => {
  res.status(200).json({
    canSign: true,
    canVerify: true,
    canIssueTrialLink: true,
    trialDays: TRIAL_DAYS,
    version: 'NXT1',
    algorithm: 'HMAC-SHA256 (legacy compatible)',
  });
};

exports.issueTrialLink = (req, res) => {
  try {
    const now = Date.now();
    const expMs = now + (TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const tokenPayload = {
      typ: 'trial_link',
      jti: crypto.randomUUID(),
      iat: now,
      exp: expMs,
    };

    const token = buildTrialToken(tokenPayload);
    const rawBase = `${req.body?.baseUrl || ''}`.trim();
    const fallbackBase = `${req.protocol}://${req.get('host')}`;
    const baseUrl = (rawBase || fallbackBase).replace(/\/$/, '');
    const url = `${baseUrl}/?trial_token=${encodeURIComponent(token)}`;

    return res.status(200).json({
      token,
      url,
      expiresAt: new Date(expMs).toISOString(),
      trialDays: TRIAL_DAYS,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo generar el enlace de trial.' });
  }
};

exports.redeemTrialLink = (req, res) => {
  try {
    const token = `${req.body?.token || ''}`.trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token requerido.' });
    }

    const payload = parseTrialToken(token);
    const now = Date.now();
    if (now > Number(payload.exp)) {
      return res.status(200).json({ ok: false, expired: true, error: 'El enlace de trial venció.' });
    }

    const store = getTrialTokenStore();
    if (store.used[payload.jti]) {
      return res.status(200).json({ ok: false, used: true, error: 'Este enlace de trial ya fue utilizado.' });
    }

    store.used[payload.jti] = new Date().toISOString();
    saveTrialTokenStore(store);

    const trialPayload = buildTrialPayloadFromToken(payload);
    const signed = buildLicenseKey(trialPayload);
    return res.status(200).json({
      ok: true,
      key: signed.key,
      payload: signed.payload,
    });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error.message || 'No se pudo canjear el enlace de trial.' });
  }
};
