// ============================================
// Servicio de IA — Google Gemini
// ============================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSystemPrompt } = require('../config/prompts');
const { getPersonalityLevel } = require('../utils/knowledgeBase');

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function createModel() {
  const level = getPersonalityLevel();
  const systemPrompt = getSystemPrompt(level);
  
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 500, // Respuestas concisas para WhatsApp
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
 * Genera una respuesta inteligente usando Gemini
 * @param {string} userMessage — Mensaje del cliente
 * @param {string} context — Contexto relevante de la base de conocimiento
 * @param {Array} history — Historial de la conversación
 * @param {Object} senderInfo — Información del remitente (numero y nombre)
 * @returns {string} — Respuesta generada
 */
async function generateAIResponse(userMessage, context, history = [], senderInfo = { numero: 'Desconocido', nombre: 'Cliente' }) {
  const MAX_RETRIES = 2;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Construir el historial de conversación para Gemini
      const chatHistory = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // Iniciar chat con historial dinámico (obteniendo el modelo con la personalidad actual)
      const chat = createModel().startChat({
        history: chatHistory,
      });

      // Construir el prompt con contexto
      const promptWithContext = buildPromptWithContext(userMessage, context);

      // Enviar mensaje y obtener respuesta
      const result = await chat.sendMessage(promptWithContext);
      let response = result.response.text();

      // Procesar comando de derivación automática
      if (response.includes('[DERIVAR_CONSULTA]')) {
        const clienteNumero = senderInfo.numero;
        const clienteNombre = senderInfo.nombre;
        const clienteConsulta = userMessage;
        
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
            text: `El bot no pudo responder una consulta y prometió derivarla a un representante.\n\nNombre del Cliente: ${clienteNombre}\nNúmero de WhatsApp: ${clienteNumero}\nConsulta Realizada:\n"${clienteConsulta}"`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #ef4444;">⚠️ Nueva Consulta Derivada</h2>
                <p>El bot no pudo responder una consulta y prometió derivarla a un representante humano.</p>
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <p><strong>Nombre del Cliente:</strong> ${clienteNombre}</p>
                  <p><strong>Número de WhatsApp:</strong> <a href="https://wa.me/${clienteNumero}">${clienteNumero}</a></p>
                  <p><strong>Consulta Realizada:</strong></p>
                  <blockquote style="border-left: 4px solid #ef4444; padding-left: 10px; font-style: italic;">"${clienteConsulta}"</blockquote>
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
        
        // Quitar la etiqueta del mensaje final
        response = response.replace(/\[DERIVAR_CONSULTA\]/gi, '').trim();
      }

      // Limpiar la respuesta para WhatsApp (remover markdown excesivo)
      return cleanForWhatsApp(response);

    } catch (error) {
      lastError = error;
      console.error('❌ Error crudo de Gemini:', error.message);
      
      // Si es error de autenticación, no reintentar
      if (error.message.includes('API key') || error.message.includes('401')) {
        throw new Error('Error de autenticación con Gemini. Verificar API key.');
      }

      // Si es rate limit (429) o sobrecarga (503), esperar y reintentar
      if (error.message.includes('429') || error.message.includes('quota') || error.message.includes('503') || error.message.includes('Unavailable')) {
        const waitTime = Math.pow(2, attempt) * 2000; // 4s, 8s
        console.log(`⏳ Sobrecarga de Gemini. Reintentando en ${waitTime/1000}s (intento ${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // Otros errores, no reintentar
      break;
    }
  }

  // FALLBACK: Si Gemini no está disponible, responder con la base de conocimiento
  console.log('⚠️ Gemini no disponible. Usando respuesta de fallback.');
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
  if (!context || context.trim() === '') {
    return userMessage;
  }

  return `[INFORMACIÓN DEL RESTAURANTE RELEVANTE PARA ESTA CONSULTA]
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
