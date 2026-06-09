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
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Inicializar Base de Conocimiento de Firebase
loadKnowledgeBase().then(() => {
  console.log('✅ Base de conocimiento inicializada correctamente');
});

// Panel Admin Frontend y Backend (Acceso libre a estáticos, seguridad en las APIs)
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/api', adminRoutes);

// Servir la página de inicio de sesión de RESTalk en la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// =============================================
// Webhook principal — Recibe mensajes de UltraMSG
// =============================================
app.post('/webhook/:businessId?', async (req, res) => {
  try {
    // Responder inmediatamente a UltraMSG (evitar timeout)
    res.status(200).send('OK');

    const businessId = req.params.businessId || 'balmoral';
    const data = req.body;
    if (!data || !data.data) return;

    const messageData = data.data;

    // Ignorar mensajes propios o de grupos
    if (messageData.from === 'me' || messageData.fromMe === true) return;
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
  console.log('    Plataforma RESTalk — Chatbots WhatsApp SaaS');
  console.log('    ─────────────────────────────────────────────');
  console.log(`    🌐 Servidor:  http://localhost:${PORT}`);
  console.log(`    📡 Webhook:   http://localhost:${PORT}/webhook`);
  console.log(`    🔑 Admin:     http://localhost:${PORT}/admin`);
  console.log('    ─────────────────────────────────────────────');
  console.log('🍽️  ═══════════════════════════════════════════════');
  console.log('');
});
