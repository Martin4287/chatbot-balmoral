// ============================================
// Servicio de IA — Google Gemini
// ============================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSystemPrompt } = require('../config/prompts');
const { getPersonalityLevel } = require('../utils/knowledgeBase');

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function createModel(modelName) {
  const level = getPersonalityLevel();
  const systemPrompt = getSystemPrompt(level);
  
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ]
  });
}

/**
 * Genera una respuesta inteligente usando Gemini con rotación de modelos
 * @param {string} userMessage — Mensaje del cliente
 * @param {string} context — Contexto relevante de la base de conocimiento
 * @param {Array} history — Historial de la conversación
 * @param {Object} senderInfo — Información del remitente (numero y nombre)
 * @returns {string} — Respuesta generada
 */
async function generateAIResponse(userMessage, context, history = [], senderInfo = { numero: 'Desconocido', nombre: 'Cliente' }) {
  const MODELS_TO_TRY = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError;

  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`🤖 Intentando responder con modelo: ${modelName}`);

      // Construir el historial de conversación para Gemini
      const chatHistory = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // Iniciar chat con historial dinámico
      const chat = createModel(modelName).startChat({
        history: chatHistory,
      });

      // Construir el prompt con contexto
      const promptWithContext = buildPromptWithContext(userMessage, context);

      // Enviar mensaje y obtener respuesta
      const result = await chat.sendMessage(promptWithContext);
      let response = result.response.text();

      // Procesar comando de derivación automática
      const lowerResponse = response.toLowerCase();
      const lowerQuery = userMessage.toLowerCase();
      
      const containsTag = response.includes('[DERIVAR_CONSULTA]');
      const mentionsDeriveInResponse = lowerResponse.includes('derivar') || lowerResponse.includes('derivación') || lowerResponse.includes('representante') || lowerResponse.includes('nos pondremos en contacto') || lowerResponse.includes('tomado nota');
      const mentionsReservationInQuery = lowerQuery.includes('reservar') || lowerQuery.includes('reserva') || lowerQuery.includes('mesa para') || lowerQuery.includes('mesa para');
      
      const isDeriving = containsTag || (mentionsDeriveInResponse && mentionsReservationInQuery);

      if (isDeriving) {
        const clienteNumero = senderInfo.numero;
        const clienteNombre = senderInfo.nombre;
        const clienteConsulta = userMessage;
        
        // 1. Enviar correo de derivación (Nodemailer)
        try {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASS
            }
          });

          const mailOptions = {
            from: `"Bot Balmoral" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Send to the restaurant owner
            subject: '⚠️ Nueva Consulta de WhatsApp Derivada',
            text: `El bot derivó una consulta del cliente.\n\nNombre del Cliente: ${clienteNombre}\nNúmero de WhatsApp: ${clienteNumero}\nConsulta Realizada:\n"${clienteConsulta}"\n\nRespuesta del Bot:\n"${response.replace(/\[DERIVAR_CONSULTA\]/gi, '').trim()}"`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #ef4444;">⚠️ Nueva Consulta Derivada</h2>
                <p>El bot derivó una consulta para atención humana.</p>
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <p><strong>Nombre del Cliente:</strong> ${clienteNombre}</p>
                  <p><strong>Número de WhatsApp:</strong> <a href="https://wa.me/${clienteNumero}">${clienteNumero}</a></p>
                  <p><strong>Consulta Realizada:</strong></p>
                  <blockquote style="border-left: 4px solid #ef4444; padding-left: 10px; font-style: italic;">"${clienteConsulta}"</blockquote>
                  <p><strong>Respuesta del Bot:</strong></p>
                  <p style="white-space: pre-wrap; font-size: 0.95em;">${response.replace(/\[DERIVAR_CONSULTA\]/gi, '').trim()}</p>
                </div>
                <p>Por favor, contacte al cliente a la brevedad.</p>
              </div>
            `
          };

          await transporter.sendMail(mailOptions);
          console.log(`✉️ Correo de derivación enviado a ${process.env.EMAIL_USER} por el número: ${clienteNumero}`);
        } catch (err) {
           console.error('Error al enviar email via Nodemailer:', err);
        }

        // 2. Enviar WhatsApp de derivación al número de ventas (UltraMSG)
        try {
          const { sendText } = require('./whatsappService');
          let salesPhone = process.env.SALES_WHATSAPP || '5492235446970';
          if (!salesPhone.endsWith('@c.us')) {
            salesPhone = `${salesPhone}@c.us`;
          }

          const notificationText = 
            `⚠️ *NUEVA RESERVA / CONSULTA DERIVADA*\n\n` +
            `👤 *Cliente:* ${clienteNombre}\n` +
            `📱 *WhatsApp:* https://wa.me/${clienteNumero}\n\n` +
            `💬 *Consulta:* "${clienteConsulta}"\n\n` +
            `🤖 *Respuesta del Bot:* "${response.replace(/\[DERIVAR_CONSULTA\]/gi, '').trim()}"\n\n` +
            `👉 _Hacé clic en el enlace de WhatsApp para responderle directamente al cliente._`;

          await sendText(salesPhone, notificationText);
          console.log(`💬 WhatsApp de derivación enviado a ventas (${salesPhone}) por el cliente: ${clienteNumero}`);
        } catch (err) {
          console.error('Error al enviar WhatsApp de derivación a ventas:', err.message);
        }
        
        // Quitar la etiqueta del mensaje final
        response = response.replace(/\[DERIVAR_CONSULTA\]/gi, '').trim();
      }

      // Limpiar la respuesta para WhatsApp (remover markdown excesivo)
      return cleanForWhatsApp(response);

    } catch (error) {
      lastError = error;
      console.error(`❌ Error con modelo ${modelName}:`, error.message);
      
      // Si es error de autenticación, no reintentar
      if (error.message.includes('API key') || error.message.includes('401')) {
        throw new Error('Error de autenticación con Gemini. Verificar API key.');
      }

      console.warn(`⚠️ Modelo ${modelName} falló o no tiene cuota. Probando siguiente modelo...`);
    }
  }

  // FALLBACK: Si todos los modelos fallan, usar la respuesta de fallback local
  console.error('❌ Todos los modelos de Gemini fallaron. Usando respuesta de fallback.');
  return generateFallbackResponse(userMessage);
}

/**
 * Genera una respuesta de fallback usando la base de conocimiento directamente
 * Se usa cuando Gemini no está disponible (rate limit, error, etc.)
 */
function generateFallbackResponse(userMessage) {
  const msg = userMessage.toLowerCase();

  // Saludo
  if (msg.match(/^(hola|buenas|buen dia|buenas noches|buenas tardes|hey|hi)/)) {
    return '¡Buenas! 🍽️ Bienvenido al Restaurante Balmoral del Hotel Dos Reyes.\n\n' +
      'Es un placer atenderle. ¿En qué puedo ayudarle?\n\n' +
      'Puede preguntarme sobre:\n' +
      '📋 Nuestra carta y menú\n' +
      '🕐 Horarios de atención\n' +
      '📍 Ubicación y cómo llegar\n' +
      '📞 Reservas\n' +
      '🎵 Eventos y música en vivo';
  }

  // Si preguntan por horarios
  if (msg.includes('hora') || msg.includes('abren') || msg.includes('cierran') || msg.includes('horario')) {
    return '🕒 *Nuestros horarios de atención son:*\n' +
      'Todos los días:\n' +
      '- Almuerzo: 12:30 a 18:00 hs\n' +
      '- Cena: 20:30 a 00:00 hs\n\n' +
      '¡Lo esperamos! 🍽️';
  }

  // Si preguntan por el menú o la carta
  if (msg.includes('menu') || msg.includes('menú') || msg.includes('carta') || msg.includes('plato') || msg.includes('precio')) {
    return '📋 *Nuestra Carta*\n\n' +
      'Para ver la carta completa con todos los precios, podés ver nuestro PDF aquí: https://drive.google.com/uc?export=download&id=1TmmIuRXzHFhAoG0zbxL4rZxhCY0uNQd8 ✨';
  }

  // Respuesta genérica de error amable
  return '¡Gracias por comunicarse con el Restaurante Balmoral! 🍽️\n\n' +
    'En este momento mi sistema está experimentando una alta demanda y no puedo procesar su consulta correctamente. Por favor intente nuevamente en unos minutos.\n\n' +
    'Si necesita asistencia inmediata, contáctenos directamente:\n' +
    '📞 (0223) 491-0383\n' +
    '📞 (0223) 491-2916\n' +
    '📧 balmoralrestaurante@gmail.com\n\n' +
    '¡Disculpe las molestias! ✨';
}

/**
 * Construye el prompt inyectando el contexto de la base de conocimiento
 */
function buildPromptWithContext(userMessage, context) {
  const options = { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const currentDateTime = new Intl.DateTimeFormat('es-AR', options).format(new Date());

  if (!context || context.trim() === '') {
    return `[CONTEXTO DE SISTEMA: Hoy es ${currentDateTime}]\n\nPregunta del cliente: ${userMessage}`;
  }

  return `[CONTEXTO DE SISTEMA: Hoy es ${currentDateTime}]

[INFORMACIÓN DEL RESTAURANTE RELEVANTE PARA ESTA CONSULTA]
${context}
[FIN DE INFORMACIÓN]

Pregunta del cliente: ${userMessage}

Respondé usando ÚNICAMENTE la información proporcionada arriba. Si la información no es suficiente para responder completamente, indicá amablemente que pueden consultar directamente al restaurante.`;
}

/**
 * Limpia la respuesta para formato de WhatsApp
 * - Convierte **bold** a *bold* (WhatsApp usa un solo asterisco)
 * - Mantiene emojis
 * - Limita largo
 */
function cleanForWhatsApp(text) {
  let cleaned = text;

  // Reemplazar markdown **bold** con *bold* de WhatsApp
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // Reemplazar ### headers con texto en negrita
  cleaned = cleaned.replace(/^###\s+(.*)/gm, '*$1*');
  cleaned = cleaned.replace(/^##\s+(.*)/gm, '*$1*');
  cleaned = cleaned.replace(/^#\s+(.*)/gm, '*$1*');

  // Remover links markdown [text](url) → text
  cleaned = cleaned.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  // Limitar largo (WhatsApp tiene límite de ~65000 chars, pero ser concisos)
  if (cleaned.length > 1500) {
    cleaned = cleaned.substring(0, 1497) + '...';
  }

  return cleaned.trim();
}

module.exports = { generateAIResponse };
