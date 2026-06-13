const fs = require('fs');
const path = require('path');
const { getAllDocuments, getDocument, isFirebaseConfigured } = require('./firebase');

// Estructuras indexadas por businessId
let knowledgeBases = {};      // Contiene los textos planos formateados para la IA
let rawKnowledgeBases = {};   // Contiene los JSON crudos de Firestore (ej. menús estructurados)
let businessConfigs = {};     // Contiene la configuración de UltraMSG y correo del negocio

/**
 * Carga o actualiza el cerebro y configuración de un negocio específico
 * @param {string} businessId 
 */
async function loadKnowledgeBase(businessId = 'balmoral') {
  try {
    if (!isFirebaseConfigured()) {
      console.warn(`⚠️ Firebase no conectado. Se usará la base local (solo balmoral).`);
      if (businessId === 'balmoral') {
        const localKB = loadKnowledgeBaseLocalFallback();
        knowledgeBases['balmoral'] = localKB;
        businessConfigs['balmoral'] = {
          businessId: 'balmoral',
          name: 'Restaurante Balmoral',
          ultramsgInstance: process.env.ULTRAMSG_INSTANCE_ID,
          ultramsgToken: process.env.ULTRAMSG_TOKEN,
          salesPhone: process.env.SALES_WHATSAPP || '5492233041076',
          notificationEmail: process.env.EMAIL_USER || 'martindarioschupp@gmail.com'
        };
        return localKB;
      }
      return {};
    }

    console.log(`📚 Cargando configuración y cerebro para: ${businessId}...`);
    
    // 1. Cargar configuración del negocio desde Firestore
    const configData = await getDocument('businesses', businessId);
    if (!configData) {
      console.error(`❌ No se encontró la configuración del negocio: ${businessId}`);
      if (businessId === 'balmoral') {
        // Fallback usando variables de entorno para balmoral
        businessConfigs['balmoral'] = {
          businessId: 'balmoral',
          name: 'Restaurante Balmoral',
          ultramsgInstance: process.env.ULTRAMSG_INSTANCE_ID,
          ultramsgToken: process.env.ULTRAMSG_TOKEN,
          salesPhone: process.env.SALES_WHATSAPP || '5492233041076',
          notificationEmail: process.env.EMAIL_USER || 'martindarioschupp@gmail.com'
        };
      } else {
        throw new Error(`El negocio ${businessId} no está registrado.`);
      }
    } else {
      businessConfigs[businessId] = {
        businessId,
        name: configData.name || 'Negocio',
        ultramsgInstance: configData.ultramsgInstance || '',
        ultramsgToken: configData.ultramsgToken || '',
        salesPhone: configData.salesPhone || '',
        // Fallback encadenado: Firestore -> var entorno -> email hardcodeado de balmoral
        notificationEmail: configData.notificationEmail ||
                           process.env.NOTIFICATION_EMAIL ||
                           process.env.EMAIL_USER ||
                           (businessId === 'balmoral' ? 'martindarioschupp@gmail.com' : ''),
        geminiApiKey: configData.geminiApiKey || ''
      };
    }

    // 2. Cargar documentos de conocimiento
    const data = await getAllDocuments(`businesses/${businessId}/knowledge`);
    rawKnowledgeBases[businessId] = data;
    
    const businessKB = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'faq') {
        if (value.content !== undefined) {
          businessKB[key] = value.content;
        } else {
          const faqItems = value.items || [];
          businessKB[key] = faqItems.map(item => `P: ${item.pregunta}\nR: ${item.respuesta}`).join('\n\n');
        }
      } else if (key === 'menu') {
        if (value.content !== undefined) {
          businessKB[key] = value.content;
        } else if (value.items) {
          // Si el menú está estructurado como lista visual
          businessKB[key] = value.items.map(item => 
            `- ${item.nombre}: ${item.precio}${item.descripcion ? ` (${item.descripcion})` : ''}`
          ).join('\n');
        } else {
          businessKB[key] = JSON.stringify(value, null, 2);
        }
      } else {
        if (value.content !== undefined) {
          businessKB[key] = value.content;
        } else {
          businessKB[key] = JSON.stringify(value, null, 2);
        }
      }
    }
    
    // Crear alias para evitar inconsistencia con "restaurant-info" y "restaurant"
    if (businessKB['restaurant-info'] && !businessKB.restaurant) {
      businessKB.restaurant = businessKB['restaurant-info'];
    }
    
    knowledgeBases[businessId] = businessKB;
    console.log(`✅ Base de conocimiento sincronizada para: ${businessId}`);
    return businessKB;
  } catch (error) {
    console.error(`❌ Error leyendo conocimiento de Firebase para ${businessId}:`, error);
    if (businessId === 'balmoral') {
      return loadKnowledgeBaseLocalFallback();
    }
    return {};
  }
}

function loadKnowledgeBaseLocalFallback() {
  try {
    const knowledgeDir = path.join(__dirname, '..', '..', 'knowledge');
    if (!fs.existsSync(knowledgeDir)) return {};
    
    const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.json'));
    const balmoralKB = {};
    
    for (const file of files) {
      const key = file.replace('.json', '');
      const rawData = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
      const jsonData = JSON.parse(rawData);
      
      if (key === 'faq') {
        if (jsonData.content !== undefined) {
          balmoralKB[key] = jsonData.content;
        } else if (Array.isArray(jsonData)) {
          balmoralKB[key] = jsonData.map(item => `P: ${item.pregunta}\nR: ${item.respuesta}`).join('\n\n');
        } else {
          balmoralKB[key] = JSON.stringify(jsonData, null, 2);
        }
      } else {
        if (jsonData.content !== undefined) {
          balmoralKB[key] = jsonData.content;
        } else {
          balmoralKB[key] = JSON.stringify(jsonData, null, 2);
        }
      }
    }
    
    if (balmoralKB['restaurant-info'] && !balmoralKB.restaurant) {
      balmoralKB.restaurant = balmoralKB['restaurant-info'];
    }
    
    console.log('✅ Base de conocimiento local cargada para balmoral (Fallback)');
    return balmoralKB;
  } catch (err) {
    console.error('Error cargando knowledgeBase local:', err);
    return {};
  }
}

/**
 * Obtiene la información compilada para pasarle a la IA
 * @param {string} query 
 * @param {string} businessId 
 */
function getRelevantContext(query, businessId = 'balmoral') {
  let relevantInfo = [];
  const kb = knowledgeBases[businessId] || {};

  const restaurantData = kb.restaurant || kb['restaurant-info'];
  if (restaurantData) relevantInfo.push('INFORMACIÓN GENERAL:\n' + restaurantData);
  if (kb.horarios) relevantInfo.push('HORARIOS DE ATENCIÓN:\n' + kb.horarios);
  // Omitimos kb.eventos para proteger credenciales y evitar que el bot repita la promoción de Happy Hour en cada respuesta.
  if (kb.menu) relevantInfo.push('CARTA Y MENÚ:\n' + kb.menu);
  if (kb.faq) relevantInfo.push('PREGUNTAS FRECUENTES:\n' + kb.faq);
  
  if (kb.media) {
    try {
      let mediaInfo = typeof kb.media === 'string' ? JSON.parse(kb.media) : kb.media;
      let mediaTexts = [];
      if (mediaInfo.carta_pdf && mediaInfo.carta_pdf.url) mediaTexts.push(`Carta PDF: ${mediaInfo.carta_pdf.url}`);
      if (mediaInfo.fotos) {
        for (const [key, foto] of Object.entries(mediaInfo.fotos)) {
          if (foto.url) mediaTexts.push(`Foto de ${key.replace('_', ' ')}: ${foto.url}`);
        }
      }
      if (mediaInfo.documentos) {
        for (const [key, doc] of Object.entries(mediaInfo.documentos)) {
          if (doc.url) mediaTexts.push(`Documento de ${key.replace('_', ' ')}: ${doc.url}`);
        }
      }
      if (mediaTexts.length > 0) {
        relevantInfo.push('ENLACES A FOTOS Y DOCUMENTOS DISPONIBLES:\n' + mediaTexts.join('\n'));
      }
    } catch (e) {
      // Ignorar errores de parseo
    }
  }

  return relevantInfo.join('\n\n---\n\n');
}

/**
 * Resuelve si un mensaje solicita algún recurso multimedia (PDF o imagen de plato)
 * @param {string} query 
 * @param {string} businessId 
 * @param {Array} history
 */
function getMediaForTopic(query, businessId = 'balmoral', history = []) {
  const normalize = str => str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quitar acentos
    .replace(/[^a-z0-9\s]/g, ' ')     // quitar caracteres especiales
    .trim();

  const q = normalize(query);
  const kb = knowledgeBases[businessId] || {};
  const rawKb = rawKnowledgeBases[businessId] || {};

  const isAskingForPhoto = 
    q.includes('foto') || q.includes('imagen') || q.includes('imagenes') ||
    q.includes('mostra') || q.includes('ver') || q.includes('manda') ||
    q.includes('envia') || q.includes('tenes foto') || q.includes('hay foto') ||
    q.includes('podes mandar') || q.includes('podes enviar');

  const isAskingForGeneralMenu = q.includes('carta') || q.includes('menu') || q.includes('pdf');

  // Si pide una foto/imagen pero NO de la carta general, priorizamos buscar platos del menú
  const prioritizeDishes = isAskingForPhoto && !isAskingForGeneralMenu;

  /**
   * Verifica si el nombre del plato (o alguna de sus palabras clave) aparece
   * en el texto de búsqueda usando coincidencia parcial por palabras.
   */
  const dishMatchesText = (dishName, text) => {
    const normalizedDish = normalize(dishName);
    // 1. Coincidencia exacta del nombre completo
    if (text.includes(normalizedDish)) return true;
    // 2. Coincidencia parcial: cada palabra significativa del plato en el texto
    const stopWords = ['de', 'del', 'con', 'al', 'a', 'la', 'el', 'los', 'las', 'y', 'o', 'en'];
    const dishWords = normalizedDish.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
    if (dishWords.length === 0) return false;
    // Si AL MENOS UNA palabra clave del plato aparece en la consulta, es match
    return dishWords.some(word => text.includes(word));
  };

  const searchDishes = () => {
    const menuData = rawKb.menu || {};
    if (menuData.items && Array.isArray(menuData.items)) {
      if (isAskingForPhoto) {
        // 2.1 Coincidencia directa: busca en el mensaje actual del usuario
        for (const item of menuData.items) {
          if (item.imagen_url && dishMatchesText(item.nombre, q)) {
            console.log(`📸 Foto encontrada por mensaje directo: ${item.nombre}`);
            return {
              type: 'image',
              url: item.imagen_url,
              caption: `Aqui tenes la foto de: *${item.nombre}*`
            };
          }
        }

        // 2.2 Coincidencia contextual: busca en el ultimo mensaje enviado por el bot
        if (history && history.length > 0) {
          const lastAssistantMsg = [...history].reverse().find(msg => msg.role === 'assistant');
          if (lastAssistantMsg) {
            const lastText = normalize(lastAssistantMsg.content);
            for (const item of menuData.items) {
              if (item.imagen_url && dishMatchesText(item.nombre, lastText)) {
                console.log(`📸 Foto encontrada por contexto del historial: ${item.nombre}`);
                return {
                  type: 'image',
                  url: item.imagen_url,
                  caption: `Aqui tenes la foto de: *${item.nombre}*`
                };
              }
            }
          }
        }

        // Log de debug si no se encontro ningun plato con foto
        const itemsWithPhotos = menuData.items.filter(i => i.imagen_url);
        console.log(`ℹ️ Busqueda de foto no encontro coincidencia. Platos con foto disponibles: [${itemsWithPhotos.map(i => i.nombre).join(', ')}]. Query: "${query}"`);
      }
    }
    return null;
  };

  const searchGeneralMedia = () => {
    if (kb.media) {
      try {
        let mediaData = typeof kb.media === 'string' ? JSON.parse(kb.media) : kb.media;

        // Carta PDF
        if (mediaData.carta_pdf && mediaData.carta_pdf.url && mediaData.carta_pdf.keywords) {
          if (mediaData.carta_pdf.keywords.some(kw => q.includes(kw.toLowerCase()))) {
            return {
              type: 'document',
              url: mediaData.carta_pdf.url,
              filename: mediaData.carta_pdf.filename || 'Carta.pdf',
              caption: mediaData.carta_pdf.caption || 'Aquí tiene nuestra carta'
            };
          }
        }
        
        // Fotos generales
        if (mediaData.fotos) {
          for (const [key, foto] of Object.entries(mediaData.fotos)) {
            if (foto.url && foto.keywords && foto.keywords.some(kw => q.includes(kw.toLowerCase()))) {
              return {
                type: 'image',
                url: foto.url,
                caption: foto.caption || ''
              };
            }
          }
        }

        // Documentos
        if (mediaData.documentos) {
          for (const [key, doc] of Object.entries(mediaData.documentos)) {
            if (doc.url && doc.keywords && doc.keywords.some(kw => q.includes(kw.toLowerCase()))) {
              return {
                type: 'document',
                url: doc.url,
                filename: doc.filename || 'Documento.pdf',
                caption: doc.caption || ''
              };
            }
          }
        }
      } catch (err) {
        console.error('Error parseando mediaData:', err);
      }
    }
    return null;
  };

  if (prioritizeDishes) {
    const dishResult = searchDishes();
    if (dishResult) return dishResult;
    
    const generalResult = searchGeneralMedia();
    if (generalResult) return generalResult;
  } else {
    const generalResult = searchGeneralMedia();
    if (generalResult) return generalResult;

    const dishResult = searchDishes();
    if (dishResult) return dishResult;
  }
  
  return null;
}

/**
 * Obtiene el nivel de emocionalidad del bot del negocio
 * @param {string} businessId 
 */
function getPersonalityLevel(businessId = 'balmoral') {
  const kb = knowledgeBases[businessId] || {};
  if (kb.personalidad !== undefined) {
    let val = kb.personalidad;
    if (typeof val === 'object' && val.content) val = val.content;
    return parseInt(val) || 3;
  }
  return 3;
}

/**
 * Obtiene la configuración del negocio (tokens, WhatsApp de ventas, etc.)
 * @param {string} businessId 
 */
function getBusinessConfig(businessId = 'balmoral') {
  if (!businessConfigs[businessId]) {
    // Intentar inicializar con datos por defecto
    businessConfigs[businessId] = {
      businessId,
      name: businessId === 'balmoral' ? 'Restaurante Balmoral' : 'Negocio',
      ultramsgInstance: businessId === 'balmoral' ? process.env.ULTRAMSG_INSTANCE_ID : '',
      ultramsgToken: businessId === 'balmoral' ? process.env.ULTRAMSG_TOKEN : '',
      salesPhone: businessId === 'balmoral' ? (process.env.SALES_WHATSAPP || '5492233041076') : '',
      notificationEmail: businessId === 'balmoral' ? (process.env.EMAIL_USER || 'martindarioschupp@gmail.com') : ''
    };
  }
  return businessConfigs[businessId];
}

function getCustomPrompt(businessId) {
  const rawKb = rawKnowledgeBases[businessId] || {};
  const eventos = rawKb.eventos || {};
  return eventos.customPrompt || '';
}

module.exports = {
  loadKnowledgeBase,
  getRelevantContext,
  getMediaForTopic,
  getPersonalityLevel,
  getBusinessConfig,
  getCustomPrompt
};
