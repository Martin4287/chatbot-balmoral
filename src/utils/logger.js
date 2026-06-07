// ============================================
// Logger simple de conversaciones
// ============================================

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs/conversations');

/**
 * Registra un evento en el log de conversaciones
 * @param {string} event — Descripción del evento
 * @param {Object} data — Datos adicionales
 */
function log(event, data = {}) {
  try {
    // Crear directorio de logs si no existe
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
    const logFile = path.join(LOGS_DIR, `${dateStr}.log`);

    const logEntry = {
      time: timeStr,
      event,
      ...data
    };

    const logLine = `[${timeStr}] ${event} | ${JSON.stringify(data)}\n`;

    fs.appendFileSync(logFile, logLine, 'utf8');

  } catch (error) {
    // No fallar por errores de logging
    console.error('⚠️ Error de logging:', error.message);
  }
}

module.exports = { log };
