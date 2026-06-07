require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { saveDocument } = require('./src/utils/firebase');

async function populate() {
  try {
    const knowledgeDir = path.join(__dirname, 'knowledge');
    const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const docId = file.replace('.json', '');
      let data = JSON.parse(fs.readFileSync(path.join(knowledgeDir, file), 'utf8'));
      
      // Firestore only accepts objects, not arrays
      if (Array.isArray(data)) {
        data = { items: data };
      }
      
      await saveDocument('balmoral_knowledge', docId, data);
      console.log(`✅ Subido ${docId} a Firebase.`);
    }
    console.log('🎉 Migración completada exitosamente.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error migrando datos:', error);
    process.exit(1);
  }
}

populate();
