// ============================================
// Chatbot WhatsApp — Restaurante Balmoral
// Hotel Dos Reyes, Mar del Plata
// ============================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const path = require('path');
const { handleIncomingMessage, saveSession } = require('./webhook/messageHandler');
const { log } = require('./utils/logger');
const { loadKnowledgeBase, getBusinessConfig } = require('./utils/knowledgeBase');
const adminRoutes = require('./routes/adminRoutes');
const { getPendingFollowUpSessions, getRegisteredBusinessIds } = require('./utils/firebase');
const { generateFollowUp } = require('./services/aiService');
const { sendText } = require('./services/whatsappService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Inicializar Base de Conocimiento de Firebase
loadKnowledgeBase().then(() => {
  console.log('✅ Base de conocimiento inicializada correctamente');
});

// Panel Admin Frontend y Backend (Acceso libre a estáticos, seguridad en las APIs)
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));
app.use('/api', adminRoutes);

// Servir la página de inicio de sesión de RISTapp en la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/debug-logs', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const LOGS_DIR = path.join(__dirname, '..', 'logs', 'conversations');
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const logFile = path.join(LOGS_DIR, `${dateStr}.log`);
    
    if (!fs.existsSync(logFile)) {
      return res.status(404).send('No logs found for today.');
    }
    
    const content = fs.readFileSync(logFile, 'utf8');
    res.type('text/plain').send(content);
  } catch (error) {
    res.status(500).send('Error reading logs: ' + error.message);
  }
});

// =============================================
// Buffer diagnóstico para los últimos payloads recibidos
// =============================================
const lastWebhookPayloads = [];
app.get('/debug-webhook', (req, res) => {
  res.json({ count: lastWebhookPayloads.length, payloads: lastWebhookPayloads });
});

// =============================================
// Deduplicador de mensajes — evita procesar el mismo
// mensaje dos veces si el servidor se despierta tarde
// y WaAPI reintenta el webhook.
// =============================================
const processedMessageIds = new Map(); // messageId -> timestamp
const MESSAGE_DEDUP_TTL = 10 * 60 * 1000; // 10 minutos

function isAlreadyProcessed(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  // Limpiar entradas viejas
  for (const [id, ts] of processedMessageIds.entries()) {
    if (now - ts > MESSAGE_DEDUP_TTL) processedMessageIds.delete(id);
  }
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.set(messageId, now);
  return false;
}

// =============================================
// Webhook principal — Recibe mensajes de UltraMSG / WaAPI
// =============================================
app.post('/webhook/:businessId?', async (req, res) => {
  try {
    // Responder inmediatamente para evitar timeout
    res.status(200).send('OK');

    const businessId = req.params.businessId || 'balmoral';
    const data = req.body;
    if (!data) return;

    // Guardar los últimos 5 payloads para diagnóstico
    lastWebhookPayloads.unshift({ ts: new Date().toISOString(), businessId, payload: data });
    if (lastWebhookPayloads.length > 5) lastWebhookPayloads.pop();

    let messageData = null;

    // Detectar el proveedor del webhook:
    // WaAPI envía: { event: '...', instanceId: '...', data: { message: {...} } }
    // UltraMSG envía: { data: { id, from, body, type, fromMe, ... } } (sin campo 'event' ni 'instanceId')
    const isWaapi = (data.event !== undefined || data.instanceId !== undefined) && data.data && data.data.message;
    
    if (isWaapi) {
      // WaAPI dispara 'message' y 'message_create' para cada mensaje.
      // Solo procesamos 'message' para evitar respuestas duplicadas.
      if (data.event !== 'message') return;
      
      const waapiMsg = data.data.message;
      
      // WaAPI a veces envía el remitente en formato LID (@lid) en lugar de @c.us.
      // Usamos el campo 'from' del mensaje. Si es un LID, lo usamos tal cual
      // porque WaAPI puede rutear por LID. Para el chatId de respuesta usamos 'from'.
      const rawFrom = waapiMsg.from || (waapiMsg.id ? waapiMsg.id.remote : '');
      
      messageData = {
        fromMe: waapiMsg.id ? Boolean(waapiMsg.id.fromMe) : false,
        from: rawFrom,
        body: waapiMsg.body || '',
        type: waapiMsg.type || 'chat',
        isGroup: waapiMsg.isGroup || false,
        pushname: waapiMsg.notifyName || waapiMsg.pushName || waapiMsg.pushname || 'Cliente',
        messageId: waapiMsg.id ? waapiMsg.id._serialized || waapiMsg.id.id : null
      };
    } else if (data.data) {
      // Formato UltraMSG: el payload llega directamente en data.data
      messageData = data.data;
      messageData.messageId = data.data.id || null;
    }

    if (!messageData) return;

    // Ignorar mensajes propios, de grupos o de canales de estado
    const isFromMe = messageData.fromMe === true || messageData.fromMe === 1 || messageData.fromMe === '1' || String(messageData.fromMe).toLowerCase() === 'true' || messageData.from === 'me';
    if (isFromMe) return;
    if (messageData.isGroup === true) return;
    if (messageData.from === 'status@broadcast') return;
    if (!messageData.from || messageData.from.trim() === '') return;

    // Deduplicación: ignorar si este mensaje ya fue procesado antes
    if (isAlreadyProcessed(messageData.messageId)) {
      console.log(`⏭️ Mensaje duplicado ignorado (ID: ${messageData.messageId})`);
      return;
    }

    log('📩 Mensaje recibido', {
      businessId,
      from: messageData.from,
      body: messageData.body,
      type: messageData.type
    });

    // Procesar el mensaje para el negocio específico
    await handleIncomingMessage(messageData, businessId);

  } catch (error) {
    console.error('❌ Error en webhook:', error.message);
    log('❌ Error en webhook', { error: error.message, stack: error.stack });
  }
// =============================================
// Tarea de Seguimiento / Re-engagement de 15 Minutos
// =============================================
async function checkAndSendFollowUps() {
  console.log('⏰ Ejecutando chequeo automático de seguimiento...');
  try {
    const businessIds = await getRegisteredBusinessIds();
    const now = Date.now();
    const fifteenMins = 15 * 60 * 1000;
    const twoHours = 2 * 60 * 60 * 1000;

    for (const businessId of businessIds) {
      const pendingSessions = await getPendingFollowUpSessions(businessId);
      
      for (const session of pendingSessions) {
        const timeDiff = now - session.lastActive;
        // Si han pasado entre 15 minutos y 2 horas desde el último mensaje del bot
        if (timeDiff >= fifteenMins && timeDiff <= twoHours) {
          const sender = session.sender;
          console.log(`✉️ Reenganchando chat inactivo: ${sender} [negocio: ${businessId}, tiempo: ${Math.round(timeDiff/1000/60)}m]`);
          
          try {
            // 1. Generar el mensaje de seguimiento personalizado con Gemini
            const followUpText = await generateFollowUp(session.messages, businessId);
            
            // 2. Cargar configuración para enviar WhatsApp
            const businessConfig = getBusinessConfig(businessId);
            
            // 3. Enviar mensaje por WhatsApp
            await sendText(businessConfig, sender, followUpText);
            
            // 4. Actualizar historial de la sesión en memoria
            session.messages.push({ role: 'assistant', content: followUpText, timestamp: Date.now() });
            
            // Mantener solo los últimos N mensajes
            if (session.messages.length > 20) {
              session.messages.splice(0, session.messages.length - 20);
            }
            
            // 5. Marcar como enviado, actualizar lastActive y guardar
            session.followUpSent = true;
            session.lastActive = Date.now();
            session.lastSender = 'assistant';
            
            await saveSession(businessId, sender, session);
            console.log(`✅ Seguimiento enviado exitosamente a ${sender}`);
            log('✉️ Seguimiento automático enviado', { businessId, to: sender, message: followUpText });
          } catch (err) {
            console.error(`❌ Error enviando seguimiento a ${sender}:`, err.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error en tarea de seguimiento checkAndSendFollowUps:', error.message);
  }
}

// Iniciar tarea en segundo plano ejecutándose cada 2 minutos
setInterval(() => {
  checkAndSendFollowUps().catch(console.error);
}, 2 * 60 * 1000);

// Endpoint de trigger manual o mediante cronjob externo (ej. UptimeRobot)
app.get('/api/cron/follow-up', async (req, res) => {
  try {
    const secret = req.query.secret;
    const expectedSecret = process.env.ADMIN_PASS || 'Balmoral2026';
    if (secret !== expectedSecret) {
      return res.status(401).send('No autorizado');
    }
    
    // Ejecutar asíncronamente
    checkAndSendFollowUps().catch(console.error);
    res.json({ success: true, message: 'Chequeo de seguimientos disparado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Iniciar servidor
app.listen(PORT, () => {
  console.log('');
  console.log('🍽️  ═══════════════════════════════════════════════');
  console.log('    Plataforma RISTapp — Chatbots WhatsApp SaaS');
  console.log('    ─────────────────────────────────────────────');
  console.log(`    🌐 Servidor:  http://localhost:${PORT}`);
  console.log(`    📡 Webhook:   http://localhost:${PORT}/webhook`);
  console.log(`    🔑 Admin:     http://localhost:${PORT}/admin`);
  console.log('    ─────────────────────────────────────────────');
  console.log('🍽️  ═══════════════════════════════════════════════');
  console.log('');
});
