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

// Autenticación para el panel Admin
const authMiddleware = basicAuth({
  users: { [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || 'Balmoral2026' },
  challenge: true,
  realm: 'Restaurante Balmoral Admin'
});

// Panel Admin Frontend y Backend
app.use('/admin', authMiddleware, express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/api', authMiddleware, adminRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: '✅ Chatbot Balmoral activo',
    restaurant: 'Restaurante Balmoral — Hotel Dos Reyes',
    location: 'Av. Colón 2129, Mar del Plata',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// =============================================
// Webhook principal — Recibe mensajes de UltraMSG
// =============================================
app.post('/webhook', async (req, res) => {
  try {
    // Responder inmediatamente a UltraMSG (evitar timeout)
    res.status(200).send('OK');

    const data = req.body;
    if (!data || !data.data) return;

    const messageData = data.data;

    // Ignorar mensajes propios o de grupos
    if (messageData.from === 'me' || messageData.fromMe === true) return;
    if (messageData.isGroup === true) return;

    log('📩 Mensaje recibido', {
      from: messageData.from,
      body: messageData.body,
      type: messageData.type
    });

    // Procesar el mensaje
    await handleIncomingMessage(messageData);

  } catch (error) {
    console.error('❌ Error en webhook:', error.message);
    log('❌ Error en webhook', { error: error.message, stack: error.stack });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('');
  console.log('🍽️  ═══════════════════════════════════════════════');
  console.log('    Chatbot Restaurante Balmoral');
  console.log('    Hotel Dos Reyes — Mar del Plata');
  console.log('    ─────────────────────────────────────────────');
  console.log(`    🌐 Servidor:  http://localhost:${PORT}`);
  console.log(`    📡 Webhook:   http://localhost:${PORT}/webhook`);
  console.log(`    🔑 Admin:     http://localhost:${PORT}/admin`);
  console.log('    ─────────────────────────────────────────────');
  console.log('🍽️  ═══════════════════════════════════════════════');
  console.log('');
});
