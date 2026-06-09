const express = require('express');
const router = express.Router();
const { 
  isFirebaseConfigured, 
  getAllDocuments, 
  saveDocument, 
  validateBusinessCredentials, 
  uploadImageToStorage 
} = require('../utils/firebase');
const { loadKnowledgeBase } = require('../utils/knowledgeBase');
const { generateToken, verifyToken } = require('../utils/auth');
const { parseMenuFromDocument } = require('../services/aiService');

/**
 * Middleware para validar el token de sesión Bearer
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado. Token no proporcionado.' });
  }
  
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'No autorizado. Token inválido o expirado.' });
  }
  
  req.businessId = decoded.businessId;
  next();
}

// 1. Endpoint de Login
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
  }
  
  try {
    // Si no está configurado Firebase, dar acceso de fallback local para balmoral
    if (!isFirebaseConfigured()) {
      const defaultUser = process.env.ADMIN_USER || 'admin';
      const defaultPass = process.env.ADMIN_PASS || 'Balmoral2026';
      
      if (username.trim().toLowerCase() === defaultUser.toLowerCase() && password === defaultPass) {
        const token = generateToken('balmoral');
        return res.json({
          success: true,
          token,
          businessId: 'balmoral',
          name: 'Restaurante Balmoral (Local Fallback)'
        });
      }
      return res.status(401).json({ error: 'Credenciales inválidas (Modo Fallback).' });
    }
    
    // Validar credenciales en Firestore
    const businessData = await validateBusinessCredentials(username, password);
    if (!businessData) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    
    const token = generateToken(businessData.businessId);
    res.json({
      success: true,
      token,
      businessId: businessData.businessId,
      name: businessData.name
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno de autenticación' });
  }
});

// 2. Validar sesión
router.get('/auth/session', requireAuth, async (req, res) => {
  res.json({ success: true, businessId: req.businessId });
});

// 3. Obtener conocimiento del negocio
router.get('/knowledge', requireAuth, async (req, res) => {
  try {
    if (!isFirebaseConfigured()) {
      // Fallback local
      const kb = await loadKnowledgeBase(req.businessId);
      // Formatear local para que tenga la misma estructura
      const formatted = {};
      for (const [k, v] of Object.entries(kb)) {
        formatted[k] = { content: v };
      }
      return res.json(formatted);
    }
    
    const data = await getAllDocuments(`businesses/${req.businessId}/knowledge`);
    res.json(data);
  } catch (error) {
    console.error(`Error obteniendo knowledge para ${req.businessId}:`, error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// 4. Guardar conocimiento del negocio
router.post('/knowledge/:topic', requireAuth, async (req, res) => {
  try {
    if (!isFirebaseConfigured()) {
      return res.status(500).json({ error: 'Firebase no está configurado.' });
    }
    
    const { topic } = req.params;
    const data = req.body;
    
    await saveDocument(`businesses/${req.businessId}/knowledge`, topic, data);
    await loadKnowledgeBase(req.businessId);
    
    res.json({ success: true, message: `Documento ${topic} actualizado con éxito.` });
  } catch (error) {
    console.error(`Error actualizando ${req.params.topic} para ${req.businessId}:`, error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// 5. Cargar imagen a Firebase Storage
router.post('/upload', requireAuth, async (req, res) => {
  const { fileName, mimeType, base64Data } = req.body;
  if (!fileName || !mimeType || !base64Data) {
    return res.status(400).json({ error: 'Datos de archivo inválidos.' });
  }
  
  try {
    const publicUrl = await uploadImageToStorage(req.businessId, fileName, mimeType, base64Data);
    res.json({ success: true, url: publicUrl });
  } catch (error) {
    console.error(`Error cargando archivo para ${req.businessId}:`, error);
    res.status(500).json({ error: 'No se pudo subir la imagen en Storage. Asegúrese de tener habilitado Firebase Storage.' });
  }
});

// 6. Parsear menú con Gemini (Multimodal)
router.post('/menu/parse', requireAuth, async (req, res) => {
  const { fileBase64, mimeType } = req.body;
  if (!fileBase64 || !mimeType) {
    return res.status(400).json({ error: 'Datos de archivo inválidos.' });
  }
  
  try {
    const parsedData = await parseMenuFromDocument(fileBase64, mimeType);
    res.json(parsedData);
  } catch (error) {
    console.error(`Error al parsear menú para ${req.businessId}:`, error);
    res.status(500).json({ error: 'No se pudo analizar la carta. Intente con otra imagen o PDF.' });
  }
});

module.exports = router;
