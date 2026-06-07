// ============================================
// Base de Conocimiento — Motor de búsqueda
// ============================================

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, '../../knowledge');

// Cache de datos cargados
let knowledgeCache = null;
let lastLoadTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // Recargar cada 5 minutos

/**
 * Carga todos los archivos de conocimiento
 */
function loadKnowledge() {
  const now = Date.now();
  if (knowledgeCache && (now - lastLoadTime) < CACHE_TTL) {
    return knowledgeCache;
  }

  try {
    knowledgeCache = {
      restaurant: loadJSON('restaurant-info.json'),
      menu: loadJSON('menu.json'),
      faq: loadJSON('faq.json'),
      horarios: loadJSON('horarios.json'),
      eventos: loadJSON('eventos.json'),
      media: loadJSON('media.json'),
    };
    lastLoadTime = now;
    console.log('📚 Base de conocimiento cargada/actualizada');
  } catch (error) {
    console.error('❌ Error cargando base de conocimiento:', error.message);
    if (!knowledgeCache) {
      knowledgeCache = {};
    }
  }

  return knowledgeCache;
}

/**
 * Carga un archivo JSON de la carpeta knowledge/
 */
function loadJSON(filename) {
  const filePath = path.join(KNOWLEDGE_DIR, filename);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }
  return null;
}

/**
 * Obtiene el contexto relevante de la base de conocimiento
 * según el mensaje del usuario
 * @param {string} userMessage — Mensaje del cliente
 * @returns {string} — Contexto formateado para inyectar en el prompt de IA
 */
function getRelevantContext(userMessage) {
  const kb = loadKnowledge();
  const msg = userMessage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const contextParts = [];

  // 1. Buscar en FAQ (las preguntas más comunes)
  const faqMatches = searchFAQ(msg, kb.faq);
  if (faqMatches.length > 0) {
    contextParts.push('--- PREGUNTAS FRECUENTES RELEVANTES ---');
    faqMatches.forEach(faq => {
      contextParts.push(`P: ${faq.pregunta}\nR: ${faq.respuesta}`);
    });
  }

  // 2. Si pregunta sobre horarios
  if (matchesAny(msg, ['horario', 'hora', 'abren', 'cierran', 'abierto', 'cerrado', 'atencion', 'turno'])) {
    if (kb.horarios) {
      contextParts.push('--- HORARIOS ---');
      contextParts.push(formatHorarios(kb.horarios));
    }
  }

  // 3. Si pregunta sobre el menú/carta/platos/comida
  if (matchesAny(msg, ['menu', 'carta', 'plato', 'comer', 'cenar', 'almorzar', 'comida', 'tienen', 'precio', 'cocina', 'especialidad'])) {
    if (kb.menu && kb.menu.categorias) {
      contextParts.push('--- MENÚ / CARTA ---');
      contextParts.push(formatMenu(kb.menu));
    }
  }

  // 4. Si pregunta sobre eventos/promociones/música
  if (matchesAny(msg, ['evento', 'promo', 'musica', 'piano', 'show', 'especial', 'temporada', 'descuento'])) {
    if (kb.eventos) {
      contextParts.push('--- EVENTOS Y PROMOCIONES ---');
      contextParts.push(formatEventos(kb.eventos));
    }
  }

  // 5. Si pregunta sobre ubicación/dirección/cómo llegar
  if (matchesAny(msg, ['donde', 'direccion', 'ubicacion', 'llegar', 'queda', 'mapa', 'estacionamiento', 'parking'])) {
    if (kb.restaurant) {
      contextParts.push('--- UBICACIÓN ---');
      contextParts.push(`Dirección: ${kb.restaurant.direccion}`);
      contextParts.push(`Ubicación: Dentro del Hotel Dos Reyes (planta baja)`);
      contextParts.push(`Estacionamiento: ${kb.restaurant.estacionamiento}`);
    }
  }

  // 6. Si pregunta sobre reservas
  if (matchesAny(msg, ['reserva', 'reservar', 'mesa', 'lugar', 'disponibilidad'])) {
    if (kb.restaurant && kb.restaurant.reservas) {
      contextParts.push('--- RESERVAS ---');
      contextParts.push(JSON.stringify(kb.restaurant.reservas, null, 2));
    }
  }

  // 7. Si pregunta sobre pago/tarjetas
  if (matchesAny(msg, ['pago', 'tarjeta', 'efectivo', 'debito', 'credito', 'mercado pago', 'transferencia', 'pagar'])) {
    if (kb.restaurant && kb.restaurant.formas_pago) {
      contextParts.push('--- FORMAS DE PAGO ---');
      contextParts.push(`Formas de pago aceptadas: ${kb.restaurant.formas_pago.join(', ')}`);
    }
  }

  // 8. Si pregunta sobre el hotel/restaurante en general
  if (matchesAny(msg, ['hotel', 'huesped', 'alojado', 'publico', 'balmoral', 'dos reyes', 'servicios', 'wifi', 'accesibilidad', 'vestimenta', 'dress'])) {
    if (kb.restaurant) {
      contextParts.push('--- INFORMACIÓN GENERAL ---');
      contextParts.push(`Nombre: ${kb.restaurant.nombre} — ${kb.restaurant.hotel}`);
      contextParts.push(`Descripción: ${kb.restaurant.descripcion}`);
      contextParts.push(`Abierto al público: ${kb.restaurant.nota_publico}`);
      contextParts.push(`WiFi: ${kb.restaurant.wifi}`);
      contextParts.push(`Dress code: ${kb.restaurant.dress_code}`);
      contextParts.push(`Accesibilidad: ${kb.restaurant.accesibilidad}`);
    }
  }

  // 9. Siempre incluir datos de contacto básicos
  if (kb.restaurant) {
    contextParts.push('--- CONTACTO ---');
    contextParts.push(`Teléfonos: ${kb.restaurant.telefonos.join(' / ')}`);
    contextParts.push(`WhatsApp: ${kb.restaurant.whatsapp}`);
    contextParts.push(`Email: ${kb.restaurant.email}`);
  }

  // 10. Servicios especiales (celíacos, vegetarianos, niños, eventos)
  if (matchesAny(msg, ['celiaco', 'gluten', 'tacc', 'vegetariano', 'vegano', 'nino', 'infantil', 'chico', 'familia', 'alergia', 'especial'])) {
    if (kb.restaurant && kb.restaurant.servicios_especiales) {
      contextParts.push('--- SERVICIOS ESPECIALES ---');
      contextParts.push(kb.restaurant.servicios_especiales.join('\n'));
    }
  }

  return contextParts.join('\n\n');
}

/**
 * Busca en las FAQ por tags que coincidan con el mensaje
 */
function searchFAQ(msg, faqList) {
  if (!faqList || !Array.isArray(faqList)) return [];

  return faqList.filter(faq => {
    if (!faq.tags) return false;
    return faq.tags.some(tag => {
      const normalizedTag = tag.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return msg.includes(normalizedTag);
    });
  }).slice(0, 3); // Máximo 3 FAQ relevantes
}

/**
 * Verifica si el mensaje contiene alguna de las palabras clave
 */
function matchesAny(msg, keywords) {
  return keywords.some(kw => msg.includes(kw));
}

/**
 * Formatea los horarios para el contexto
 */
function formatHorarios(horarios) {
  if (!horarios || !horarios.horarios_regulares) return 'Horarios no disponibles.';

  const lines = ['Horarios regulares:'];
  const dias = horarios.horarios_regulares;
  for (const [dia, horas] of Object.entries(dias)) {
    lines.push(`  ${dia.charAt(0).toUpperCase() + dia.slice(1)}: Almuerzo ${horas.almuerzo} | Cena ${horas.cena}`);
  }

  if (horarios.temporada_alta) {
    lines.push(`\nTemporada alta (${horarios.temporada_alta.periodo}): ${horarios.temporada_alta.nota}`);
  }

  return lines.join('\n');
}

/**
 * Formatea el menú para el contexto
 */
function formatMenu(menu) {
  if (!menu || !menu.categorias) return 'Menú no disponible actualmente.';

  const lines = [];
  menu.categorias.forEach(cat => {
    const items = cat.platos || cat.items || [];
    if (items.length > 0) {
      lines.push(`\n${cat.nombre}:`);
      items.forEach(item => {
        let line = `  - ${item.nombre}`;
        if (item.descripcion) line += `: ${item.descripcion}`;
        if (item.precio && item.precio !== 'Consultar') line += ` ($${item.precio})`;
        if (item.apto_celiaco) line += ' [SIN TACC]';
        if (item.vegetariano) line += ' [VEGETARIANO]';
        if (item.vegano) line += ' [VEGANO]';
        if (item.destacado) line += ' ⭐';
        lines.push(line);
      });
    }
  });

  if (menu.nota) {
    lines.push(`\nNota: ${menu.nota}`);
  }

  return lines.length > 0 ? lines.join('\n') : 'La carta está siendo actualizada. Puede solicitar el PDF de la carta completa.';
}

/**
 * Formatea los eventos para el contexto
 */
function formatEventos(eventos) {
  if (!eventos) return 'Sin eventos disponibles.';

  const lines = [];

  if (eventos.eventos_actuales) {
    eventos.eventos_actuales.filter(e => e.vigente).forEach(e => {
      lines.push(`🎵 ${e.nombre}: ${e.descripcion} — ${e.dias}, ${e.horario}`);
    });
  }

  if (eventos.promociones && eventos.promociones.length > 0) {
    lines.push('\nPromociones:');
    eventos.promociones.forEach(p => {
      lines.push(`  🏷️ ${p.nombre}: ${p.descripcion}`);
    });
  }

  if (eventos.menu_temporada && eventos.menu_temporada.platos_destacados && eventos.menu_temporada.platos_destacados.length > 0) {
    lines.push(`\nMenú de temporada (${eventos.menu_temporada.temporada_actual}):`);
    lines.push(eventos.menu_temporada.descripcion);
  }

  return lines.length > 0 ? lines.join('\n') : 'No hay eventos especiales programados actualmente.';
}

/**
 * Detecta si el usuario está pidiendo contenido multimedia
 * (foto, carta, PDF, documento)
 * @param {string} userMessage — Mensaje del usuario
 * @returns {Object|null} — Datos del media a enviar, o null
 */
function getMediaForTopic(userMessage) {
  const kb = loadKnowledge();
  if (!kb.media) return null;

  const msg = userMessage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Verificar carta/menú PDF
  if (kb.media.carta_pdf && kb.media.carta_pdf.url) {
    const cartaKeywords = kb.media.carta_pdf.keywords || [];
    if (cartaKeywords.some(kw => msg.includes(kw.toLowerCase()))) {
      // Solo enviar si el mensaje parece pedir activamente la carta
      const activeRequest = ['mandame', 'enviame', 'envíame', 'manda', 'envia', 'envía', 'quiero ver', 'pasame', 'pasá', 'mandar', 'enviar', 'pdf', 'ver carta', 'ver menu', 'ver el menu', 'ver la carta'];
      if (activeRequest.some(kw => msg.includes(kw))) {
        return {
          type: 'document',
          url: kb.media.carta_pdf.url,
          filename: kb.media.carta_pdf.filename,
          caption: kb.media.carta_pdf.caption
        };
      }
    }
  }

  // Verificar fotos
  if (kb.media.fotos) {
    for (const [key, foto] of Object.entries(kb.media.fotos)) {
      if (foto.url && foto.keywords) {
        if (foto.keywords.some(kw => msg.includes(kw.toLowerCase()))) {
          const activePhotoRequest = ['foto', 'fotos', 'imagen', 'muestra', 'mostrame', 'mostrá', 'ver'];
          if (activePhotoRequest.some(kw => msg.includes(kw))) {
            return {
              type: 'image',
              url: foto.url,
              caption: foto.caption
            };
          }
        }
      }
    }
  }

  return null;
}

module.exports = { getRelevantContext, getMediaForTopic };
