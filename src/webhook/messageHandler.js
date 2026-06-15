// ============================================
// Handler de mensajes entrantes del webhook (Multi-Inquilino)
// ============================================

const { generateAIResponse } = require('../services/aiService');
const { sendText, sendImage, sendDocument } = require('../services/whatsappService');
const { getRelevantContext, getMediaForTopic, getBusinessConfig, getCustomPrompt } = require('../utils/knowledgeBase');
const { log } = require('../utils/logger');

// Almacén de sesiones en memoria para aislar historiales y guardar estado (ej. promociones enviadas)
// Indexado por la combinación "businessId:sender"
const sessions = new Map();
const MAX_HISTORY = 10; // Máximo de mensajes por conversación

/**
 * Obtiene o crea la sesión de un usuario de forma segura
 */
function getOrCreateSession(historyKey) {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  if (sessions.has(historyKey)) {
    const session = sessions.get(historyKey);
    if (now - session.lastActive > TWO_HOURS) {
      sessions.delete(historyKey);
    }
  }

  if (!sessions.has(historyKey)) {
    sessions.set(historyKey, {
      messages: [],
      promoSent: false,
      lastActive: now
    });
  }
  const session = sessions.get(historyKey);
  session.lastActive = now;
  return session;
}

/**
 * Determina si la conversación está cerrando o finalizando
 */
function isConversationEnding(userMessage, aiResponse) {
  const cleanUserMsg = userMessage.toLowerCase().trim();
  const cleanResponse = aiResponse.toLowerCase();

  // Palabras clave de agradecimiento o despedida del cliente
  const userClosingKeywords = [
    'gracias', 'muchas gracias', 'chau', 'adios', 'adiós', 
    'buenisimo', 'buenísimo', 'perfecto', 'entendido', 'ok', 
    'listo', 'excelente', 'espectacular', 'joya', 'dale'
  ];

  // Si el mensaje del usuario es muy corto y contiene palabras de cierre
  const isUserClosing = cleanUserMsg.length < 20 && userClosingKeywords.some(kw => cleanUserMsg.includes(kw));

  // Palabras clave de despedida o cierre por parte de la IA
  const aiClosingKeywords = [
    'quedo a disposición', 'quedo a su disposición', 'lo esperamos', 
    'cualquier otra consulta', 'reserva para probarlo', 'realizar una reserva'
  ];
  const isAiClosing = aiClosingKeywords.some(kw => cleanResponse.includes(kw));

  return isUserClosing || isAiClosing;
}

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
    // Obtener la sesión e historial aislado
    const session = getOrCreateSession(historyKey);
    const history = session.messages;

    // Obtener contexto relevante de la base de conocimiento de este negocio
    const context = getRelevantContext(messageBody, businessId);

    // Obtener información del remitente (limpiar sufijos @c.us y @lid)
    let senderNumber = sender.replace(/@c\.us$/, '').replace(/@lid$/, '').replace(/[^0-9]/g, '') || sender;
    const pushName = messageData.pushname || messageData.pushName || 'Cliente';

    // Si el remitente es un LID (@lid), intentamos resolver su número real de WhatsApp
    if (sender.includes('@lid')) {
      const { getContactInfo } = require('../services/whatsappService');
      try {
        console.log(`🔍 [${businessId}] Intentando resolver número real para LID: ${sender}`);
        const contactInfo = await getContactInfo(businessConfig, sender);
        if (contactInfo) {
          const resolvedNumber = contactInfo.number || 
                                 (contactInfo.id && typeof contactInfo.id === 'object' ? contactInfo.id.user : null) ||
                                 (contactInfo.id && typeof contactInfo.id === 'string' ? contactInfo.id.replace('@c.us', '') : null) ||
                                 contactInfo.phone;
                                 
          if (resolvedNumber) {
            console.log(`✅ [${businessId}] LID ${sender} resuelto a número real: ${resolvedNumber}`);
            senderNumber = resolvedNumber.replace(/[^0-9]/g, '');
          } else {
            console.log(`⚠️ [${businessId}] No se encontró el número real en la respuesta de contacto para LID: ${sender}`, JSON.stringify(contactInfo));
          }
        } else {
          console.log(`⚠️ [${businessId}] No se pudo obtener la información del contacto para LID: ${sender}`);
        }
      } catch (err) {
        console.error(`❌ [${businessId}] Error al resolver LID:`, err.message);
      }
    }

    const senderInfo = { numero: senderNumber, nombre: pushName, jid: sender };

    // Generar respuesta con IA
    let aiResponse = await generateAIResponse(messageBody, context, history, senderInfo, businessId);

    // Adjuntar la sugerencia / Happy Hour (customPrompt de eventos) solo una vez y al final de la conversación
    const customPrompt = getCustomPrompt(businessId);

    if (customPrompt && !session.promoSent && isConversationEnding(messageBody, aiResponse)) {
      aiResponse = `${aiResponse}\n\n${customPrompt}`;
      session.promoSent = true;
    }

    // Guardar en historial ANTES de buscar fotos, para que la búsqueda contextual
    // pueda encontrar platos mencionados en la respuesta actual de la IA
    addToHistory(historyKey, 'user', messageBody);
    addToHistory(historyKey, 'assistant', aiResponse);

    // Verificar si solicita algún recurso multimedia (foto general o de plato), pasando el historial actualizado
    const mediaRequest = getMediaForTopic(messageBody, businessId, session.messages);

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
  return getOrCreateSession(historyKey).messages;
}

/**
 * Agrega un mensaje al historial de conversación
 */
function addToHistory(historyKey, role, content) {
  const session = getOrCreateSession(historyKey);
  session.messages.push({ role, content, timestamp: Date.now() });

  // Mantener solo los últimos N mensajes (usuario + bot)
  if (session.messages.length > MAX_HISTORY * 2) {
    session.messages.splice(0, session.messages.length - MAX_HISTORY * 2);
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

  for (const [key, session] of sessions.entries()) {
    if (now - session.lastActive > TWO_HOURS) {
      sessions.delete(key);
    }
  }
}

module.exports = { handleIncomingMessage };
