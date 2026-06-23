// ============================================
// Handler de mensajes entrantes del webhook (Multi-Inquilino)
// ============================================

const { generateAIResponse } = require('../services/aiService');
const { sendText, sendImage, sendDocument } = require('../services/whatsappService');
const { getRelevantContext, getMediaForTopic, getBusinessConfig, getCustomPrompt } = require('../utils/knowledgeBase');
const { log } = require('../utils/logger');

// Almacén de sesiones en memoria de respaldo (si Firebase no está configurado)
const sessions = new Map();
const MAX_HISTORY = 10; // Máximo de mensajes por conversación

const { getDocument, saveDocument, isFirebaseConfigured } = require('../utils/firebase');

/**
 * Obtiene o crea la sesión de un usuario de forma segura (Firestore con fallback local)
 */
async function getOrCreateSession(businessId, sender) {
  const now = Date.now();
  const defaultSession = {
    messages: [],
    promoSent: false,
    lastActive: now,
    lastSender: 'user',
    followUpSent: false,
    closed: false
  };

  try {
    if (!isFirebaseConfigured()) {
      const historyKey = `${businessId}:${sender}`;
      if (!sessions.has(historyKey)) {
        sessions.set(historyKey, {
          messages: [],
          promoSent: false,
          lastActive: now,
          lastSender: 'user',
          followUpSent: false,
          closed: false
        });
      }
      return sessions.get(historyKey);
    }

    const docData = await getDocument(`businesses/${businessId}/sessions`, sender);
    if (!docData) {
      await saveDocument(`businesses/${businessId}/sessions`, sender, defaultSession);
      return defaultSession;
    }
    
    // Normalizar campos en caso de que falten en el documento antiguo
    if (!docData.messages) docData.messages = [];
    if (docData.promoSent === undefined) docData.promoSent = false;
    if (docData.lastActive === undefined) docData.lastActive = now;
    if (docData.lastSender === undefined) docData.lastSender = 'user';
    if (docData.followUpSent === undefined) docData.followUpSent = false;
    if (docData.closed === undefined) docData.closed = false;

    return docData;
  } catch (err) {
    console.error(`❌ Error al obtener/crear sesión para ${sender}:`, err.message);
    return defaultSession;
  }
}

/**
 * Guarda la sesión del usuario (Firestore con fallback local)
 */
async function saveSession(businessId, sender, session) {
  try {
    if (!isFirebaseConfigured()) {
      const historyKey = `${businessId}:${sender}`;
      sessions.set(historyKey, session);
      return;
    }
    await saveDocument(`businesses/${businessId}/sessions`, sender, session);
  } catch (err) {
    console.error(`❌ Error al guardar sesión para ${sender}:`, err.message);
  }
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
    const session = await getOrCreateSession(businessId, sender);
    const history = session.messages;

    // Obtener contexto relevante de la base de conocimiento de este negocio
    const context = getRelevantContext(messageBody, businessId);

    // Obtener información del remitente (limpiar sufijos @c.us y @lid)
    let senderNumber = sender.replace(/@c\.us$/, '').replace(/@lid$/, '').replace(/[^0-9]/g, '') || sender;
    const pushName = messageData.pushname || messageData.pushName || 'Cliente';

    let isLid = sender.includes('@lid') || (senderNumber && senderNumber.length >= 15);

    // Si el remitente es un LID (@lid) o número largo, intentamos resolver su número real de WhatsApp
    if (isLid) {
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
            isLid = false; // Resolved successfully!
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

    const senderInfo = { numero: senderNumber, nombre: pushName, jid: sender, isLid };

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
    session.messages.push({ role: 'user', content: messageBody, timestamp: Date.now() });
    session.messages.push({ role: 'assistant', content: aiResponse, timestamp: Date.now() });

    // Mantener solo los últimos N mensajes (usuario + bot)
    if (session.messages.length > MAX_HISTORY * 2) {
      session.messages.splice(0, session.messages.length - MAX_HISTORY * 2);
    }

    // Verificar si solicita algún recurso multimedia (foto general o de plato), pasando el historial actualizado
    const mediaRequest = getMediaForTopic(messageBody, businessId, session.messages);

    // Enviar respuesta de texto
    await sendText(businessConfig, sender, aiResponse);

    // Si el usuario pide fotos y existe media coincidente, enviarla como imagen de WhatsApp
    if (mediaRequest) {
      await handleMediaResponse(businessConfig, sender, mediaRequest);
    }

    // Actualizar metadatos de reenganche/cierre y persistir sesión en Firestore
    session.lastActive = Date.now();
    session.lastSender = 'assistant';
    session.followUpSent = false;
    session.closed = isConversationEnding(messageBody, aiResponse);

    await saveSession(businessId, sender, session);

    log('✅ Respuesta enviada', { businessId, to: sender, response: aiResponse.substring(0, 100) });

  } catch (error) {
    console.error(`❌ Error procesando mensaje en negocio ${businessId}:`, error.message);
    log('❌ Error procesando mensaje', { businessId, error: error.message, sender });

    // Lógica de reintento silencioso (3 minutos por defecto, 180.000 ms)
    const retryCount = messageData._retryCount || 0;
    const maxRetries = 2;
    const retryDelay = 180000; // 3 minutos (modificar a 10000 para pruebas locales de 10s)

    if (retryCount < maxRetries) {
      messageData._retryCount = retryCount + 1;
      const errorTime = Date.now();
      console.log(`⏳ [${businessId}] Falla detectada para ${sender}. Programando reintento silencioso #${messageData._retryCount} en ${retryDelay / 1000} segundos...`);

      setTimeout(async () => {
        try {
          // Obtener sesión actual
          const session = await getOrCreateSession(businessId, sender);

          // Si el último que envió fue el asistente, o hubo actividad exitosa posterior al error
          if (session.lastSender === 'assistant' || session.lastActive > errorTime) {
            console.log(`🚫 [${businessId}] Reintento #${messageData._retryCount} cancelado para ${sender}. La conversación ya se normalizó.`);
            return;
          }

          console.log(`🔄 [${businessId}] Ejecutando reintento silencioso #${messageData._retryCount} para ${sender}...`);
          await handleIncomingMessage(messageData, businessId);
        } catch (retryErr) {
          console.error(`❌ [${businessId}] Error durante la ejecución del reintento silencioso para ${sender}:`, retryErr.message);
        }
      }, retryDelay);
    } else {
      console.error(`❌ [${businessId}] Se alcanzó el límite máximo de reintentos silenciosos (${maxRetries}) para ${sender}. No se enviará ningún mensaje de error al cliente.`);
    }
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

module.exports = { handleIncomingMessage, getOrCreateSession, saveSession };
