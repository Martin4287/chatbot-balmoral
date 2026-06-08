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
  media: 'images-outline',
  personalidad: 'happy-outline'
};

const titleMap = {
  menu: 'Carta y Menú',
  horarios: 'Horarios de Atención',
  faq: 'Preguntas Frecuentes',
  eventos: 'Eventos y Shows',
  restaurant: 'Info del Restaurante',
  media: 'Imágenes y Multimedia',
  personalidad: 'Personalidad del Bot'
};

async function fetchKnowledge() {
  try {
    const res = await fetch('/api/knowledge');
    if (!res.ok) throw new Error('Error al cargar los datos');
    knowledgeData = await res.json();
    
    // Asegurar que exista personalidad
    if (!knowledgeData.personalidad) {
      knowledgeData.personalidad = { content: "3" };
    }
    
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

const sliderState = document.getElementById('slider-state');
const emotionSlider = document.getElementById('emotion-slider');
const emotionLabel = document.getElementById('emotion-label');
const emotionDesc = document.getElementById('emotion-desc');

const emotionConfigs = {
  1: { label: 'Serio / Distante (1)', desc: 'El bot será extremadamente serio, distante, cortante y puramente informativo. Cero emociones, sin emojis.' },
  2: { label: 'Formal (2)', desc: 'El bot será formal y respetuoso. Profesional, sin excesos de amabilidad ni emojis.' },
  3: { label: 'Equilibrado (3)', desc: 'El bot será amable y servicial, manteniendo la formalidad de un buen restaurante. Usará 1 o 2 emojis.' },
  4: { label: 'Cálido y Amigable (4)', desc: 'El bot será muy cálido, amigable y entusiasta. Usará exclamaciones y varios emojis frecuentemente.' },
  5: { label: 'Emocional Extremo (5)', desc: 'El bot será excesivamente cariñoso, eufórico y lleno de emojis. Todo será "¡Fantástico!" o "¡Excelente!".' }
};

function updateSliderUI(val) {
  const config = emotionConfigs[val];
  emotionLabel.textContent = config.label;
  emotionDesc.textContent = config.desc;
}

emotionSlider.addEventListener('input', (e) => {
  updateSliderUI(e.target.value);
  btnSave.disabled = false;
});

function selectTopic(topic, element, niceName) {
  // Update active class
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  element.classList.add('active');

  currentTopic = topic;
  currentTitle.textContent = niceName;
  
  welcomeState.classList.add('hidden');
  btnSave.disabled = false;
  statusMsg.textContent = '';
  
  currentJsonObj = knowledgeData[topic] || {};

  if (topic === 'personalidad') {
    editorState.classList.add('hidden');
    sliderState.classList.remove('hidden');
    
    // Set slider value
    let val = 3;
    if (currentJsonObj.content) {
      val = parseInt(currentJsonObj.content) || 3;
    } else if (typeof currentJsonObj === 'number') {
      val = currentJsonObj;
    } else if (currentJsonObj.level) {
      val = currentJsonObj.level;
    }
    emotionSlider.value = val;
    updateSliderUI(val);
    btnSave.disabled = true; // disable until changed
  } else {
    sliderState.classList.add('hidden');
    editorState.classList.remove('hidden');
    
    if (topic === 'media') {
      document.querySelector('.badge').textContent = 'Formato JSON';
      jsonEditor.value = JSON.stringify(currentJsonObj, null, 2);
    } else {
      document.querySelector('.badge').textContent = 'Formato Texto Libre';
      if (currentJsonObj.content) {
        jsonEditor.value = currentJsonObj.content;
      } else if (topic === 'faq' && currentJsonObj.items) {
        jsonEditor.value = currentJsonObj.items.map(i => `P: ${i.pregunta}\nR: ${i.respuesta}`).join('\n\n');
      } else {
        let rawText = '';
        if (typeof currentJsonObj === 'object') {
          if (Object.keys(currentJsonObj).length > 0) {
            rawText = JSON.stringify(currentJsonObj, null, 2);
          }
        } else {
          rawText = currentJsonObj;
        }
        jsonEditor.value = rawText;
      }
    }
  }
}

jsonEditor.addEventListener('input', () => {
  if (currentTopic === 'media') {
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
  } else {
    statusMsg.textContent = 'Texto Libre';
    statusMsg.className = 'status-msg success';
    btnSave.disabled = false;
  }
});

btnSave.addEventListener('click', async () => {
  if (!currentTopic || btnSave.disabled) return;
  
  try {
    let newData;
    if (currentTopic === 'personalidad') {
      newData = { content: emotionSlider.value };
    } else if (currentTopic === 'media') {
      newData = JSON.parse(jsonEditor.value);
    } else {
      newData = { content: jsonEditor.value };
    }
    
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
