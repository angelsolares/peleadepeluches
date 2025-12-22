/**
 * PELEA DE PELUCHES - Configuration
 * 
 * Este archivo contiene la configuración del servidor.
 * Modifica PRODUCTION_SERVER_URL después de desplegar tu servidor en Railway.
 */

// ========================================
// ⚠️ IMPORTANTE: Cambia esta URL después de desplegar en Railway
// ========================================
const PRODUCTION_SERVER_URL = 'https://peleadepeluches-production.up.railway.app';

// Detección automática del entorno
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname.startsWith('192.168.');

// URL del servidor WebSocket
export const SERVER_URL = isLocalhost 
    ? `http://${window.location.hostname}:3001`
    : PRODUCTION_SERVER_URL;

// Exportar configuración adicional
export const CONFIG = {
    SERVER_URL,
    isLocalhost,
    DEBUG: isLocalhost
};

console.log(`[Config] Environment: ${isLocalhost ? 'Development' : 'Production'}`);
console.log(`[Config] Server URL: ${SERVER_URL}`);

