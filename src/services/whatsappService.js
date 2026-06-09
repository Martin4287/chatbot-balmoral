// ============================================
// Servicio de WhatsApp — UltraMSG API (Multi-Inquilino)
// ============================================

const ultramsg = require('ultramsg-whatsapp-api');

// Caché de clientes instanciados para cada negocio
const clients = {};

/**
 * Obtiene o crea la instancia de UltraMSG correspondiente al negocio
 * @param {Object} businessConfig 
 * @returns {Object} Instancia de UltraMSG
 */
function getApiClient(businessConfig) {
  const { businessId, ultramsgInstance, ultramsgToken } = businessConfig;
  
  if (!ultramsgInstance || !ultramsgToken) {
    throw new Error(`UltraMSG no configurado para el negocio: ${businessId || 'desconocido'}`);
  }

  const cacheKey = `${businessId}:${ultramsgInstance}`;
  if (!clients[cacheKey]) {
    clients[cacheKey] = new ultramsg(ultramsgInstance, ultramsgToken);
    console.log(`🔌 Cliente UltraMSG instanciado y conectado para el negocio: ${businessId}`);
  }
  return clients[cacheKey];
}

/**
 * Envía un mensaje de texto por WhatsApp
 * @param {Object} businessConfig — Configuración del negocio remitente
 * @param {string} to — Número del destinatario (formato: "5492235446970@c.us")
 * @param {string} body — Texto del mensaje
 */
async function sendText(businessConfig, to, body) {
  try {
    const api = getApiClient(businessConfig);
    const response = await api.sendChatMessage(to, body);
    
    if (response.error) {
      console.error(`❌ Error UltraMSG texto [${businessConfig.businessId}]:`, response.error);
    }
    
    return response;
  } catch (error) {
    console.error(`❌ Error enviando texto [${businessConfig.businessId || 'desconocido'}]:`, error.message);
    throw error;
  }
}

/**
 * Envía una imagen por WhatsApp
 * @param {Object} businessConfig — Configuración del negocio
 * @param {string} to — Número del destinatario
 * @param {string} imageUrl — URL pública de la imagen
 * @param {string} caption — Texto descriptivo (opcional)
 */
async function sendImage(businessConfig, to, imageUrl, caption = '') {
  try {
    const api = getApiClient(businessConfig);
    const response = await api.sendImageMessage(to, imageUrl, caption);
    
    if (response.error) {
      console.error(`❌ Error UltraMSG imagen [${businessConfig.businessId}]:`, response.error);
    }
    
    return response;
  } catch (error) {
    console.error(`❌ Error enviando imagen [${businessConfig.businessId || 'desconocido'}]:`, error.message);
    throw error;
  }
}

/**
 * Envía un documento (PDF, etc.) por WhatsApp
 * @param {Object} businessConfig — Configuración del negocio
 * @param {string} to — Número del destinatario
 * @param {string} docUrl — URL pública del documento
 * @param {string} filename — Nombre del archivo
 * @param {string} caption — Texto descriptivo (opcional)
 */
async function sendDocument(businessConfig, to, docUrl, filename = 'documento.pdf', caption = '') {
  try {
    const api = getApiClient(businessConfig);
    const response = await api.sendDocumentMessage(to, docUrl, filename, caption);
    
    if (response.error) {
      console.error(`❌ Error UltraMSG documento [${businessConfig.businessId}]:`, response.error);
    }
    
    return response;
  } catch (error) {
    console.error(`❌ Error enviando documento [${businessConfig.businessId || 'desconocido'}]:`, error.message);
    throw error;
  }
}

/**
 * Envía una ubicación por WhatsApp
 * @param {Object} businessConfig — Configuración del negocio
 * @param {string} to — Número del destinatario
 * @param {string} lat — Latitud
 * @param {string} lng — Longitud
 * @param {string} address — Dirección descriptiva
 */
async function sendLocation(businessConfig, to, lat = '-38.0023', lng = '-57.5375', address = '') {
  try {
    const api = getApiClient(businessConfig);
    const finalAddress = address || `${businessConfig.name}`;
    const response = await api.sendLocationMessage(to, lat, lng, finalAddress);
    
    if (response.error) {
      console.error(`❌ Error UltraMSG ubicación [${businessConfig.businessId}]:`, response.error);
    }
    
    return response;
  } catch (error) {
    console.error(`❌ Error enviando ubicación [${businessConfig.businessId || 'desconocido'}]:`, error.message);
    throw error;
  }
}

module.exports = { sendText, sendImage, sendDocument, sendLocation };
