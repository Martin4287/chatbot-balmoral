# 🍽️ Chatbot WhatsApp — Restaurante Balmoral
## Hotel Dos Reyes, Mar del Plata

Chatbot inteligente para WhatsApp que responde consultas de clientes del Restaurante Balmoral usando IA (Google Gemini) y UltraMSG como gateway de WhatsApp.

---

## 🚀 Guía Rápida de Instalación

### Paso 1: Prerrequisitos
- [Node.js](https://nodejs.org/) v18 o superior
- Cuenta en [UltraMSG](https://ultramsg.com) (con Instance ID y Token)
- API Key de [Google AI Studio](https://aistudio.google.com/apikey) (Gemini)

### Paso 2: Instalar dependencias
```bash
cd "Whatsapp balmoral"
npm install
```

### Paso 3: Configurar variables de entorno
```bash
cp .env.example .env
```
Editá el archivo `.env` con tus credenciales:
```
ULTRAMSG_INSTANCE_ID=tu_instance_id
ULTRAMSG_TOKEN=tu_token
GEMINI_API_KEY=tu_api_key
PORT=3000
```

### Paso 4: Ejecutar localmente
```bash
npm run dev
```

### Paso 5: Configurar Webhook en UltraMSG
1. Ir a [ultramsg.com](https://ultramsg.com) → Tu instancia → Settings
2. En "Webhook URL", poner: `https://TU-URL-PUBLICA/webhook`
3. Activar "Webhook on Received"
4. Activar "Webhook Download Media"
5. Guardar

---

## ☁️ Deploy Gratuito en Render

1. Subí el proyecto a GitHub
2. Ir a [render.com](https://render.com) y crear una cuenta gratuita
3. Crear un "New Web Service" → Conectar tu repositorio
4. Configurar:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variables**: Agregar las variables del `.env`
5. Render te dará una URL pública (ej: `https://chatbot-balmoral.onrender.com`)
6. Usar esa URL + `/webhook` en la configuración de UltraMSG

---

## 📚 Cómo Alimentar al Bot con Información

Toda la información del restaurante está en la carpeta `knowledge/`:

| Archivo | Contenido |
|---------|-----------|
| `restaurant-info.json` | Datos generales, contacto, servicios |
| `menu.json` | Carta del restaurante (platos y precios) |
| `faq.json` | Preguntas frecuentes y respuestas |
| `horarios.json` | Horarios por día y temporada |
| `eventos.json` | Eventos, promociones, menú de temporada |
| `media.json` | URLs de fotos y documentos para enviar |

### Para actualizar el menú:
Editá `knowledge/menu.json` y agregá los platos reales con esta estructura:
```json
{
  "nombre": "Lomo Balmoral",
  "descripcion": "Lomo de ternera con salsa del chef",
  "precio": "15500",
  "apto_celiaco": false,
  "vegetariano": false,
  "destacado": true
}
```

### Para agregar preguntas frecuentes:
Editá `knowledge/faq.json` y agregá entradas con tags:
```json
{
  "pregunta": "¿Hacen delivery?",
  "respuesta": "Actualmente no contamos con servicio de delivery...",
  "tags": ["delivery", "envio", "envío", "llevar", "domicilio"]
}
```

### Para agregar fotos/documentos:
Editá `knowledge/media.json` y poné las URLs públicas de los archivos.

---

## 📁 Estructura del Proyecto
```
├── src/
│   ├── index.js                 ← Servidor Express + webhook
│   ├── webhook/
│   │   └── messageHandler.js    ← Procesamiento de mensajes
│   ├── services/
│   │   ├── aiService.js         ← Integración con Gemini
│   │   └── whatsappService.js   ← Envío vía UltraMSG
│   ├── utils/
│   │   ├── knowledgeBase.js     ← Motor de búsqueda de conocimiento
│   │   └── logger.js            ← Logger de conversaciones
│   └── config/
│       └── prompts.js           ← Personalidad del bot
├── knowledge/                   ← Base de conocimiento (JSON)
├── logs/                        ← Logs de conversaciones
├── package.json
├── .env.example
└── render.yaml                  ← Config de deploy en Render
```

---

## 🔧 Solución de Problemas

| Problema | Solución |
|----------|----------|
| Bot no responde | Verificar que el webhook esté configurado en UltraMSG |
| Error de Gemini | Verificar API key en `.env` |
| Mensajes en loop | Verificar que se ignoran mensajes propios (fromMe) |
| Media no se envía | Verificar que las URLs sean públicas y accesibles |
