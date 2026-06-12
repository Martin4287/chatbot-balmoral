// ============================================
// Chatbot WhatsApp — Restaurante Balmoral
// Hotel Dos Reyes, Mar del Plata
// ============================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const path = require('path');
const { handleIncomingMessage } = require('./webhook/messageHandler');
const { log } = require('./utils/logger');
const { loadKnowledgeBase } = require('./utils/knowledgeBase');
const adminRoutes = require('./routes/adminRoutes');

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
// Webhook principal — Recibe mensajes de UltraMSG
// =============================================
app.post('/webhook/:businessId?', async (req, res) => {
  try {
    // Responder inmediatamente para evitar timeout
    res.status(200).send('OK');

    const businessId = req.params.businessId || 'balmoral';
    const data = req.body;
    if (!data) return;

    let messageData = null;

    // Detectar si el webhook es de WaAPI (contiene data.message)
    if (data.data && data.data.message) {
      const waapiMsg = data.data.message;
      messageData = {
        fromMe: waapiMsg.id ? waapiMsg.id.fromMe : false,
        from: waapiMsg.from || (waapiMsg.id ? waapiMsg.id.remote : ''),
        body: waapiMsg.body || '',
        type: waapiMsg.type || 'chat',
        isGroup: waapiMsg.isGroup || false,
        pushname: waapiMsg.pushName || waapiMsg.pushname || 'Cliente'
      };
    } else if (data.data) {
      // Formato UltraMSG
      messageData = data.data;
    }

    if (!messageData) return;

    // Ignorar mensajes propios o de grupos
    const isFromMe = messageData.fromMe === true || messageData.fromMe === 1 || messageData.fromMe === '1' || String(messageData.fromMe).toLowerCase() === 'true' || messageData.from === 'me';
    if (isFromMe) return;
    if (messageData.isGroup === true) return;

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
