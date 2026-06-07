const navMenu = document.getElementById('nav-menu');
const editorState = document.getElementById('editor-state');
const welcomeState = document.getElementById('welcome-message');
const jsonEditor = document.getElementById('json-editor');
const btnSave = document.getElementById('btn-save');
const currentTitle = document.getElementById('current-title');
const statusMsg = document.getElementById('status-msg');
const toast = document.getElementById('toast');

let knowledgeData = {};
let currentTopic = null;
let currentJsonObj = null;

// Iconos mapeados por tópico
const iconMap = {
  menu: 'restaurant-outline',
  horarios: 'time-outline',
  faq: 'help-circle-outline',
  eventos: 'calendar-outline',
  restaurant: 'business-outline',
  media: 'images-outline'
};

const titleMap = {
  menu: 'Carta y Menú',
  horarios: 'Horarios de Atención',
  faq: 'Preguntas Frecuentes',
  eventos: 'Eventos y Shows',
  restaurant: 'Info del Restaurante',
  media: 'Imágenes y Multimedia'
};

async function fetchKnowledge() {
  try {
    const res = await fetch('/api/knowledge');
    if (!res.ok) throw new Error('Error al cargar los datos');
    knowledgeData = await res.json();
    renderMenu();
  } catch (err) {
    console.error(err);
    navMenu.innerHTML = '<div style="color:var(--danger); padding:1rem">Error de conexión</div>';
  }
}

function renderMenu() {
  navMenu.innerHTML = '';
  const topics = Object.keys(knowledgeData).sort();
  
  topics.forEach(topic => {
    // Si el nombre es 'restaurant-info', lo mapeamos a 'restaurant'
    const displayTopic = topic.replace('-info', '');
    const iconName = iconMap[displayTopic] || 'document-text-outline';
    const niceName = titleMap[displayTopic] || topic.toUpperCase();

    const div = document.createElement('div');
    div.className = 'nav-item';
    div.innerHTML = `
      <ion-icon name="${iconName}"></ion-icon>
      <span>${niceName}</span>
    `;
    
    div.addEventListener('click', () => selectTopic(topic, div, niceName));
    navMenu.appendChild(div);
  });
}

function selectTopic(topic, element, niceName) {
  // Update active class
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  element.classList.add('active');

  currentTopic = topic;
  currentTitle.textContent = niceName;
  
  // Update Editor
  welcomeState.classList.add('hidden');
  editorState.classList.remove('hidden');
  btnSave.disabled = false;
  statusMsg.textContent = '';
  
  currentJsonObj = knowledgeData[topic];
  jsonEditor.value = JSON.stringify(currentJsonObj, null, 2);
}

jsonEditor.addEventListener('input', () => {
  try {
    JSON.parse(jsonEditor.value);
    statusMsg.textContent = 'JSON Válido';
    statusMsg.className = 'status-msg success';
    btnSave.disabled = false;
  } catch (e) {
    statusMsg.textContent = 'JSON Inválido';
    statusMsg.className = 'status-msg error';
    btnSave.disabled = true;
  }
});

btnSave.addEventListener('click', async () => {
  if (!currentTopic || btnSave.disabled) return;
  
  try {
    const newData = JSON.parse(jsonEditor.value);
    const originalText = btnSave.innerHTML;
    btnSave.innerHTML = '<ion-icon name="sync-outline" class="spin"></ion-icon> Guardando...';
    btnSave.disabled = true;

    const res = await fetch(`/api/knowledge/${currentTopic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newData)
    });

    if (!res.ok) throw new Error('Error al guardar');
    
    // Update local state
    knowledgeData[currentTopic] = newData;
    
    // Show success
    showToast('✅ Cambios guardados y aplicados a WhatsApp');
    btnSave.innerHTML = originalText;
    btnSave.disabled = false;

  } catch (err) {
    console.error(err);
    alert('Hubo un error al guardar los datos.');
    btnSave.innerHTML = '<ion-icon name="save-outline"></ion-icon> Guardar Cambios';
    btnSave.disabled = false;
  }
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Inicializar
fetchKnowledge();
