const admin = require('firebase-admin');

// Inicializar Firebase solo si la variable de entorno está presente
let db = null;

function initializeFirebase() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
      );
      
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.firebasestorage.app`
        });
      }
      db = admin.firestore();
      console.log('✅ Firebase conectado correctamente.');
    } catch (error) {
      console.error('❌ Error al inicializar Firebase:', error.message);
    }
  } else {
    console.log('⚠️ Firebase no configurado aún. Faltan credenciales en el .env');
  }
}

// Inicializar al importar
initializeFirebase();

async function getDocument(collection, docId) {
  if (!db) throw new Error('Firebase no está configurado');
  const doc = await db.collection(collection).doc(docId).get();
  return doc.exists ? doc.data() : null;
}

async function saveDocument(collection, docId, data) {
  if (!db) throw new Error('Firebase no está configurado');
  await db.collection(collection).doc(docId).set(data);
  return true;
}

async function getAllDocuments(collection) {
  if (!db) throw new Error('Firebase no está configurado');
  const snapshot = await db.collection(collection).get();
  const data = {};
  snapshot.forEach(doc => {
    data[doc.id] = doc.data();
  });
  return data;
}

/**
 * Valida las credenciales de un negocio en Firestore
 * @param {string} username 
 * @param {string} password 
 * @returns {Object|null} Retorna los datos del negocio si son válidos, o null
 */
async function validateBusinessCredentials(username, password) {
  if (!db) throw new Error('Firebase no está configurado');
  try {
    const snapshot = await db.collection('businesses')
      .where('username', '==', username.trim().toLowerCase())
      .limit(1)
      .get();
      
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    if (data.password === password) {
      return {
        businessId: doc.id,
        name: data.name || 'Negocio',
        ultramsgToken: data.ultramsgToken || '',
        ultramsgInstance: data.ultramsgInstance || '',
        salesPhone: data.salesPhone || '',
        notificationEmail: data.notificationEmail || '',
        geminiApiKey: data.geminiApiKey || ''
      };
    }
    return null;
  } catch (error) {
    console.error('❌ Error validando credenciales de negocio:', error.message);
    return null;
  }
}

/**
 * Sube una imagen en base64 a Firebase Storage de forma pública
 * @param {string} businessId 
 * @param {string} fileName 
 * @param {string} mimeType 
 * @param {string} base64Data 
 * @returns {string} URL de descarga pública
 */
async function uploadImageToStorage(businessId, fileName, mimeType, base64Data) {
  if (!db) throw new Error('Firebase no está configurado');
  try {
    const bucket = admin.storage().bucket();
    const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `images/${businessId}/${cleanFileName}`;
    const file = bucket.file(filePath);
    
    const buffer = Buffer.from(base64Data, 'base64');
    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000'
      },
      public: true
    });
    
    // Retornar URL pública directa
    return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
  } catch (error) {
    console.error('❌ Error subiendo imagen a Storage:', error.message);
    throw error;
  }
}

/**
 * Registra un nuevo negocio e inicializa su base de conocimiento por defecto
 * @param {string} businessId 
 * @param {Object} configData 
 */
async function registerNewBusiness(businessId, configData) {
  if (!db) throw new Error('Firebase no está configurado');
  
  // 1. Verificar si el businessId ya existe
  const docRef = db.collection('businesses').doc(businessId);
  const doc = await docRef.get();
  if (doc.exists) {
    throw new Error('El nombre de este negocio ya está registrado.');
  }
  
  // 2. Verificar si el username ya está en uso
  const usernameQuery = await db.collection('businesses')
    .where('username', '==', configData.username.trim().toLowerCase())
    .limit(1)
    .get();
    
  if (!usernameQuery.empty) {
    throw new Error('El nombre de usuario ya está en uso.');
  }
  
  // 3. Guardar configuración del negocio
  await docRef.set({
    name: configData.name,
    username: configData.username.trim().toLowerCase(),
    password: configData.password,
    ultramsgInstance: configData.ultramsgInstance || '',
    ultramsgToken: configData.ultramsgToken || '',
    salesPhone: configData.salesPhone || '',
    notificationEmail: configData.notificationEmail || '',
    geminiApiKey: ''
  });
  
  // 4. Inicializar subcolección 'knowledge' con datos estándar de base
  const kbRef = docRef.collection('knowledge');
  
  // restaurant-info
  await kbRef.doc('restaurant-info').set({
    nombre: configData.name,
    direccion: '',
    direccion_maps: '',
    wifi: '',
    contacto: configData.salesPhone || ''
  });
  
  // personalidad
  await kbRef.doc('personalidad').set({
    level: 3
  });
  
  // horarios por defecto para toda la semana
  const defaultHorarios = { dias: {} };
  const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  dias.forEach(d => {
    defaultHorarios.dias[d] = {
      abierto: true,
      almuerzo: { de: '12:00', a: '15:00' },
      cena: { de: '20:00', a: '23:30' }
    };
  });
  await kbRef.doc('horarios').set(defaultHorarios);
  
  // menu en blanco
  await kbRef.doc('menu').set({
    items: []
  });
  
  // faq estándar
  await kbRef.doc('faq').set({
    items: [
      { 
        pregunta: '¿Cómo hago una reserva?', 
        respuesta: 'Puede indicarme su nombre, cantidad de personas, fecha y hora y con gusto tomaré nota de su reserva para derivarla al equipo, quienes le confirmarán a la brevedad.' 
      }
    ]
  });
  
  // media vacío
  await kbRef.doc('media').set({
    carta_pdf: { url: '', keywords: ['menu', 'carta', 'platos'] },
    fotos: {
      salon: { url: '', keywords: ['salon', 'lugar', 'fotos'] },
      fachada: { url: '', keywords: ['entrada', 'fachada', 'frente'] }
    }
  });
  
  return true;
}

function isFirebaseConfigured() {
  return db !== null;
}

module.exports = {
  getDocument,
  saveDocument,
  getAllDocuments,
  isFirebaseConfigured,
  validateBusinessCredentials,
  uploadImageToStorage,
  registerNewBusiness
};

