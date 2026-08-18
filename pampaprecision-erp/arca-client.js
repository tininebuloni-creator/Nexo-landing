const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const ARCA_ENDPOINTS = {
  testing: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms'
  },
  production: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
  }
};

function requestXml(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers }
    }, response => {
      let result = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { result += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`ARCA HTTP ${response.statusCode}: ${result.slice(0, 500)}`));
        resolve(result);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${tag}[^>]*>([\\s\\S]*?)</(?:(?:[\\w.-]+):)?${tag}>`, 'i'));
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null;
}

class ArcaClient {
  constructor(config = process.env) {
    this.environment = config.ARCA_ENVIRONMENT || 'testing';
    this.cuit = config.ARCA_CUIT;
    this.certificatePath = config.ARCA_CERTIFICATE_PATH;
    this.privateKeyPath = config.ARCA_PRIVATE_KEY_PATH;
    this.opensslCommand = config.ARCA_OPENSSL_COMMAND || 'openssl';
    this.lpgUrl = config.ARCA_LPG_URL;
    this.lpgSoapAction = config.ARCA_LPG_SOAP_ACTION || '';
    this.lpgOperation = config.ARCA_LPG_OPERATION || 'autorizarLPG';
    this.sisaUrl = config.ARCA_SISA_URL;
    this.sisaSoapAction = config.ARCA_SISA_SOAP_ACTION || '';
    this.sisaOperation = config.ARCA_SISA_OPERATION || 'consultarSISA';
    this.cpeUrl = config.ARCA_CPE_URL;
    this.cpeSoapAction = config.ARCA_CPE_SOAP_ACTION || '';
    this.cpeOperation = config.ARCA_CPE_OPERATION || 'solicitarCPE';
    this.token = null;
  }

  isConfigured() {
    return Boolean(this.cuit && this.certificatePath && this.privateKeyPath);
  }

  async getToken(service = process.env.ARCA_WSN || 'lpg') {
    if (!this.isConfigured()) throw new Error('ARCA no configurada: faltan ARCA_CUIT, ARCA_CERTIFICATE_PATH o ARCA_PRIVATE_KEY_PATH');
    if (this.token && this.token.expiration > Date.now() + 60000 && this.token.service === service) return this.token;
    const now = new Date();
    const expiration = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const tra = `<loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId><generationTime>${new Date(now.getTime() - 5 * 60 * 1000).toISOString()}</generationTime><expirationTime>${expiration.toISOString()}</expirationTime></header><service>${xmlEscape(service)}</service></loginTicketRequest>`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pampa-arca-'));
    const traPath = path.join(tempDir, 'tra.xml');
    const cmsPath = path.join(tempDir, 'tra.cms');
    try {
      fs.writeFileSync(traPath, tra, { mode: 0o600 });
      execFileSync(this.opensslCommand, ['cms', '-sign', '-in', traPath, '-signer', this.certificatePath, '-inkey', this.privateKeyPath, '-nodetach', '-outform', 'DER', '-out', cmsPath], { stdio: 'pipe' });
      const cms = fs.readFileSync(cmsPath).toString('base64');
      const endpoint = ARCA_ENDPOINTS[this.environment]?.wsaa;
      if (!endpoint) throw new Error(`Entorno ARCA inválido: ${this.environment}`);
      const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.afip.gov.ar"><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
      const response = await requestXml(endpoint, soap, { SOAPAction: 'loginCms' });
      const loginTicket = tagValue(response, 'loginCmsReturn');
      const token = tagValue(loginTicket || response, 'token');
      const sign = tagValue(loginTicket || response, 'sign');
      const expirationText = tagValue(loginTicket || response, 'expirationTime');
      if (!token || !sign) throw new Error(`ARCA WSAA no devolvió token: ${response.slice(0, 500)}`);
      this.token = { token, sign, service, expiration: expirationText ? Date.parse(expirationText) : expiration.getTime() };
      return this.token;
    } finally {
      for (const file of [traPath, cmsPath]) { try { fs.unlinkSync(file); } catch {} }
      try { fs.rmdirSync(tempDir); } catch {}
    }
  }

  async authorizeLpg(lpg) {
    if (!this.lpgUrl) throw new Error('ARCA LPG no configurada: falta ARCA_LPG_URL');
    const credentials = await this.getToken();
    const request = `<${this.lpgOperation}><auth><token>${xmlEscape(credentials.token)}</token><sign>${xmlEscape(credentials.sign)}</sign><cuit>${xmlEscape(this.cuit)}</cuit></auth><lpg><lpgNumber>${xmlEscape(lpg.lpg_number)}</lpgNumber><operationDate>${xmlEscape(lpg.operation_date)}</operationDate><issuerTaxId>${xmlEscape(lpg.issuer_tax_id)}</issuerTaxId><producerTaxId>${xmlEscape(lpg.producer_tax_id)}</producerTaxId><producerName>${xmlEscape(lpg.producer_name)}</producerName><grossAmount>${xmlEscape(lpg.gross_amount)}</grossAmount><vatAmount>${xmlEscape(lpg.vat_amount)}</vatAmount><netAmount>${xmlEscape(lpg.net_amount)}</netAmount></lpg></${this.lpgOperation}>`;
    const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${request}</soapenv:Body></soapenv:Envelope>`;
    const response = await requestXml(this.lpgUrl, soap, { SOAPAction: this.lpgSoapAction });
    return { response, coe: tagValue(response, 'coe') || tagValue(response, 'COE'), authorizationCode: tagValue(response, 'authorizationCode') };
  }

  async callBusinessService({ url, soapAction, operation, service, payload }) {
    if (!url) throw new Error(`Servicio ARCA no configurado para ${service}`);
    const credentials = await this.getToken(service);
    const fields = Object.entries(payload || {}).map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`).join('');
    const request = `<${operation}><auth><token>${xmlEscape(credentials.token)}</token><sign>${xmlEscape(credentials.sign)}</sign><cuit>${xmlEscape(this.cuit)}</cuit></auth>${fields}</${operation}>`;
    const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${request}</soapenv:Body></soapenv:Envelope>`;
    const response = await requestXml(url, soap, { SOAPAction: soapAction });
    return { response, cpeNumber: tagValue(response, 'cpeNumber') || tagValue(response, 'numeroCPE'), authorizationCode: tagValue(response, 'authorizationCode') || tagValue(response, 'codigoAutorizacion'), sisaStatus: tagValue(response, 'sisaStatus') || tagValue(response, 'estadoSISA') };
  }

  async checkSisa(subjectTaxId) {
    return this.callBusinessService({ url: this.sisaUrl, soapAction: this.sisaSoapAction, operation: this.sisaOperation, service: process.env.ARCA_SISA_WSN || 'sisa', payload: { subjectTaxId } });
  }

  async requestCpe(cpe) {
    return this.callBusinessService({ url: this.cpeUrl, soapAction: this.cpeSoapAction, operation: this.cpeOperation, service: process.env.ARCA_CPE_WSN || 'cpe', payload: cpe });
  }
}

module.exports = { ArcaClient };
