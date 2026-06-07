// ============================================
// Chatbot WhatsApp — Restaurante Balmoral
// Hotel Dos Reyes, Mar del Plata
// ============================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { handleIncomingMessage } = require('./webhook/messageHandler');
const { log } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint (útil para Render y monitoreo)
app.get('/', (req, res) => {
  res.json({
    status: '✅ Chatbot Balmoral activo',
    restaurant: 'Restaurante Balmoral — Hotel Dos Reyes',
    location: 'Av. Colón 2129, Mar del Plata',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Health check simple para el cron de keep-alive
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// =============================================
// Webhook principal — Recibe mensajes de UltraMSG
// =============================================
app.post('/webhook', async (req, res) => {
  try {
    // Responder inmediatamente a UltraMSG (evitar timeout)
    res.status(200).send('OK');

    const data = req.body;

    // Validar que hay datos
    if (!data || !data.data) {
      return;
    }

    const messageData = data.data;

    // Ignorar mensajes propios (enviados por el bot) para evitar loops
    if (messageData.from === 'me' || messageData.fromMe === true) {
      return;
    }

    // Ignorar mensajes de grupos (solo responder en chats privados)
    if (messageData.isGroup === true) {
      return;
    }

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
  console.log('    ─────────────────────────────────────────────');
  console.log('    📋 Configurá la URL del webhook en UltraMSG');
  console.log('       apuntando a: <TU_URL_PUBLICA>/webhook');
  console.log('🍽️  ═══════════════════════════════════════════════');
  console.log('');
});
