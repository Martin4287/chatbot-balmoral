const fs = require('fs');
const path = require('path');
const { getAllDocuments, isFirebaseConfigured } = require('./firebase');

let knowledgeBase = {};
let lastUpdated = null;

async function loadKnowledgeBase() {
  try {
    if (!isFirebaseConfigured()) {
      console.warn('⚠️ Firebase no conectado. Se usará la base local.');
      return loadKnowledgeBaseLocalFallback();
    }

    console.log('📚 Cargando base de conocimiento desde Firebase...');
    const data = await getAllDocuments('balmoral_knowledge');
    
    for (const [key, value] of Object.entries(data)) {
      if (key === 'faq') {
        if (value.content !== undefined) {
          knowledgeBase[key] = value.content;
        } else {
          const faqItems = value.items || [];
          knowledgeBase[key] = faqItems.map(item => `P: ${item.pregunta}\nR: ${item.respuesta}`).join('\n\n');
        }
      } else {
        if (value.content !== undefined) {
          knowledgeBase[key] = value.content;
        } else {
          knowledgeBase[key] = JSON.stringify(value, null, 2);
        }
      }
    }
    
    lastUpdated = new Date();
    console.log('✅ Base de conocimiento sincronizada con Firebase');
    return knowledgeBase;
  } catch (error) {
    console.error('❌ Error leyendo conocimiento de Firebase:', error);
    return loadKnowledgeBaseLocalFallback();
  }
}

function loadKnowledgeBaseLocalFallback() {
  try {
    const knowledgeDir = path.join(__dirname, '..', '..', 'knowledge');
    const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const key = file.replace('.json', '');
      const rawData = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
      const jsonData = JSON.parse(rawData);
      
      if (key === 'faq') {
        if (jsonData.content !== undefined) {
          knowledgeBase[key] = jsonData.content;
        } else if (Array.isArray(jsonData)) {
          knowledgeBase[key] = jsonData.map(item => `P: ${item.pregunta}\nR: ${item.respuesta}`).join('\n\n');
        } else {
          knowledgeBase[key] = JSON.stringify(jsonData, null, 2);
        }
      } else {
        if (jsonData.content !== undefined) {
          knowledgeBase[key] = jsonData.content;
        } else {
          knowledgeBase[key] = JSON.stringify(jsonData, null, 2);
        }
      }
    }
    console.log('✅ Base de conocimiento local cargada (Fallback)');
    return knowledgeBase;
  } catch (err) {
    console.error('Error cargando knowledgeBase local:', err);
    return {};
  }
}

function getRelevantContext(query) {
  const q = query.toLowerCase();
  let relevantInfo = [];

  // Siempre incluimos la info básica del restaurante
  if (knowledgeBase.restaurant) relevantInfo.push(knowledgeBase.restaurant);
  
  const menuKeywords = ['menu', 'menú', 'carta', 'precio', 'plato', 'cuanto', 'cuánto', 'sale', 'cuesta', 'bife', 'vino', 'carne', 'pasta', 'pescado', 'pollo', 'bebida', 'postre', 'cafe', 'café', 'comer', 'cenar', 'almorzar', 'desayunar'];
  if (menuKeywords.some(kw => q.includes(kw))) {
    if (knowledgeBase.menu) relevantInfo.push('CARTA Y MENÚ:\n' + knowledgeBase.menu);
  }
  
  if (q.includes('hora') || q.includes('abren') || q.includes('cierran')) {
    if (knowledgeBase.horarios) relevantInfo.push('HORARIOS:\n' + knowledgeBase.horarios);
  }
  
  if (q.includes('evento') || q.includes('musica') || q.includes('show')) {
    if (knowledgeBase.eventos) relevantInfo.push('EVENTOS:\n' + knowledgeBase.eventos);
  }

  if (knowledgeBase.faq) relevantInfo.push('PREGUNTAS FRECUENTES RELEVANTES:\n' + knowledgeBase.faq);

  return relevantInfo.join('\n\n---\n\n');
}

function getMediaForTopic(query) {
  const q = query.toLowerCase();
  
  if (!knowledgeBase.media) return null;
  
  try {
    let mediaData;
    // knowledgeBase.media podria ser un string JSON o un objeto dependiendo de como se guardó
    if (typeof knowledgeBase.media === 'string') {
      mediaData = JSON.parse(knowledgeBase.media);
    } else {
      mediaData = knowledgeBase.media;
    }

    // Verificar PDF de la carta
    if (mediaData.carta_pdf && mediaData.carta_pdf.url && mediaData.carta_pdf.keywords) {
      if (mediaData.carta_pdf.keywords.some(kw => q.includes(kw))) {
        return {
          type: 'document',
          url: mediaData.carta_pdf.url,
          filename: mediaData.carta_pdf.filename || 'Carta_Balmoral.pdf',
          caption: mediaData.carta_pdf.caption || 'Aquí tiene nuestra carta'
        };
      }
    }
    
    // Verificar documentos
    if (mediaData.documentos) {
      for (const [key, doc] of Object.entries(mediaData.documentos)) {
        if (doc.url && doc.keywords && doc.keywords.some(kw => q.includes(kw))) {
          return {
            type: 'document',
            url: doc.url,
            filename: doc.filename || 'Documento.pdf',
            caption: doc.caption || ''
          };
        }
      }
    }

    // Verificar fotos
    if (mediaData.fotos) {
      for (const [key, foto] of Object.entries(mediaData.fotos)) {
        if (foto.url && foto.keywords && foto.keywords.some(kw => q.includes(kw))) {
          return {
            type: 'image',
            url: foto.url,
            caption: foto.caption || ''
          };
        }
      }
    }
  } catch (err) {
    console.error('Error parseando mediaData:', err);
  }
  
  return null;
}
function getPersonalityLevel() {
  if (knowledgeBase.personalidad !== undefined) {
    return knowledgeBase.personalidad;
  }
  return 3;
}

module.exports = {
  loadKnowledgeBase,
  getRelevantContext,
  getMediaForTopic,
  getPersonalityLevel
};
