const crypto = require('crypto');
const SECRET = process.env.JWT_SECRET || 'balmoral-secret-key-2026';

/**
 * Genera un token firmado para la sesión de un negocio
 * @param {string} businessId 
 * @returns {string} Token en Base64
 */
function generateToken(businessId) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 horas de validez
  const payload = `${businessId}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

/**
 * Verifica un token y retorna el businessId si es válido
 * @param {string} token 
 * @returns {Object|null} { businessId } o null si es inválido/expirado
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    
    const businessId = parts[0];
    const expiresAt = parseInt(parts[1]);
    const hmac = parts[2];
    
    if (isNaN(expiresAt) || expiresAt < Date.now()) {
      return null; // Token expirado o inválido
    }
    
    const payload = `${businessId}:${expiresAt}`;
    const expectedHmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    
    if (hmac === expectedHmac) {
      return { businessId };
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { generateToken, verifyToken };
