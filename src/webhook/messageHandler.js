// ============================================
// Handler de mensajes entrantes del webhook (Multi-Inquilino)
// ============================================

const { generateAIResponse } = require('../services/aiService');
const { sendText, sendImage, sendDocument } = require('../services/whatsappService');
const { getRelevantContext, getMediaForTopic, getBusinessConfig } = require('../utils/knowledgeBase');
const { log } = require('../utils/logger');

// Almacén de historial de conversación (en memoria)
// Indexado por la combinación "businessId:sender" para aislar historiales por negocio
const conversationHistory = new Map();
const MAX_HISTORY = 10; // Máximo de mensajes por conversación

/**
 * Procesa un mensaje entrante de WhatsApp
 * @param {Object} messageData — Datos del mensaje del webhook de UltraMSG
 * @param {string} businessId — ID del negocio
 */
async function handleIncomingMessage(messageData, businessId = 'balmoral') {
  const sender = messageData.from;       // Número del remitente (ej: "5492235446970@c.us")
  const messageBody = (messageData.body || '').trim();
  const messageType = messageData.type;  // text, image, document, etc.
  
  // Cargar configuración de negocio
  const businessConfig = getBusinessConfig(businessId);
  const historyKey = `${businessId}:${sender}`;

  // Manejar específicamente audios
  if (messageType === 'ptt' || messageType === 'audio') {
    await sendText(businessConfig, sender, `¡Hola! ✨ Disculpas, pero por el momento no puedo escuchar mensajes de audio.\n\nPor favor, escribime tu consulta en texto y con gusto te ayudo. 🍽️`);
    return;
  }

  // Si el mensaje está vacío, responder con la guía de ayuda inicial
  if (!messageBody) {
    await sendText(businessConfig, sender, 
      `¡Buenas! ✨ Soy el asistente virtual de *${businessConfig.name}*.\n\n` +
      'Por favor, escribime tu consulta en texto y con gusto te ayudo.\n\n' +
      'Podés preguntarme sobre:\n' +
      '📋 Nuestra carta y menú\n' +
      '🕐 Horarios de atención\n' +
      '📍 Ubicación y cómo llegar\n' +
      '📞 Reservas y turnos'
    );
    return;
  }

  try {
    // Obtener historial aislado de la conversación
    const history = getConversationHistory(historyKey);

    // Obtener contexto relevante de la base de conocimiento de este negocio
    const context = getRelevantContext(messageBody, businessId);

    // Verificar si solicita algún recurso multimedia (foto general o de plato)
    const mediaRequest = getMediaForTopic(messageBody, businessId);

    // Obtener información del remitente
    const senderNumber = sender.replace('@c.us', '');
    const pushName = messageData.pushname || messageData.pushName || 'Cliente';
    const senderInfo = { numero: senderNumber, nombre: pushName };

    // Generar respuesta con IA
    const aiResponse = await generateAIResponse(messageBody, context, history, senderInfo, businessId);

    // Guardar en historial
    addToHistory(historyKey, 'user', messageBody);
    addToHistory(historyKey, 'assistant', aiResponse);

    // Enviar respuesta de texto
    await sendText(businessConfig, sender, aiResponse);

    // Si el usuario pide fotos y existe media coincidente, enviarla como imagen de WhatsApp
    if (mediaRequest) {
      await handleMediaResponse(businessConfig, sender, mediaRequest);
    }

    log('✅ Respuesta enviada', { businessId, to: sender, response: aiResponse.substring(0, 100) });

  } catch (error) {
    console.error(`❌ Error procesando mensaje en negocio ${businessId}:`, error.message);
    log('❌ Error procesando mensaje', { businessId, error: error.message, sender });

    // Enviar mensaje de fallback amable del negocio
    await sendText(businessConfig, sender,
      'Disculpe, tuve un inconveniente al procesar su consulta. 🙏\n\n' +
      'Le sugiero contactarnos directamente:\n' +
      `📞 ${businessConfig.salesPhone || 'nuestros teléfonos'}\n\n` +
      'Nuestro equipo estará encantado de asistirle.'
    );
  }
}

/**
 * Maneja el envío de contenido multimedia (fotos, documentos)
 */
async function handleMediaResponse(businessConfig, sender, media) {
  try {
    if (media.type === 'image') {
      await sendImage(businessConfig, sender, media.url, media.caption || '');
    } else if (media.type === 'document') {
      await sendDocument(businessConfig, sender, media.url, media.filename || 'documento.pdf', media.caption || '');
    }
  } catch (error) {
    console.error(`❌ Error enviando media [${businessConfig.businessId}]:`, error.message);
  }
}

/**
 * Obtiene el historial de conversación de una clave
 */
function getConversationHistory(historyKey) {
  return conversationHistory.get(historyKey) || [];
}

/**
 * Agrega un mensaje al historial de conversación
 */
function addToHistory(historyKey, role, content) {
  if (!conversationHistory.has(historyKey)) {
    conversationHistory.set(historyKey, []);
  }

  const history = conversationHistory.get(historyKey);
  history.push({ role, content, timestamp: Date.now() });

  // Mantener solo los últimos N mensajes (usuario + bot)
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY * 2);
  }

  // Limpiar conversaciones viejas (más de 2 horas sin actividad)
  cleanOldConversations();
}

/**
 * Limpia conversaciones inactivas (más de 2 horas)
 */
function cleanOldConversations() {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();

  for (const [key, history] of conversationHistory.entries()) {
    if (history.length > 0) {
      const lastMessage = history[history.length - 1];
      if (now - lastMessage.timestamp > TWO_HOURS) {
        conversationHistory.delete(key);
      }
    }
  }
}

module.exports = { handleIncomingMessage };
