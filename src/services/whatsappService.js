// ============================================
// Servicio de WhatsApp — UltraMSG API
// ============================================

const ultramsg = require('ultramsg-whatsapp-api');

// Inicializar cliente de UltraMSG
const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
const token = process.env.ULTRAMSG_TOKEN;
const api = new ultramsg(instanceId, token);

/**
 * Envía un mensaje de texto por WhatsApp
 * @param {string} to — Número del destinatario (formato: "5492235446970@c.us")
 * @param {string} body — Texto del mensaje
 */
async function sendText(to, body) {
  try {
    const response = await api.sendChatMessage(to, body);
    
    if (response.error) {
      console.error('❌ Error UltraMSG (texto):', response.error);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Error enviando texto:', error.message);
    throw error;
  }
}

/**
 * Envía una imagen por WhatsApp
 * @param {string} to — Número del destinatario
 * @param {string} imageUrl — URL pública de la imagen
 * @param {string} caption — Texto descriptivo (opcional)
 */
async function sendImage(to, imageUrl, caption = '') {
  try {
    const response = await api.sendImageMessage(to, imageUrl, caption);
    
    if (response.error) {
      console.error('❌ Error UltraMSG (imagen):', response.error);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Error enviando imagen:', error.message);
    throw error;
  }
}

/**
 * Envía un documento (PDF, etc.) por WhatsApp
 * @param {string} to — Número del destinatario
 * @param {string} docUrl — URL pública del documento
 * @param {string} filename — Nombre del archivo
 * @param {string} caption — Texto descriptivo (opcional)
 */
async function sendDocument(to, docUrl, filename = 'documento.pdf', caption = '') {
  try {
    const response = await api.sendDocumentMessage(to, docUrl, filename, caption);
    
    if (response.error) {
      console.error('❌ Error UltraMSG (documento):', response.error);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Error enviando documento:', error.message);
    throw error;
  }
}

/**
 * Envía una ubicación por WhatsApp
 * @param {string} to — Número del destinatario
 */
async function sendLocation(to) {
  try {
    // Coordenadas del Hotel Dos Reyes, Mar del Plata
    const lat = '-38.0023';
    const lng = '-57.5375';
    const address = 'Restaurante Balmoral - Hotel Dos Reyes\nAv. Colón 2129, Mar del Plata';
    
    const response = await api.sendLocationMessage(to, lat, lng, address);
    
    if (response.error) {
      console.error('❌ Error UltraMSG (ubicación):', response.error);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Error enviando ubicación:', error.message);
    throw error;
  }
}

module.exports = { sendText, sendImage, sendDocument, sendLocation };
