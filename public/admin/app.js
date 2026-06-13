// ============================================
// Lógica del Panel de Administración - Cerebro AI
// ============================================

// Verificar sesión al iniciar
const token = localStorage.getItem('admin_token');
const businessId = localStorage.getItem('business_id');
const businessName = localStorage.getItem('business_name');

if (!token || !businessId) {
  window.location.href = '/';
}

// Mostrar datos del usuario
document.getElementById('user-display').textContent = businessName || 'Administrador';
document.getElementById('sidebar-business-name').textContent = businessName || 'RISTapp';

// Cierre de Sesión
document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('business_id');
  localStorage.removeItem('business_name');
  window.location.href = '/';
});

// Elementos del DOM
const navMenu = document.getElementById('nav-menu');
const welcomeState = document.getElementById('welcome-message');
const btnSave = document.getElementById('btn-save');
const currentTitle = document.getElementById('current-title');
const toast = document.getElementById('toast');

// Estado interno
let knowledgeData = {};
let currentTopic = null;
let activeFormElements = {}; // Almacena copias de edición

// Mapeos visuales de Tópicos
const topicConfigs = {
  'restaurant-info': { label: 'Info del Negocio', icon: 'business-outline', sectionId: 'section-restaurant' },
  'menu': { label: 'Carta y Menú', icon: 'restaurant-outline', sectionId: 'section-menu' },
  'horarios': { label: 'Horarios de Atención', icon: 'time-outline', sectionId: 'section-horarios' },
  'faq': { label: 'Preguntas Frecuentes', icon: 'help-circle-outline', sectionId: 'section-faq' },
  'media': { label: 'Fotos y PDF', icon: 'images-outline', sectionId: 'section-media' },
  'eventos': { label: 'Ajustes y Conexión', icon: 'settings-outline', sectionId: 'section-eventos' },
  'personalidad': { label: 'Personalidad del Bot', icon: 'happy-outline', sectionId: 'slider-state' }
};

// ============================================
// Peticiones al Servidor
// ============================================

async function fetchKnowledge() {
  try {
    const res = await fetch('/api/knowledge', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.status === 401) {
      // Token vencido
      localStorage.removeItem('admin_token');
      window.location.href = '/';
      return;
    }

    if (!res.ok) throw new Error('Error al cargar datos');
    
    const dbData = await res.json();
    
    // Asegurar estructura
    knowledgeData = dbData;
    if (!knowledgeData.personalidad) knowledgeData.personalidad = { level: 3 };
    if (!knowledgeData.menu) knowledgeData.menu = { items: [] };
    if (!knowledgeData.faq) knowledgeData.faq = { items: [] };
    if (!knowledgeData.media) knowledgeData.media = { carta_pdf: { url: '' }, fotos: {} };
    if (!knowledgeData.horarios) knowledgeData.horarios = { dias: {} };
    if (!knowledgeData.eventos) knowledgeData.eventos = { content: '' }; // eventos es Ajustes/Conexión

    renderSidebarMenu();
  } catch (err) {
    console.error(err);
    navMenu.innerHTML = '<div style="color:var(--danger); padding:1rem">Error de conexión con el servidor.</div>';
  }
}

function renderSidebarMenu() {
  navMenu.innerHTML = '';
  
  // Ordenamos los tópicos para mostrar
  const sortedTopics = ['restaurant-info', 'menu', 'horarios', 'faq', 'media', 'eventos', 'personalidad'];
  
  sortedTopics.forEach(topic => {
    const config = topicConfigs[topic];
    if (!config) return;

    const div = document.createElement('div');
    div.className = 'nav-item';
    div.innerHTML = `
      <ion-icon name="${config.icon}"></ion-icon>
      <span>${config.label}</span>
    `;
    
    div.addEventListener('click', () => selectTopic(topic, div));
    navMenu.appendChild(div);
  });
}

// ============================================
// Selección de Tópico y Renderizado de Formulario
// ============================================

function selectTopic(topic, element) {
  // Manejar clases activas del menú
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  element.classList.add('active');

  currentTopic = topic;
  currentTitle.textContent = topicConfigs[topic].label;
  
  // Ocultar bienvenida y todas las secciones de formularios
  welcomeState.classList.add('hidden');
  document.querySelectorAll('.form-section').forEach(el => el.classList.add('hidden'));
  document.getElementById('slider-state').classList.add('hidden');

  // Habilitar botón guardar
  btnSave.disabled = false;

  // Obtener datos del tópico
  const data = knowledgeData[topic] || {};
  
  // Renderizar la sección específica
  const sectionId = topicConfigs[topic].sectionId;
  const sectionEl = document.getElementById(sectionId);
  sectionEl.classList.remove('hidden');

  switch (topic) {
    case 'restaurant-info':
      renderRestaurantInfoForm(data);
      break;
    case 'menu':
      renderMenuForm(data);
      break;
    case 'horarios':
      renderHorariosForm(data);
      break;
    case 'faq':
      renderFaqForm(data);
      break;
    case 'media':
      renderMediaForm(data);
      break;
    case 'eventos':
      renderEventosConfigForm(data);
      break;
    case 'personalidad':
      renderPersonalidadForm(data);
      break;
  }
}

// 1. Info del Restaurante
function renderRestaurantInfoForm(data) {
  // Los datos en Firebase pueden estar como string o como objeto
  let info = data;
  if (data.content && typeof data.content === 'string') {
    try {
      info = JSON.parse(data.content);
    } catch (e) {
      // Si es un texto plano largo, lo dividimos como fallback
      info = { nombre: businessName, direccion: data.content };
    }
  }

  document.getElementById('info-nombre').value = info.nombre || '';
  document.getElementById('info-direccion').value = info.direccion || '';
  document.getElementById('info-maps').value = info.direccion_maps || '';
  document.getElementById('info-wifi').value = info.wifi || '';
  document.getElementById('info-contacto').value = info.contacto || '';
}

// 2. Menú / Carta
let menuItems = [];
let activeCategory = 'Todos';

function renderMenuForm(data) {
  menuItems = data.items || [];
  
  // Generar las pestañas de categorías
  const categories = ['Todos', ...new Set(menuItems.map(item => item.categoria).filter(Boolean))];
  const tabsContainer = document.getElementById('category-tabs');
  tabsContainer.innerHTML = '';
  
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${activeCategory === cat ? 'active' : ''}`;
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      activeCategory = cat;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMenuList();
    });
    tabsContainer.appendChild(btn);
  });

  renderMenuList();
}

function renderMenuList() {
  const container = document.getElementById('menu-items-list');
  container.innerHTML = '';

  const filteredItems = activeCategory === 'Todos' 
    ? menuItems 
    : menuItems.filter(item => item.categoria === activeCategory);

  if (filteredItems.length === 0) {
    container.innerHTML = '<div class="no-items">No hay platos en esta categoría.</div>';
    return;
  }

  filteredItems.forEach((item, index) => {
    // Buscar el índice real del plato en la lista completa
    const realIndex = menuItems.indexOf(item);
    
    const card = document.createElement('div');
    card.className = 'menu-item-card';
    card.innerHTML = `
      <div class="menu-item-photo-wrapper">
        <img src="${item.imagen_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=120'}" class="menu-item-thumb" id="img-preview-${realIndex}">
        <input type="file" id="file-${realIndex}" class="hidden" accept="image/jpeg, image/png" onchange="uploadDishPhoto(${realIndex})">
        <button class="btn btn-secondary btn-upload-thumb" onclick="document.getElementById('file-${realIndex}').click()">
          <ion-icon name="camera-outline"></ion-icon> Subir
        </button>
      </div>
      <div class="menu-item-details-grid">
        <div class="form-group-compact">
          <label>Nombre del plato</label>
          <input type="text" value="${item.nombre || ''}" class="form-control-input" oninput="updateMenuItem(${realIndex}, 'nombre', this.value)">
        </div>
        <div class="form-group-compact">
          <label>Precio</label>
          <input type="text" value="${item.precio || ''}" class="form-control-input" oninput="updateMenuItem(${realIndex}, 'precio', this.value)">
        </div>
        <div class="form-group-compact">
          <label>Categoría</label>
          <input type="text" value="${item.categoria || ''}" class="form-control-input" oninput="updateMenuItem(${realIndex}, 'categoria', this.value)">
        </div>
        <div class="form-group-compact">
          <label>Enlace de Imagen (Automático)</label>
          <input type="text" id="url-img-${realIndex}" value="${item.imagen_url || ''}" class="form-control-input" oninput="updateMenuItem(${realIndex}, 'imagen_url', this.value); document.getElementById('img-preview-${realIndex}').src = this.value;">
        </div>
        <div class="form-group-compact" style="grid-column: span 2;">
          <label>Descripción / Ingredientes</label>
          <input type="text" value="${item.descripcion || ''}" class="form-control-input" oninput="updateMenuItem(${realIndex}, 'descripcion', this.value)">
        </div>
      </div>
      <button class="btn-delete-card" onclick="deleteMenuItem(${realIndex})" title="Eliminar plato">
        <ion-icon name="trash-outline"></ion-icon>
      </button>
    `;
    container.appendChild(card);
  });
}

// 3. Horarios
const diasSemana = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
let horariosData = {};

function renderHorariosForm(data) {
  horariosData = data.dias || {};
  
  const container = document.getElementById('horarios-table');
  container.innerHTML = `
    <div class="horario-header-row">
      <span>Día</span>
      <span>Abierto</span>
      <span>Turno Almuerzo</span>
      <span>Turno Cena</span>
      <span>Acción</span>
    </div>
  `;

  diasSemana.forEach(dia => {
    // Inicializar día si no existe
    if (!horariosData[dia]) {
      horariosData[dia] = { abierto: true, almuerzo: { de: '12:30', a: '16:00' }, cena: { de: '20:30', a: '00:00' } };
    }
    
    const h = horariosData[dia];
    const row = document.createElement('div');
    row.className = 'horario-row';
    row.innerHTML = `
      <span class="day-label">${dia.toUpperCase()}</span>
      <span style="display:flex; justify-content:center;">
        <input type="checkbox" class="horario-checkbox" ${h.abierto ? 'checked' : ''} id="check-${dia}" onchange="toggleHorarioDia('${dia}', this.checked)">
      </span>
      <div class="time-range-inputs">
        <input type="time" class="time-input" value="${h.almuerzo?.de || '12:30'}" id="alm-de-${dia}" onchange="updateHorarioTime('${dia}', 'almuerzo', 'de', this.value)">
        <span>a</span>
        <input type="time" class="time-input" value="${h.almuerzo?.a || '16:00'}" id="alm-a-${dia}" onchange="updateHorarioTime('${dia}', 'almuerzo', 'a', this.value)">
      </div>
      <div class="time-range-inputs">
        <input type="time" class="time-input" value="${h.cena?.de || '20:30'}" id="cen-de-${dia}" onchange="updateHorarioTime('${dia}', 'cena', 'de', this.value)">
        <span>a</span>
        <input type="time" class="time-input" value="${h.cena?.a || '00:00'}" id="cen-a-${dia}" onchange="updateHorarioTime('${dia}', 'cena', 'a', this.value)">
      </div>
      <span>
        <button class="btn btn-secondary btn-icon-compact" title="Copiar horarios a todos los días" onclick="copyHorariosToAll('${dia}')">
          <ion-icon name="copy-outline"></ion-icon> Copiar
        </button>
      </span>
    `;
    container.appendChild(row);
  });
}

// 4. Preguntas Frecuentes
let faqItems = [];

function renderFaqForm(data) {
  faqItems = data.items || [];
  
  const container = document.getElementById('faq-list');
  container.innerHTML = '';

  if (faqItems.length === 0) {
    container.innerHTML = '<div class="no-items">No hay preguntas cargadas.</div>';
    return;
  }

  faqItems.forEach((faq, index) => {
    const div = document.createElement('div');
    div.className = 'faq-card';
    div.innerHTML = `
      <div class="faq-card-header" onclick="toggleFaqAccordion(${index})">
        <span><strong>P${index + 1}:</strong> ${faq.pregunta || '(Pregunta vacía)'}</span>
        <ion-icon name="chevron-down-outline" id="faq-chevron-${index}"></ion-icon>
      </div>
      <div class="faq-card-body collapsed" id="faq-body-${index}">
        <div class="form-group-compact">
          <label>Pregunta del Cliente</label>
          <input type="text" value="${faq.pregunta || ''}" class="form-control-input" oninput="updateFaqItem(${index}, 'pregunta', this.value)">
        </div>
        <div class="form-group-compact">
          <label>Respuesta de la IA</label>
          <textarea rows="3" class="form-control-textarea" oninput="updateFaqItem(${index}, 'respuesta', this.value)">${faq.respuesta || ''}</textarea>
        </div>
        
        <div class="faq-images-section">
          <label style="display: block; margin-bottom: 0.5rem; font-size: 0.85rem; color: #a1a1aa;">Imágenes Adjuntas (Opcional)</label>
          <div class="faq-img-list" id="faq-img-list-${index}">
            ${(faq.imagenes || []).map((url, imgIdx) => `
              <div class="faq-img-thumb">
                <img src="${url}" alt="FAQ">
                <button class="btn-remove-img" onclick="removeFaqImage(${index}, ${imgIdx})" title="Eliminar foto"><ion-icon name="close-outline"></ion-icon></button>
              </div>
            `).join('')}
            <div class="faq-img-add" onclick="document.getElementById('faq-file-${index}').click()" title="Subir nueva foto">
              <ion-icon name="add-outline"></ion-icon>
            </div>
            <input type="file" id="faq-file-${index}" style="display:none;" accept="image/*" onchange="uploadFaqPhoto(${index})">
          </div>
        </div>

        <button class="btn btn-danger btn-delete-faq" onclick="deleteFaqItem(${index})">
          <ion-icon name="trash-outline"></ion-icon> Eliminar Pregunta
        </button>
      </div>
    `;
    container.appendChild(div);
  });
}

function toggleFaqAccordion(index) {
  const body = document.getElementById(`faq-body-${index}`);
  const chev = document.getElementById(`faq-chevron-${index}`);
  body.classList.toggle('collapsed');
  
  if (body.classList.contains('collapsed')) {
    chev.setAttribute('name', 'chevron-down-outline');
  } else {
    chev.setAttribute('name', 'chevron-up-outline');
  }
}

// 5. Media
function renderMediaForm(data) {
  document.getElementById('media-carta-pdf').value = data.carta_pdf?.url || '';
  document.getElementById('media-salon').value = data.fotos?.salon?.url || '';
  document.getElementById('media-fachada').value = data.fotos?.fachada?.url || '';
}

// 6. Conexión y Ajustes (Mapeado a 'eventos' en Firestore)
function renderEventosConfigForm(data) {
  // En Firestore se guarda como JSON en eventos
  let config = {};
  if (data.content && typeof data.content === 'string') {
    try {
      config = JSON.parse(data.content);
    } catch (e) {
      config = { customPrompt: data.content };
    }
  } else {
    config = data;
  }

  document.getElementById('config-token').value = config.token || '';
  document.getElementById('config-instance').value = config.instance || '';
  document.getElementById('config-phone').value = config.phone || '';
  document.getElementById('config-email').value = config.email || '';
  document.getElementById('config-prompt').value = config.customPrompt || '';
}

// 7. Personalidad
const emotionSlider = document.getElementById('emotion-slider');
const emotionLabel = document.getElementById('emotion-label');
const emotionDesc = document.getElementById('emotion-desc');

const emotionConfigs = {
  1: { label: 'Serio / Distante (1)', desc: 'El bot será extremadamente serio, distante, cortante y puramente informativo. Cero emociones, sin emojis.' },
  2: { label: 'Formal (2)', desc: 'El bot será formal y respetuoso. Profesional, sin excesos de amabilidad ni emojis.' },
  3: { label: 'Equilibrado (3)', desc: 'El bot será amable y servicial, manteniendo la formalidad de un buen restaurante o local. Usará 1 o 2 emojis.' },
  4: { label: 'Cálido y Amigable (4)', desc: 'El bot será muy cálido, amigable y entusiasta. Usará exclamaciones y varios emojis frecuentemente.' },
  5: { label: 'Emocional Extremo (5)', desc: 'El bot será excesivamente cariñoso, eufórico y lleno de emojis. Todo será "¡Fantástico!" o "¡Excelente!".' }
};

function updateSliderUI(val) {
  const config = emotionConfigs[val];
  emotionLabel.textContent = config.label;
  emotionDesc.textContent = config.desc;
}

function renderPersonalidadForm(data) {
  let val = 3;
  if (data.level) {
    val = parseInt(data.level) || 3;
  } else if (data.content) {
    val = parseInt(data.content) || 3;
  }
  
  emotionSlider.value = val;
  updateSliderUI(val);
}

emotionSlider.addEventListener('input', (e) => {
  updateSliderUI(e.target.value);
});

// ============================================
// Funciones de Edición Auxiliares
// ============================================

// Platos
window.updateMenuItem = (index, field, value) => {
  menuItems[index][field] = value;
};

window.deleteMenuItem = (index) => {
  if (confirm('¿Seguro que querés eliminar este plato?')) {
    menuItems.splice(index, 1);
    renderMenuList();
  }
};

document.getElementById('btn-add-dish').addEventListener('click', () => {
  menuItems.push({
    nombre: 'Nuevo Plato',
    precio: '$0',
    categoria: activeCategory === 'Todos' ? 'Entradas' : activeCategory,
    descripcion: '',
    imagen_url: ''
  });
  renderMenuList();
});

// Horarios
window.toggleHorarioDia = (dia, checked) => {
  horariosData[dia].abierto = checked;
};

window.updateHorarioTime = (dia, turno, deA, value) => {
  if (!horariosData[dia][turno]) horariosData[dia][turno] = {};
  horariosData[dia][turno][deA] = value;
};

window.copyHorariosToAll = (sourceDia) => {
  const source = horariosData[sourceDia];
  diasSemana.forEach(dia => {
    if (dia !== sourceDia) {
      horariosData[dia] = JSON.parse(JSON.stringify(source));
      
      // Actualizar UI
      document.getElementById(`check-${dia}`).checked = source.abierto;
      document.getElementById(`alm-de-${dia}`).value = source.almuerzo?.de || '12:30';
      document.getElementById(`alm-a-${dia}`).value = source.almuerzo?.a || '16:00';
      document.getElementById(`cen-de-${dia}`).value = source.cena?.de || '20:30';
      document.getElementById(`cen-a-${dia}`).value = source.cena?.a || '00:00';
    }
  });
  showToast('📋 Horario copiado a todos los días');
};

// FAQs
function updateFaqItem(index, field, value) {
  faqItems[index][field] = value;
}

function removeFaqImage(faqIndex, imgIndex) {
  if (confirm('¿Seguro que quieres eliminar esta foto?')) {
    faqItems[faqIndex].imagenes.splice(imgIndex, 1);
    renderFaqForm({ items: faqItems });
    toggleFaqAccordion(faqIndex);
  }
}

function deleteFaqItem(index) {
  if (confirm('¿Seguro que querés eliminar esta pregunta?')) {
    faqItems.splice(index, 1);
    renderFaqForm({ items: faqItems });
  }
}

document.getElementById('btn-add-faq').addEventListener('click', () => {
  faqItems.push({
    pregunta: 'Pregunta Nueva',
    respuesta: 'Respuesta nueva.',
    imagenes: []
  });
  renderFaqForm({ items: faqItems });
  toggleFaqAccordion(faqItems.length - 1); // Expandir la nueva
});

// ============================================
// Carga de Archivos a Storage
// ============================================

window.triggerFileUpload = (pickerId, inputId) => {
  const fileInput = document.getElementById(pickerId);
  fileInput.value = ''; // Reset
  fileInput.addEventListener('change', async function onChange() {
    fileInput.removeEventListener('change', onChange);
    if (this.files.length === 0) return;
    
    const file = this.files[0];
    const inputField = document.getElementById(inputId);
    const originalText = inputField.placeholder;
    
    inputField.value = 'Subiendo...';
    inputField.disabled = true;
    
    try {
      const base64 = await toBase64(file);
      const cleanBase64 = base64.split(',')[1];
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          base64Data: cleanBase64
        })
      });
      
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Error subiendo archivo');
      
      inputField.value = resData.url;
      showToast('✅ Archivo subido y enlazado correctamente');
    } catch (err) {
      alert('Error al subir: ' + err.message);
      inputField.value = '';
    } finally {
      inputField.disabled = false;
    }
  });
  fileInput.click();
};

window.uploadDishPhoto = async (index) => {
  const fileInput = document.getElementById(`file-${index}`);
  if (fileInput.files.length === 0) return;
  
  const file = fileInput.files[0];
  const urlInput = document.getElementById(`url-img-${index}`);
  const previewImg = document.getElementById(`img-preview-${index}`);
  
  urlInput.value = 'Subiendo...';
  
  try {
    const base64 = await toBase64(file);
    const cleanBase64 = base64.split(',')[1];
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        base64Data: cleanBase64
      })
    });
    
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Error subiendo foto');
    
    urlInput.value = resData.url;
    previewImg.src = resData.url;
    menuItems[index].imagen_url = resData.url;
    showToast('📸 Foto del plato subida');
  } catch (err) {
    alert('Error al subir la foto: ' + err.message);
    urlInput.value = '';
  }
};

window.uploadFaqPhoto = async (index) => {
  const fileInput = document.getElementById(`faq-file-${index}`);
  if (fileInput.files.length === 0) return;
  
  const file = fileInput.files[0];
  showToast('Subiendo foto... espere', 'info');
  
  try {
    const base64 = await toBase64(file);
    const cleanBase64 = base64.split(',')[1];
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        base64Data: cleanBase64
      })
    });
    
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Error subiendo foto');
    
    if (!faqItems[index].imagenes) faqItems[index].imagenes = [];
    faqItems[index].imagenes.push(resData.url);
    
    renderFaqForm({ items: faqItems });
    toggleFaqAccordion(index);
    showToast('📸 Foto adjuntada a la pregunta');
  } catch (err) {
    alert('Error al subir la foto: ' + err.message);
  } finally {
    fileInput.value = ''; // Reset
  }
};

const toBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

// ============================================
// Importador de Carta por IA
// ============================================

const btnImportMenu = document.getElementById('btn-import-menu');
const menuPdfPicker = document.getElementById('menu-pdf-picker');
const loadingOverlay = document.getElementById('loading-overlay');

btnImportMenu.addEventListener('click', () => {
  menuPdfPicker.value = '';
  menuPdfPicker.click();
});

menuPdfPicker.addEventListener('change', async (e) => {
  if (e.target.files.length === 0) return;
  
  const file = e.target.files[0];
  loadingOverlay.classList.remove('hidden');
  
  try {
    const base64 = await toBase64(file);
    const cleanBase64 = base64.split(',')[1];
    
    const res = await fetch('/api/menu/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        fileBase64: cleanBase64,
        mimeType: file.type
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error analizando menú.');
    
    if (data.items && Array.isArray(data.items)) {
      // Unir los platos detectados al menú actual
      menuItems = [...menuItems, ...data.items];
      renderMenuForm({ items: menuItems });
      showToast(`✨ Se importaron ${data.items.length} platos con éxito.`);
    } else {
      throw new Error('Formato devuelto incorrecto.');
    }
  } catch (err) {
    alert('No se pudo analizar el archivo. Asegúrese de que sea una imagen nítida o un PDF válido. ' + err.message);
  } finally {
    loadingOverlay.classList.add('hidden');
  }
});

// ============================================
// Guardar Cambios en Firebase
// ============================================

btnSave.addEventListener('click', async () => {
  if (!currentTopic) return;
  
  try {
    let payload = {};
    
    switch (currentTopic) {
      case 'restaurant-info':
        payload = {
          nombre: document.getElementById('info-nombre').value.trim(),
          direccion: document.getElementById('info-direccion').value.trim(),
          direccion_maps: document.getElementById('info-maps').value.trim(),
          wifi: document.getElementById('info-wifi').value.trim(),
          contacto: document.getElementById('info-contacto').value.trim()
        };
        break;
      case 'menu':
        payload = { items: menuItems };
        break;
      case 'horarios':
        payload = { dias: horariosData };
        break;
      case 'faq':
        payload = { items: faqItems };
        break;
      case 'media':
        payload = {
          carta_pdf: {
            url: document.getElementById('media-carta-pdf').value.trim(),
            filename: 'Carta.pdf',
            caption: 'Aquí tiene nuestra carta de platos 📋',
            keywords: ['menu', 'menú', 'carta', 'platos', 'precios', 'comer', 'bebidas']
          },
          fotos: {
            salon: {
              url: document.getElementById('media-salon').value.trim(),
              caption: 'Salón del Restaurante ✨',
              keywords: ['foto salon', 'foto salón', 'salon', 'salón', 'fotos del lugar', 'fotos del restaurante', 'imagenes del salon']
            },
            fachada: {
              url: document.getElementById('media-fachada').value.trim(),
              caption: 'Entrada del Restaurante 🍽️',
              keywords: ['fachada', 'frente', 'entrada', 'exterior', 'afuera']
            }
          }
        };
        break;
      case 'eventos':
        payload = {
          token: document.getElementById('config-token').value.trim(),
          instance: document.getElementById('config-instance').value.trim(),
          phone: document.getElementById('config-phone').value.trim(),
          email: document.getElementById('config-email').value.trim(),
          customPrompt: document.getElementById('config-prompt').value.trim()
        };
        break;
      case 'personalidad':
        payload = { level: parseInt(emotionSlider.value) };
        break;
    }
    
    const originalText = btnSave.innerHTML;
    btnSave.innerHTML = '<ion-icon name="sync-outline" class="spin"></ion-icon> Guardando...';
    btnSave.disabled = true;

    const res = await fetch(`/api/knowledge/${currentTopic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Error al guardar');
    
    // Sincronizar local
    knowledgeData[currentTopic] = payload;
    
    showToast('✅ Cambios guardados y aplicados a WhatsApp');
    btnSave.innerHTML = originalText;
    btnSave.disabled = false;

  } catch (err) {
    console.error(err);
    alert('Hubo un error al guardar los datos: ' + err.message);
    btnSave.innerHTML = '<ion-icon name="save-outline"></ion-icon> Guardar Cambios';
    btnSave.disabled = false;
  }
});

// Toast notification helper
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Inicializar
fetchKnowledge();
