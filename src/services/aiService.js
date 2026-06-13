// ============================================
// Servicio de IA — Google Gemini
// ============================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSystemPrompt } = require('../config/prompts');

// Inicializar Gemini por defecto
const defaultGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function createModel(modelName, businessId = 'balmoral') {
  const { getPersonalityLevel, getBusinessConfig } = require('../utils/knowledgeBase');
  const level = getPersonalityLevel(businessId);
  const businessConfig = getBusinessConfig(businessId);
  
  // Si el negocio tiene su propia Gemini API key configurada, la usamos
  let clientGenAI = defaultGenAI;
  if (businessConfig.geminiApiKey) {
    try {
      clientGenAI = new GoogleGenerativeAI(businessConfig.geminiApiKey);
    } catch (e) {
      console.error(`❌ Error al instanciar Gemini con clave propia de ${businessId}:`, e.message);
    }
  }
  
  const systemPrompt = getSystemPrompt(level, businessConfig);
  
  return clientGenAI.getGenerativeModel({
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
 * @param {string} businessId — ID del negocio inquilino
 * @returns {string} — Respuesta generada
 */
async function generateAIResponse(userMessage, context, history = [], senderInfo = { numero: 'Desconocido', nombre: 'Cliente' }, businessId = 'balmoral') {
  const { getBusinessConfig } = require('../utils/knowledgeBase');
  const businessConfig = getBusinessConfig(businessId);
  const MODELS_TO_TRY = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError;

  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`🤖 [${businessId}] Intentando responder con modelo: ${modelName}`);

      // Construir el historial de conversación para Gemini
      const chatHistory = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // Iniciar chat con historial dinámico
      const chat = createModel(modelName, businessId).startChat({
        history: chatHistory,
      });

      // Construir el prompt con contexto indicando si es inicio de conversación
      const promptWithContext = buildPromptWithContext(userMessage, context, history.length === 0);

      // Enviar mensaje y obtener respuesta
      const result = await chat.sendMessage(promptWithContext);
      let response = result.response.text();

      // Detectar si hay datos de reserva estructurados (ANTES de isDeriving para que lo active)
      const reservaMatch = response.match(/\[RESERVA:\s*([^\]]+)\]/);
      let reservaData = null;
      if (reservaMatch) {
        const pairs = reservaMatch[1].split('|');
        reservaData = {};
        for (const pair of pairs) {
          const [key, ...rest] = pair.split('=');
          if (key && rest.length) reservaData[key.trim()] = rest.join('=').trim();
        }
      }

      // Procesar comando de derivación automática
      const containsDerivTag   = response.includes('[DERIVAR_CONSULTA]');
      const containsReservaTag = !!reservaData; // [RESERVA:...] solo también activa el email
      
      // IMPORTANTE: Solo activamos la derivación si hay una etiqueta explícita.
      // No usamos frases como "se pondrá en contacto" porque el bot las dice también
      // cuando simplemente está pidiendo datos al cliente (falsos positivos).
      const isDeriving = containsDerivTag || containsReservaTag;

      if (isDeriving) {
        const clienteNumero = senderInfo.numero;
        const clienteNombre = senderInfo.nombre;
        const clienteConsulta = userMessage;
        const isReservation = !!reservaData;
        
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

          const recipientEmail = businessConfig.notificationEmail || process.env.EMAIL_USER || 'martindarioschupp@gmail.com';
          console.log(`📧 Enviando ${isReservation ? 'email de RESERVA' : 'email de DERIVACIÓN'} → ${recipientEmail} [negocio: ${businessId}]`);
          
          let subject, htmlBody, textBody;

          if (isReservation) {
            // ===== EMAIL DE RESERVA ESTRUCTURADO =====
            const r = reservaData;
            subject = `📊 Nueva Reserva de WhatsApp - ${businessConfig.name}`;
            textBody = [
              `NUEVA SOLICITUD DE RESERVA - ${businessConfig.name}`,
              ``,
              `Nombre:    ${r.nombre  || '(no especificado)'}`,
              `Cantidad:  ${r.cantidad || '(no especificado)'} personas`,
              `Fecha:     ${r.fecha   || '(no especificado)'}`,
              `Hora:      ${r.hora    || '(no especificado)'}`,
              `Servicio:  ${r.servicio|| '(no especificado)'}`,
              ``,
              `WhatsApp del cliente: ${clienteNumero}`,
              `Nombre en WA:         ${clienteNombre}`,
            ].join('\n');
            htmlBody = `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px;">
                <h2 style="color: #16a34a; margin-bottom: 4px;">📊 Nueva Solicitud de Reserva</h2>
                <p style="color: #666; margin-top: 0;">${businessConfig.name}</p>
                <table style="width:100%; border-collapse: collapse; margin: 20px 0; background: #f0fdf4; border-radius: 8px; overflow: hidden;">
                  <tr style="background: #16a34a; color: white;">
                    <th colspan="2" style="padding: 12px 16px; text-align: left; font-size: 15px;">Datos de la Reserva</th>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; font-weight: bold; width: 35%; border-bottom: 1px solid #dcfce7;">👤 Nombre</td>
                    <td style="padding: 10px 16px; border-bottom: 1px solid #dcfce7;">${r.nombre || '<em style="color:#999">No especificado</em>'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; font-weight: bold; border-bottom: 1px solid #dcfce7;">👥 Cantidad</td>
                    <td style="padding: 10px 16px; border-bottom: 1px solid #dcfce7;">${r.cantidad || '<em style="color:#999">No especificado</em>'} personas</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; font-weight: bold; border-bottom: 1px solid #dcfce7;">📅 Fecha</td>
                    <td style="padding: 10px 16px; border-bottom: 1px solid #dcfce7;">${r.fecha || '<em style="color:#999">No especificado</em>'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; font-weight: bold; border-bottom: 1px solid #dcfce7;">🕐 Hora</td>
                    <td style="padding: 10px 16px; border-bottom: 1px solid #dcfce7;">${r.hora || '<em style="color:#999">No especificado</em>'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; font-weight: bold;">🍽️ Servicio</td>
                    <td style="padding: 10px 16px;">${r.servicio || '<em style="color:#999">No especificado</em>'}</td>
                  </tr>
                </table>
                <div style="background: #f3f4f6; padding: 14px 16px; border-radius: 8px; margin-top: 8px;">
                  <p style="margin: 0 0 6px;"><strong>Cliente en WhatsApp:</strong> ${clienteNombre}</p>
                  <p style="margin: 0;"><strong>Número:</strong> <a href="https://wa.me/${clienteNumero}">${clienteNumero}</a></p>
                </div>
                <p style="margin-top: 18px; color: #555;">Por favor confirmá la reserva contactándote con el cliente a la brevedad.</p>
              </div>`;
          } else {
            // ===== EMAIL DE DERIVACIÓN GENÉRICA =====
            subject = `⚠️ Nueva Consulta de WhatsApp Derivada - ${businessConfig.name}`;
            const cleanResponse = response.replace(/\[DERIVAR_CONSULTA\]/gi, '').replace(/\[RESERVA:[^\]]*\]/gi, '').trim();
            textBody = `El bot derivó una consulta del cliente.\n\nNombre del Cliente: ${clienteNombre}\nNúmero de WhatsApp: ${clienteNumero}\nConsulta Realizada:\n"${clienteConsulta}"\n\nRespuesta del Bot:\n"${cleanResponse}"`;
            htmlBody = `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #ef4444;">⚠️ Nueva Consulta Derivada - ${businessConfig.name}</h2>
                <p>El bot derivó una consulta para atención humana.</p>
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <p><strong>Nombre del Cliente:</strong> ${clienteNombre}</p>
                  <p><strong>Número de WhatsApp:</strong> <a href="https://wa.me/${clienteNumero}">${clienteNumero}</a></p>
                  <p><strong>Consulta Realizada:</strong></p>
                  <blockquote style="border-left: 4px solid #ef4444; padding-left: 10px; font-style: italic;">${clienteConsulta}</blockquote>
                  <p><strong>Respuesta del Bot:</strong></p>
                  <p style="white-space: pre-wrap; font-size: 0.95em;">${cleanResponse}</p>
                </div>
                <p>Por favor, contacte al cliente a la brevedad.</p>
              </div>`;
          }

          await transporter.sendMail({
            from: `"${businessConfig.name}" <${process.env.EMAIL_USER}>`,
            to: recipientEmail,
            subject,
            text: textBody,
            html: htmlBody
          });
          console.log(`✉️ Correo ${isReservation ? 'de reserva' : 'de derivación'} enviado a ${recipientEmail} [${businessId}]`);
        } catch (err) {
           console.error('Error al enviar email via Nodemailer:', err);
        }

        // 2. Enviar WhatsApp al número de ventas
        if (businessConfig.salesPhone && businessConfig.salesPhone.trim() !== '') {
          try {
            const { sendText } = require('./whatsappService');
            let salesPhone = businessConfig.salesPhone.trim();
            if (!salesPhone.endsWith('@c.us')) {
              salesPhone = `${salesPhone}@c.us`;
            }

            let notificationText;
            if (reservaData) {
              const r = reservaData;
              notificationText =
                `📊 *NUEVA RESERVA DE WHATSAPP*\n\n` +
                `👤 *Nombre:* ${r.nombre   || '(no especificado)'}\n` +
                `👥 *Cantidad:* ${r.cantidad || '(no especificado)'} personas\n` +
                `📅 *Fecha:* ${r.fecha     || '(no especificado)'}\n` +
                `🕐 *Hora:* ${r.hora       || '(no especificado)'}\n` +
                `🍽️ *Servicio:* ${r.servicio|| '(no especificado)'}\n\n` +
                `📱 *WhatsApp del cliente:* https://wa.me/${clienteNumero}\n` +
                `👤 *Nombre en WA:* ${clienteNombre}\n\n` +
                `👉 _Hacé clic en el enlace para confirmarle la reserva al cliente._`;
            } else {
              notificationText =
                `⚠️ *NUEVA CONSULTA DERIVADA*\n\n` +
                `👤 *Cliente:* ${clienteNombre}\n` +
                `📱 *WhatsApp:* https://wa.me/${clienteNumero}\n\n` +
                `💬 *Consulta:* "${clienteConsulta}"\n\n` +
                `👉 _Hacé clic en el enlace de WhatsApp para responderle directamente al cliente._`;
            }

            await sendText(businessConfig, salesPhone, notificationText);
            console.log(`💬 WhatsApp de ${reservaData ? 'reserva' : 'derivación'} enviado a ventas (${salesPhone}) [${businessId}]`);
          } catch (err) {
            console.error('Error al enviar WhatsApp de derivación a ventas:', err.message);
          }
        }
        
        // Quitar las etiquetas ocultas del mensaje final al cliente
        response = response
          .replace(/\[RESERVA:[^\]]*\]/gi, '')
          .replace(/\[DERIVAR_CONSULTA\]/gi, '')
          .trim();
      }

      // Limpiar SIEMPRE las etiquetas ocultas por si acaso Gemini las incluyó
      // sin cumplir la condición de derivación (red de seguridad para que nunca
      // lleguen al cliente como texto visible)
      response = response
        .replace(/\[RESERVA:[^\]]*\]/gi, '')
        .replace(/\[DERIVAR_CONSULTA\]/gi, '')
        .trim();

      // Limpiar la respuesta para WhatsApp (remover markdown excesivo)
      return cleanForWhatsApp(response);

    } catch (error) {
      lastError = error;
      console.error(`❌ Error con modelo ${modelName} para ${businessId}:`, error.message);
      
      // Si es error de autenticación, no reintentar
      if (error.message.includes('API key') || error.message.includes('401')) {
        throw new Error('Error de autenticación con Gemini. Verificar API key.');
      }

      console.warn(`⚠️ Modelo ${modelName} falló o no tiene cuota. Probando siguiente modelo...`);
    }
  }

  // FALLBACK: Si todos los modelos fallan, usar la respuesta de fallback local
  console.error(`❌ Todos los modelos de Gemini fallaron para ${businessId}. Usando respuesta de fallback.`);
  return generateFallbackResponse(userMessage, businessId);
}

/**
 * Genera una respuesta de fallback usando la base de conocimiento directamente
 * Se usa cuando Gemini no está disponible (rate limit, error, etc.)
 */
function generateFallbackResponse(userMessage, businessId = 'balmoral') {
  const { getBusinessConfig } = require('../utils/knowledgeBase');
  const businessConfig = getBusinessConfig(businessId);
  const name = businessConfig.name || 'Negocio';
  
  const msg = userMessage.toLowerCase();

  // Saludo
  if (msg.match(/^(hola|buenas|buen dia|buenas noches|buenas tardes|hey|hi)/)) {
    return `¡Buenas! 🍽️ Bienvenido a *${name}*.\n\n` +
      'Es un placer atenderle. ¿En qué puedo ayudarle?\n\n' +
      'Puede preguntarme sobre:\n' +
      '📋 Nuestra carta y menú\n' +
      '🕐 Horarios de atención\n' +
      '📍 Ubicación y cómo llegar\n' +
      '📞 Reservas y turnos';
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
      'Puede consultarnos sobre las opciones disponibles y le daremos toda la información de platos y precios. ¡Consúltenos! ✨';
  }

  // Respuesta genérica de error amable
  return `¡Gracias por comunicarse con *${name}*! 🍽️\n\n` +
    'En este momento mi sistema está experimentando una alta demanda y no puedo procesar su consulta correctamente. Por favor intente nuevamente en unos minutos.\n\n' +
    'Si necesita asistencia inmediata, contáctenos directamente:\n' +
    `📞 ${businessConfig.salesPhone || '(0223) 491-0383'}\n\n` +
    '¡Disculpe las molestias! ✨';
}

/**
 * Parsea un documento de menú (imagen o PDF) a formato JSON usando Gemini
 * @param {string} fileBase64 
 * @param {string} mimeType 
 * @returns {Object} { items: [ { nombre, descripcion, precio, categoria } ] }
 */
async function parseMenuFromDocument(fileBase64, mimeType) {
  const MODELS_TO_TRY = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite'
  ];

  const prompt = `Analizá esta imagen o PDF de un menú de restaurante y extraé todos los platos y bebidas que encuentres.
Extraé de forma precisa:
- nombre (el nombre del plato o bebida, ej: "Milanesa Napolitana")
- descripcion (ingredientes, acompañamientos o detalles, si los hay)
- precio (el precio del plato, extrayéndolo exactamente como aparezca, ej: "$4500" o "4500")
- categoria (el grupo al que pertenece, ej: "Entradas", "Platos Principales", "Postres", "Bebidas", etc.)

Respondé ÚNICAMENTE con un objeto JSON válido que cumpla con el siguiente formato, sin bloques de código markdown de tipo json ni explicaciones, solo el JSON puro:
{
  "items": [
    {
      "nombre": "Nombre del plato",
      "descripcion": "Descripción del plato",
      "precio": "$Precio",
      "categoria": "Categoría"
    }
  ]
}`;

  let lastError;
  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`🤖 Intentando parsear menú con modelo: ${modelName}`);
      const model = defaultGenAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
        {
          inlineData: {
            data: fileBase64,
            mimeType: mimeType
          }
        },
        prompt
      ]);

      let text = result.response.text();
      // Limpiar posibles bloques de código markdown
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      // Si Gemini devolvió algo de texto antes/después del JSON, buscar los corchetes
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        text = text.substring(jsonStart, jsonEnd + 1);
      }
      
      const parsed = JSON.parse(text);
      console.log(`✅ Menú parseado con éxito usando el modelo ${modelName}`);
      return parsed;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Modelo ${modelName} falló al parsear menú:`, error.message);
    }
  }

  console.error('❌ Todos los modelos de Gemini fallaron para parsear el menú.');
  throw lastError || new Error('No se pudo analizar la carta con ninguno de los modelos de Gemini.');
}

/**
 * Construye el prompt inyectando el contexto de la base de conocimiento y reglas de saludo
 */
function buildPromptWithContext(userMessage, context, isNewConversation = true) {
  const options = { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  const currentDateTime = new Intl.DateTimeFormat('es-AR', options).format(new Date());

  const conversationStatusRule = isNewConversation
    ? `[INSTRUCCIÓN DE SALUDO: Este es el inicio de la conversación con el cliente. Saludá obligatoriamente de acuerdo a la hora actual (${currentDateTime}) y atendé su consulta. Evitá saludos repetitivos.]`
    : `[INSTRUCCIÓN DE SALUDO: Esta es una conversación en curso (ya se saludaron previamente). NO vuelvas a saludar al cliente con palabras como "Hola", "Buen día", "Buenos días", "Buenas tardes", "Buenas noches" ni similares. Respondé directamente a la consulta del cliente sin saludar de nuevo, manteniendo la fluidez de la conversación.]`;

  if (!context || context.trim() === '') {
    return `[CONTEXTO DE SISTEMA: Hoy es ${currentDateTime}]
${conversationStatusRule}

Pregunta del cliente: ${userMessage}`;
  }

  return `[CONTEXTO DE SISTEMA: Hoy es ${currentDateTime}]
${conversationStatusRule}

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

module.exports = { generateAIResponse, parseMenuFromDocument };
