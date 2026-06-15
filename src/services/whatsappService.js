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
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ultramsgToken}`
      },
      body: JSON.stringify(payload)
    });
    
    const { log } = require('../utils/logger');
    let data = await response.json();
    
    // Autodetectar restricción de trial de WaAPI y auto-corregir reintentando con el número de prueba
    if (data.status === 'error' && data.message && data.message.includes('trial phone number')) {
      const match = data.message.match(/actions to ([^!]+)!/);
      let authorizedNumber = match ? match[1].trim() : '5492233041076';
      
      // Asegurar que el número tenga el sufijo @c.us
      if (!authorizedNumber.includes('@')) {
        authorizedNumber = `${authorizedNumber}@c.us`;
      }
      
      log('⚠️ WaAPI Trial detectado. Reintentando con el número autorizado.', { originalChatId: payload.chatId, authorizedNumber });
      console.log(`⚠️ WaAPI Trial detectado. Reintentando con el número autorizado: ${authorizedNumber}`);
      
      payload.chatId = authorizedNumber;
      
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ultramsgToken}`
        },
        body: JSON.stringify(payload)
      });
      data = await response.json();
    }

    // Si el chatId es un LID (@lid) y sigue fallando, intentar convertirlo a @c.us
    if ((data.status === 'error' || data.success === false) && payload.chatId && payload.chatId.includes('@lid')) {
      // Extraer solo los dígitos del LID y probar en formato @c.us
      const lidDigits = String(payload.chatId).replace('@lid', '').replace(/[^0-9]/g, '');
      if (lidDigits.length > 5) {
        const fallbackChatId = `${lidDigits}@c.us`;
        console.log(`⚠️ ChatId era LID, reintentando con formato @c.us: ${fallbackChatId}`);
        log('⚠️ LID fallback a @c.us', { original: payload.chatId, fallback: fallbackChatId });
        payload.chatId = fallbackChatId;
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ultramsgToken}`
          },
          body: JSON.stringify(payload)
        });
        data = await response.json();
      }
    }

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
      // Asegurar que el nombre del archivo tenga extensión .pdf para que WhatsApp lo muestre correctamente
      const pdfFilename = filename.endsWith('.pdf') ? filename : filename.replace(/\.[^.]+$/, '') + '.pdf' || 'Carta.pdf';
      return await sendWaapiMessage(businessConfig, 'send-media', {
        chatId: to,
        mediaUrl: docUrl,
        mediaCaption: caption || '',
        mediaName: pdfFilename  // campo clave: le dice a WaAPI cómo nombrar el archivo en WhatsApp
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

/**
 * Obtiene la información de un contacto (JID, número real, etc.)
 * @param {Object} businessConfig 
 * @param {string} contactId 
 */
async function getContactInfo(businessConfig, contactId) {
  try {
    if (isWaapiProvider(businessConfig)) {
      const res = await sendWaapiMessage(businessConfig, 'get-contact-by-id', {
        contactId
      });
      return res && res.data ? res.data : null;
    } else {
      // Fallback para UltraMSG
      const { ultramsgInstance, ultramsgToken } = businessConfig;
      const url = `https://api.ultramsg.com/${ultramsgInstance}/contacts/contact?token=${ultramsgToken}&chatId=${contactId}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        return data.contact || data;
      }
      return null;
    }
  } catch (error) {
    console.error(`❌ Error obteniendo info de contacto [${businessConfig.businessId}]:`, error.message);
    return null;
  }
}

module.exports = { sendText, sendImage, sendDocument, sendLocation, getContactInfo };
