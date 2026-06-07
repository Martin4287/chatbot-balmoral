const express = require('express');
const router = express.Router();
const { isFirebaseConfigured, getAllDocuments, saveDocument } = require('../utils/firebase');
const { loadKnowledgeBase } = require('../utils/knowledgeBase');

router.get('/knowledge', async (req, res) => {
  try {
    if (!isFirebaseConfigured()) return res.status(500).json({ error: 'Firebase no está configurado.' });
    
    const data = await getAllDocuments('balmoral_knowledge');
    res.json(data);
  } catch (error) {
    console.error('Error obteniendo knowledge:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/knowledge/:topic', async (req, res) => {
  try {
    if (!isFirebaseConfigured()) return res.status(500).json({ error: 'Firebase no está configurado.' });
    
    const { topic } = req.params;
    const data = req.body;
    
    await saveDocument('balmoral_knowledge', topic, data);
    await loadKnowledgeBase();
    
    res.json({ success: true, message: `Documento ${topic} actualizado con éxito.` });
  } catch (error) {
    console.error(`Error actualizando ${req.params.topic}:`, error);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
