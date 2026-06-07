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
          credential: admin.credential.cert(serviceAccount)
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

function isFirebaseConfigured() {
  return db !== null;
}

module.exports = {
  getDocument,
  saveDocument,
  getAllDocuments,
  isFirebaseConfigured
};
