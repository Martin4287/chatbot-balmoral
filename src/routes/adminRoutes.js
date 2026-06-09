const express = require('express');
const router = express.Router();
const { 
  isFirebaseConfigured, 
  getAllDocuments, 
  saveDocument, 
  validateBusinessCredentials, 
  uploadImageToStorage,
  registerNewBusiness
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

// Endpoint de Registro de Nuevo Negocio (SaaS)
router.post('/auth/register', async (req, res) => {
  const { name, username, password, email, phone, instance, token } = req.body;
  
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Nombre del negocio, usuario y contraseña son requeridos.' });
  }
  
  try {
    if (!isFirebaseConfigured()) {
      return res.status(500).json({ error: 'Firebase no está configurado en este servidor.' });
    }
    
    // Generar un businessId único sanitizado
    const businessId = name.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
      .replace(/[^a-z0-9\s-]/g, '')                    // Quitar caracteres especiales
      .replace(/\s+/g, '-')                            // Espacios a guiones
      .replace(/-+/g, '-');                            // Colapsar guiones dobles
      
    if (!businessId) {
      return res.status(400).json({ error: 'El nombre del negocio no es válido.' });
    }
    
    // Configuración inicial del negocio
    const configData = {
      name: name.trim(),
      username: username.trim().toLowerCase(),
      password,
      ultramsgInstance: instance ? instance.trim() : '',
      ultramsgToken: token ? token.trim() : '',
      salesPhone: phone ? phone.trim() : '',
      notificationEmail: email ? email.trim() : ''
    };
    
    // Registrar e inicializar base
    await registerNewBusiness(businessId, configData);
    
    // Pre-cargar en caché la memoria del bot para este nuevo negocio
    await loadKnowledgeBase(businessId);
    
    // Generar token de sesión para ingresarlo de inmediato
    const sessionToken = generateToken(businessId);
    
    res.json({
      success: true,
      token: sessionToken,
      businessId,
      name: configData.name
    });
  } catch (error) {
    console.error('Error registrando nuevo negocio:', error.message);
    res.status(400).json({ error: error.message || 'Error interno de registro.' });
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

// 5. Cargar imagen a Firebase Storage (con fallback a local si no está activado en Firebase Console)
router.post('/upload', requireAuth, async (req, res) => {
  const { fileName, mimeType, base64Data } = req.body;
  if (!fileName || !mimeType || !base64Data) {
    return res.status(400).json({ error: 'Datos de archivo inválidos.' });
  }
  
  try {
    const publicUrl = await uploadImageToStorage(req.businessId, fileName, mimeType, base64Data);
    res.json({ success: true, url: publicUrl });
  } catch (error) {
    console.warn(`⚠️ Falló la subida a Firebase Storage para ${req.businessId}. Usando fallback local. Motivo:`, error.message);
    try {
      const fs = require('fs');
      const path = require('path');
      const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const localFilePath = path.join(uploadsDir, cleanFileName);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(localFilePath, buffer);
      
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const publicUrl = `${protocol}://${host}/uploads/${cleanFileName}`;
      
      console.log(`✅ Archivo guardado localmente en fallback: ${publicUrl}`);
      res.json({ success: true, url: publicUrl });
    } catch (localError) {
      console.error(`❌ Falló también la subida local:`, localError.message);
      res.status(500).json({ error: 'No se pudo subir la imagen. Asegúrese de tener habilitado Firebase Storage o almacenamiento en el servidor.' });
    }
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
