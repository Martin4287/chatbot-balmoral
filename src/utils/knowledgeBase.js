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
        const faqItems = value.items || [];
        knowledgeBase[key] = faqItems.map(item => `P: ${item.pregunta}\nR: ${item.respuesta}`).join('\n\n');
      } else {
        knowledgeBase[key] = JSON.stringify(value, null, 2);
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
        knowledgeBase[key] = jsonData.map(item => `P: ${item.pregunta}\nR: ${item.respuesta}`).join('\n\n');
      } else {
        knowledgeBase[key] = JSON.stringify(jsonData, null, 2);
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
  
  if (q.includes('menu') || q.includes('menú') || q.includes('carta') || q.includes('precio') || q.includes('plato')) {
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

module.exports = {
  loadKnowledgeBase,
  getRelevantContext
};
