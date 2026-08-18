require('dotenv').config();

const path = require('path');
const IS_PROD = process.env.NODE_ENV === 'production';

module.exports = {
    IS_PROD,
    WSAA_URL: process.env.AFIP_WSAA_WSDL || (IS_PROD
        ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL'
        : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL'),
    SIGSA_WSDL: process.env.SENASA_SIGSA_WSDL || '',
    SERVICE_NAME: process.env.AFIP_SERVICE_NAME || 'wsigsa',
    CERT_FILE: path.resolve(process.env.AFIP_CERT_FILE || path.join(__dirname, 'certs', IS_PROD ? 'productor.crt' : 'homologacion.crt')),
    KEY_FILE: path.resolve(process.env.AFIP_KEY_FILE || path.join(__dirname, 'certs', IS_PROD ? 'productor.key' : 'homologacion.key')),
    CUIT_PRODUCTOR: process.env.CUIT_PRODUCTOR || ''
};


 

