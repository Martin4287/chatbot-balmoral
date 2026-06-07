const express = require('express');
const router = express.Router();
const { db } = require('../utils/firebase');
const { loadKnowledgeBase } = require('../utils/knowledgeBase');

// GET /api/knowledge - Obtiene toda la base de conocimiento desde Firebase
router.get('/knowledge', async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: 'Firebase no está configurado.' });
    
    const snapshot = await db.collection('balmoral_knowledge').get();
    const data = {};
    snapshot.forEach(doc => {
      data[doc.id] = doc.data();
    });
    
    res.json(data);
  } catch (error) {
    console.error('Error obteniendo knowledge:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/knowledge/:topic - Actualiza un documento específico
router.post('/knowledge/:topic', async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: 'Firebase no está configurado.' });
    
    const { topic } = req.params;
    const data = req.body;
    
    await db.collection('balmoral_knowledge').doc(topic).set(data);
    
    // Forzar la recarga de la base de conocimiento en memoria del servidor
    await loadKnowledgeBase();
    
    res.json({ success: true, message: `Documento ${topic} actualizado con éxito.` });
  } catch (error) {
    console.error(`Error actualizando ${req.params.topic}:`, error);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
