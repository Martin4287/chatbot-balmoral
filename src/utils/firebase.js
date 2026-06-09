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
          storageBucket: `${serviceAccount.project_id}.appspot.com`
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

function isFirebaseConfigured() {
  return db !== null;
}

module.exports = {
  getDocument,
  saveDocument,
  getAllDocuments,
  isFirebaseConfigured,
  validateBusinessCredentials,
  uploadImageToStorage
};

