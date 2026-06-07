// ============================================
// Handler de mensajes entrantes del webhook
// ============================================

const { generateAIResponse } = require('../services/aiService');
const { sendText, sendImage, sendDocument } = require('../services/whatsappService');
const { getRelevantContext, getMediaForTopic } = require('../utils/knowledgeBase');
const { log } = require('../utils/logger');

// Almacén simple de historial de conversación (en memoria)
// En producción, podrías usar Redis o una base de datos
const conversationHistory = new Map();
const MAX_HISTORY = 10; // Máximo de mensajes por conversación

/**
 * Procesa un mensaje entrante de WhatsApp
 * @param {Object} messageData — Datos del mensaje del webhook de UltraMSG
 */
async function handleIncomingMessage(messageData) {
  const sender = messageData.from;       // Número del remitente (ej: "5492235446970@c.us")
  const messageBody = (messageData.body || '').trim();
  const messageType = messageData.type;  // text, image, document, etc.

  // Si el mensaje está vacío (ej: sticker, audio sin texto), responder genéricamente
  if (!messageBody) {
    await sendText(sender, 
      '¡Buenas! 🍽️ Soy el asistente virtual del Restaurante Balmoral.\n\n' +
      'Por favor, escribime tu consulta en texto y con gusto te ayudo.\n\n' +
      'Podés preguntarme sobre:\n' +
      '📋 Nuestra carta y menú\n' +
      '🕐 Horarios de atención\n' +
      '📍 Ubicación y cómo llegar\n' +
      '📞 Reservas\n' +
      '🎵 Eventos y música en vivo'
    );
    return;
  }

  try {
    // Obtener historial de la conversación
    const history = getConversationHistory(sender);

    // Obtener contexto relevante de la base de conocimiento
    const context = getRelevantContext(messageBody);

    // Verificar si el usuario pide fotos, carta, menú, documento
    const mediaRequest = getMediaForTopic(messageBody);

    // Generar respuesta con IA
    const aiResponse = await generateAIResponse(messageBody, context, history);

    // Guardar en historial
    addToHistory(sender, 'user', messageBody);
    addToHistory(sender, 'assistant', aiResponse);

    // Enviar respuesta de texto
    await sendText(sender, aiResponse);

    // Si se detectó que debe enviar media (foto, documento), enviarlo después del texto
    if (mediaRequest) {
      await handleMediaResponse(sender, mediaRequest);
    }

    log('✅ Respuesta enviada', { to: sender, response: aiResponse.substring(0, 100) });

  } catch (error) {
    console.error('❌ Error procesando mensaje:', error.message);
    log('❌ Error procesando mensaje', { error: error.message, sender });

    // Enviar mensaje de fallback amable
    await sendText(sender,
      'Disculpe, tuve un inconveniente al procesar su consulta. 🙏\n\n' +
      'Le sugiero contactarnos directamente:\n' +
      '📞 (0223) 491-0383\n' +
      '📞 (0223) 491-2916\n\n' +
      'Nuestro equipo estará encantado de asistirle.'
    );
  }
}

/**
 * Maneja el envío de contenido multimedia (fotos, documentos)
 */
async function handleMediaResponse(sender, media) {
  try {
    if (media.type === 'image') {
      await sendImage(sender, media.url, media.caption || '');
    } else if (media.type === 'document') {
      await sendDocument(sender, media.url, media.filename || 'documento.pdf', media.caption || '');
    }
  } catch (error) {
    console.error('❌ Error enviando media:', error.message);
  }
}

/**
 * Obtiene el historial de conversación de un remitente
 */
function getConversationHistory(sender) {
  return conversationHistory.get(sender) || [];
}

/**
 * Agrega un mensaje al historial de conversación
 */
function addToHistory(sender, role, content) {
  if (!conversationHistory.has(sender)) {
    conversationHistory.set(sender, []);
  }

  const history = conversationHistory.get(sender);
  history.push({ role, content, timestamp: Date.now() });

  // Mantener solo los últimos N mensajes
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

  for (const [sender, history] of conversationHistory.entries()) {
    if (history.length > 0) {
      const lastMessage = history[history.length - 1];
      if (now - lastMessage.timestamp > TWO_HOURS) {
        conversationHistory.delete(sender);
      }
    }
  }
}

module.exports = { handleIncomingMessage };
