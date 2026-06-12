// ============================================
// Servicio de WhatsApp — UltraMSG & WaAPI API (Multi-Inquilino)
// ============================================

const ultramsg = require('ultramsg-whatsapp-api');

// Caché de clientes instanciados para cada negocio
const clients = {};

/**
 * Determina si el negocio está configurado con WaAPI en lugar de UltraMSG
 */
function isWaapiProvider(businessConfig) {
  const { ultramsgToken, ultramsgInstance } = businessConfig;
  if (!ultramsgToken) return false;
  // Si el token es de 48 caracteres o si el instance es puramente numérico (como 96194)
  const isNumericInstance = /^\d+$/.test(String(ultramsgInstance).trim());
  const isWaapiToken = String(ultramsgToken).trim().length === 48;
  return isNumericInstance || isWaapiToken;
}

/**
 * Envía una solicitud HTTP POST a la API de WaAPI
 */
async function sendWaapiMessage(businessConfig, endpoint, payload) {
  const { ultramsgInstance, ultramsgToken } = businessConfig;
  const url = `https://waapi.app/api/v1/instances/${ultramsgInstance}/client/action/${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ultramsgToken}`
      },
      body: JSON.stringify(payload)
    });
    
    const { log } = require('../utils/logger');
    const data = await response.json();
    if (!response.ok || data.status === 'error' || data.success === false) {
      log('❌ Error en WaAPI', { endpoint, response: data, payload });
      console.error(`❌ Error en WaAPI (${endpoint}) para ${businessConfig.businessId}:`, data);
      throw new Error(data.message || 'Error en WaAPI');
    }
    log('ℹ️ Respuesta WaAPI exitosa', { endpoint, response: data });
    return data;
  } catch (error) {
    console.error(`❌ Error de red/petición en WaAPI (${endpoint}):`, error.message);
    const { log } = require('../utils/logger');
    log('❌ Error de red WaAPI', { endpoint, error: error.message, payload });
    throw error;
  }
}

/**
 * Obtiene o crea la instancia de UltraMSG correspondiente al negocio
 * @param {Object} businessConfig 
 * @returns {Object} Instancia de UltraMSG
 */
function getApiClient(businessConfig) {
  const { businessId, ultramsgInstance, ultramsgToken } = businessConfig;
  
  if (!ultramsgInstance || !ultramsgToken) {
    throw new Error(`UltraMSG/WaAPI no configurado para el negocio: ${businessId || 'desconocido'}`);
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
    if (isWaapiProvider(businessConfig)) {
      return await sendWaapiMessage(businessConfig, 'send-message', {
        chatId: to,
        message: body
      });
    }

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
    if (isWaapiProvider(businessConfig)) {
      return await sendWaapiMessage(businessConfig, 'send-media', {
        chatId: to,
        mediaUrl: imageUrl,
        mediaCaption: caption
      });
    }

    const api = getApiClient(businessConfig);
    // Firma de ultramsg-whatsapp-api: sendImageMessage(to, caption, image, priority, referenceId, nocache)
    const response = await api.sendImageMessage(to, caption, imageUrl);
    
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
    if (isWaapiProvider(businessConfig)) {
      return await sendWaapiMessage(businessConfig, 'send-media', {
        chatId: to,
        mediaUrl: docUrl,
        mediaCaption: caption || filename
      });
    }

    const api = getApiClient(businessConfig);
    // Firma de ultramsg-whatsapp-api: sendDocumentMessage(to, filename, document, priority, referenceId, nocache)
    const response = await api.sendDocumentMessage(to, filename, docUrl);
    
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
    if (isWaapiProvider(businessConfig)) {
      const finalAddress = address || `${businessConfig.name}`;
      return await sendWaapiMessage(businessConfig, 'send-location', {
        chatId: to,
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        title: finalAddress
      });
    }

    const api = getApiClient(businessConfig);
    const finalAddress = address || `${businessConfig.name}`;
    // Firma de ultramsg-whatsapp-api: sendLocationMessage(to, address, lat, lng, priority, referenceId)
    const response = await api.sendLocationMessage(to, finalAddress, lat, lng);
    
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
