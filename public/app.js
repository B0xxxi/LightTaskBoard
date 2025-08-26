/* ================================================
   Переменные и DOM элементы
================================================ */
const board = document.getElementById('board');
const addColumnBtn = document.getElementById('addColumnBtn');
const timerSettingsBtn = document.getElementById('timerSettingsBtn');

const columnTemplate = document.getElementById('columnTemplate');
const taskTemplate = document.getElementById('taskTemplate');

if (!columnTemplate || !taskTemplate || !board) {
  alert('Не удалось загрузить ключевые элементы DOM. Перезагрузите страницу.');
}

// Модальные окна и UI
const settingsModal = document.getElementById('settingsModal');
const warnInput = document.getElementById('warnMinutes');
const dangerInput = document.getElementById('dangerMinutes');
const resetCheckbox = document.getElementById('resetOnMove');
const saveSettingsBtn = document.getElementById('saveSettings');
const closeSettingsBtn = document.getElementById('closeSettings');
const marqueeEnabledInput = document.getElementById('marqueeEnabled');
const marqueeSpeedInput = document.getElementById('marqueeSpeed');
const exportDatabaseBtn = document.getElementById('exportDatabase');
const importDatabaseBtn = document.getElementById('importDatabase');
const importDatabaseFileInput = document.getElementById('importDatabaseFile');

const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const fileDrop = document.getElementById('fileDrop');
const keyFileInput = document.getElementById('keyFileInput');
const themeToggle = document.getElementById('themeToggle');
const logoutBtn = document.getElementById('logoutBtn');
const adminMessageDisplay = document.getElementById('adminMessageDisplay');

// Саундборд
const soundboardBtn = document.getElementById('soundboardBtn');
const soundboardModal = document.getElementById('soundboardModal');
const closeSoundboardBtn = document.getElementById('closeSoundboard');
const uploadSoundBtn = document.getElementById('uploadSound');
const soundNameInput = document.getElementById('soundName');
const soundFileInput = document.getElementById('soundFile');
const customSoundsGrid = document.getElementById('customSoundsGrid');

// События
const eventsBtn = document.getElementById('eventsBtn');
const eventsSection = document.getElementById('eventsSection');
const addEventBtn = document.getElementById('addEventBtn');
const backToBoardBtn = document.getElementById('backToBoardBtn');
const eventsCalendar = document.getElementById('eventsCalendar');
const expandedDayView = document.getElementById('expandedDayView');
const eventModal = document.getElementById('eventModal');
const eventModalTitle = document.getElementById('eventModalTitle');
const eventDate = document.getElementById('eventDate');
const eventTitle = document.getElementById('eventTitle');
const eventDescription = document.getElementById('eventDescription');
const saveEventBtn = document.getElementById('saveEvent');
const deleteEventBtn = document.getElementById('deleteEvent');
const cancelEventBtn = document.getElementById('cancelEvent');
const eventsOverview = document.getElementById('eventsOverview');

/* ================================================
   Глобальное состояние и конфигурация
================================================ */
let socket;
let authKey = localStorage.getItem('authKey') || '';
let isAdmin = false;
let editingEventId = null;
let contextMenuEl = null;

let appState = {
  columns: [],
  tasks: [],
  events: [],
  customSounds: [],
  adminMessage: '',
  marqueeConfig: { enabled: false, speed: 15 },
};

let timerConfig = {
  warnSeconds: 300,
  dangerSeconds: 900,
  baseFont: 12,
  increment: 6,
  resetOnMove: false,
};

/* ================================================
   Socket.io и API
================================================ */

function connectSocket(key) {
  if (socket) socket.disconnect();

  socket = io({ auth: { token: key } });

  socket.on('connect', () => {
    console.log('Socket connected!');
    hideLogin();
    showAuthedUI();
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
    logout();
    if (err.message === 'unauthorized') {
      alert('Ошибка авторизации. Пожалуйста, войдите снова.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socket.on('state:initial', (initialState) => {
    isAdmin = initialState.role === 'admin';
    updateFullState(initialState);
  });

  socket.on('state:updated', (newState) => {
    updateFullState(newState);
  });

  socket.on('sound:play', ({ sound, isCustom }) => {
    playSound(sound, isCustom);
  });

  socket.on('error', (error) => {
    console.error('Server error:', error);
    alert(`Произошла ошибка на сервере: ${error.message}`);
  });
}

// Обертка для эмит-событий с коллбэком (Promise)
function emitEvent(eventName, payload) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));
    socket.emit(eventName, payload, (response) => {
      if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/* ================================================
   Авторизация
================================================ */

async function attemptLogin(key) {
  authKey = key;
  localStorage.setItem('authKey', key);
  connectSocket(key);
}

function showLogin() {
  loginModal.classList.remove('hidden');
}
function hideLogin() {
  loginModal.classList.add('hidden');
}

loginBtn.addEventListener('click', () => {
  const key = passwordInput.value.trim();
  if (key) attemptLogin(key);
});
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

// Drag & drop и выбор файла с ключом
function handleKeyFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const json = JSON.parse(ev.target.result);
      if (json.key) attemptLogin(json.key);
      else alert('Ключ не найден в файле.');
    } catch (err) {
      alert('Некорректный JSON файл.');
    }
  };
  reader.readAsText(file);
}

['dragenter', 'dragover'].forEach(evt => fileDrop.addEventListener(evt, e => { e.preventDefault(); fileDrop.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(evt => fileDrop.addEventListener(evt, e => { e.preventDefault(); fileDrop.classList.remove('dragover'); }));
fileDrop.addEventListener('drop', e => handleKeyFile(e.dataTransfer.files[0]));
keyFileInput.addEventListener('change', e => handleKeyFile(e.target.files[0]));

/* ================================================
   Рендеринг и обновление состояния
================================================ */

function updateFullState(newState) {
  Object.assign(appState, newState);
  renderAll();
}

function renderAll() {
  renderBoard();
  renderEvents();
  applyRoleRestrictions();
  applyAdminMessageUI();
  applyMarqueeConfig();
}

function renderBoard() {
  if (document.querySelector('.dragging')) return; // Не перерисовываем во время перетаскивания
  board.innerHTML = '';
  appState.columns.forEach(col => {
    const colEl = createColumnDOM(col);
    if (colEl) {
      const tasksContainer = colEl.querySelector('.tasks');
      appState.tasks
        .filter(task => task.column_id === col.id)
        .forEach(task => {
          const taskEl = createTaskDOM(task);
          if (taskEl) tasksContainer.appendChild(taskEl);
        });
      board.appendChild(colEl);
    }
  });
}

function renderEvents() {
  renderEventsOverview();
  if (!eventsSection.classList.contains('hidden')) {
    rebuildEventsCalendar();
  }
}

/* ================================================
   Работа с колонками
================================================ */
function createColumnDOM({ id, title }) {
  const columnClone = columnTemplate.content.cloneNode(true);
  const columnEl = columnClone.querySelector('.column');
  const titleEl = columnClone.querySelector('.column-title');
  const deleteBtn = columnClone.querySelector('.delete-column');
  const addTaskBtn = columnClone.querySelector('.add-task');

  columnEl.dataset.id = id;
  titleEl.textContent = title;

  titleEl.addEventListener('blur', () => {
    const newTitle = titleEl.textContent.trim();
    if (newTitle !== title) {
      emitEvent('columns:update', { id, title: newTitle }).catch(err => {
        alert(`Ошибка обновления колонки: ${err.message}`);
        titleEl.textContent = title; // revert
      });
    }
  });

  deleteBtn.addEventListener('click', () => {
    if (confirm('Удалить эту категорию со всеми задачами?')) {
      emitEvent('columns:delete', { id }).catch(err => alert(`Ошибка удаления: ${err.message}`));
    }
  });

  addTaskBtn.addEventListener('click', () => {
    const taskTitle = prompt('Название задачи?', 'Новая задача');
    if (taskTitle) {
      emitEvent('tasks:create', { title: taskTitle, column_id: id }).catch(err => alert(`Ошибка создания задачи: ${err.message}`));
    }
  });

  return columnEl;
}

addColumnBtn.addEventListener('click', () => {
  const title = prompt('Название категории?', 'Новая категория');
  if (title) {
    emitEvent('columns:create', { title }).catch(err => alert(`Ошибка: ${err.message}`));
  }
});

/* ================================================
   Работа с задачами
================================================ */
function createTaskDOM({ id, title, created_at }) {
  const taskClone = taskTemplate.content.cloneNode(true);
  const taskEl = taskClone.querySelector('.task');
  const titleEl = taskClone.querySelector('.task-title');
  const deleteBtn = taskClone.querySelector('.delete-task');
  const createdDateSpan = taskClone.querySelector('.created-date');

  taskEl.dataset.id = id;
  taskEl.dataset.createdAt = created_at;
  titleEl.textContent = title;

  titleEl.addEventListener('blur', () => {
    const newTitle = titleEl.textContent.trim();
    if (newTitle !== title) {
      emitEvent('tasks:update', { id, title: newTitle }).catch(err => {
        alert(`Ошибка обновления задачи: ${err.message}`);
        titleEl.textContent = title; // revert
      });
    }
  });

  deleteBtn.addEventListener('click', () => {
    if (confirm('Удалить задачу?')) {
      emitEvent('tasks:delete', { id }).catch(err => alert(`Ошибка удаления: ${err.message}`));
    }
  });

  updateTaskTimer(taskEl);
  if (createdDateSpan) createdDateSpan.textContent = formatDate(created_at);

  return taskClone;
}

/* ================================================
   Drag & Drop
================================================ */
let draggedItem = null;
let isDraggingColumn = false;
let originalColumnId = null;

document.addEventListener('dragstart', (e) => {
  if (!isAdmin) return;
  draggedItem = e.target.closest('.task, .column');
  if (!draggedItem) return;

  isDraggingColumn = draggedItem.classList.contains('column');
  if (!isDraggingColumn) {
    originalColumnId = draggedItem.closest('.column').dataset.id;
  }
  setTimeout(() => draggedItem.classList.add('dragging'), 0);
});

document.addEventListener('dragend', (e) => {
  if (!draggedItem) return;
  draggedItem.classList.remove('dragging');
  draggedItem = null;
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!draggedItem) return;

  if (isDraggingColumn) {
    const afterElement = getColumnAfterElement(board, e.clientX);
    board.insertBefore(draggedItem, afterElement);
  } else {
    const container = e.target.closest('.tasks');
    if (container) {
      const afterElement = getDragAfterElement(container, e.clientY);
      container.insertBefore(draggedItem, afterElement);
    }
  }
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!draggedItem) return;

  if (isDraggingColumn) {
    const ids = Array.from(board.querySelectorAll('.column')).map(col => col.dataset.id);
    emitEvent('columns:reorder', { ids }).catch(err => {
      alert(`Ошибка сортировки колонок: ${err.message}`);
      renderBoard(); // revert
    });
  } else {
    const newColumnEl = draggedItem.closest('.column');
    if (newColumnEl) {
      const column_id = newColumnEl.dataset.id;
      const task_ids = Array.from(newColumnEl.querySelectorAll('.task')).map(task => task.dataset.id);
      const payload = { column_id, task_ids };
      if (timerConfig.resetOnMove && column_id !== originalColumnId) {
        payload.moved_task_id_to_reset_timer = draggedItem.dataset.id;
      }
      emitEvent('tasks:reorder', payload).catch(err => {
        alert(`Ошибка сортировки задач: ${err.message}`);
        renderBoard(); // revert
      });
    }
  }
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getColumnAfterElement(container, x) {
  const draggableElements = [...container.querySelectorAll('.column:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/* ================================================
   Таймеры и UI
================================================ */
function formatTime(seconds) {
  const days = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${days ? days + 'd ' : ''}${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
}

function updateTaskTimer(taskEl) {
  const now = Date.now();
  const created = parseInt(taskEl.dataset.createdAt, 10);
  if (isNaN(created)) return;

  const diffSec = Math.floor((now - created) / 1000);
  const timerSpan = taskEl.querySelector('.timer');
  if (!timerSpan) return;

  timerSpan.textContent = formatTime(diffSec);

  if (diffSec >= timerConfig.dangerSeconds) {
    timerSpan.style.color = 'red';
    timerSpan.style.fontSize = `${timerConfig.baseFont + timerConfig.increment}px`;
  } else if (diffSec >= timerConfig.warnSeconds) {
    timerSpan.style.color = 'orange';
    timerSpan.style.fontSize = `${timerConfig.baseFont + timerConfig.increment / 2}px`;
  } else {
    timerSpan.style.color = 'green';
    timerSpan.style.fontSize = `${timerConfig.baseFont}px`;
  }
}

setInterval(() => document.querySelectorAll('.task').forEach(updateTaskTimer), 1000);

/* ================================================
   Настройки
================================================ */
function openSettingsModal() {
  warnInput.value = timerConfig.warnSeconds / 60;
  dangerInput.value = timerConfig.dangerSeconds / 60;
  resetCheckbox.checked = timerConfig.resetOnMove;
  marqueeEnabledInput.checked = appState.marqueeConfig.enabled;
  marqueeSpeedInput.value = appState.marqueeConfig.speed;
  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

timerSettingsBtn.addEventListener('click', openSettingsModal);
closeSettingsBtn.addEventListener('click', closeSettingsModal);
saveSettingsBtn.addEventListener('click', () => {
  const warn = parseInt(warnInput.value, 10);
  const danger = parseInt(dangerInput.value, 10);
  if (warn && danger && warn < danger) {
    timerConfig.warnSeconds = warn * 60;
    timerConfig.dangerSeconds = danger * 60;
    timerConfig.resetOnMove = resetCheckbox.checked;

    const newMarqueeConfig = {
      enabled: marqueeEnabledInput.checked,
      speed: parseInt(marqueeSpeedInput.value, 10) || 15
    };

    emitEvent('settings:marquee:update', { config: newMarqueeConfig })
      .catch(err => alert(`Ошибка сохранения настроек: ${err.message}`));

    closeSettingsModal();
  } else {
    alert('Проверьте введённые значения.');
  }
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

/* ================================================
   Database Export/Import
================================================ */

async function exportDatabase() {
  try {
    exportDatabaseBtn.disabled = true;
    exportDatabaseBtn.textContent = '⏳ Экспорт...';
    
    const response = await fetch('/api/database/export', {
      method: 'GET',
      headers: { 'x-auth-key': authKey }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка экспорта');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `taskboard-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    alert('База данных успешно экспортирована!');
  } catch (error) {
    alert(`Ошибка экспорта: ${error.message}`);
  } finally {
    exportDatabaseBtn.disabled = false;
    exportDatabaseBtn.textContent = '📥 Экспортировать';
  }
}

async function importDatabase() {
  const file = importDatabaseFileInput.files[0];
  if (!file) {
    alert('Выберите файл для импорта');
    return;
  }
  
  if (!confirm('Вы уверены? Это заменит все текущие данные. При ошибке импорта данные будут автоматически восстановлены.')) {
    return;
  }
  
  try {
    importDatabaseBtn.disabled = true;
    importDatabaseBtn.textContent = '⏳ Импорт...';
    
    const formData = new FormData();
    formData.append('importFile', file);
    
    const response = await fetch('/api/database/import', {
      method: 'POST',
      headers: { 'x-auth-key': authKey },
      body: formData
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Ошибка импорта');
    }
    
    importDatabaseFileInput.value = '';
    alert(result.message || 'База данных успешно импортирована!');
  } catch (error) {
    alert(`${error.message}`);
  } finally {
    importDatabaseBtn.disabled = false;
    importDatabaseBtn.textContent = '📤 Импортировать';
  }
}

exportDatabaseBtn.addEventListener('click', exportDatabase);
importDatabaseBtn.addEventListener('click', importDatabase);

/* ================================================
   Админ-сообщение и бегущая строка
================================================ */
function applyAdminMessageUI() {
  if (isAdmin) {
    adminMessageDisplay.setAttribute('contenteditable', 'true');
    adminMessageDisplay.classList.add('admin-editable');
    adminMessageDisplay.style.display = 'block';
  } else {
    adminMessageDisplay.removeAttribute('contenteditable');
    adminMessageDisplay.classList.remove('admin-editable');
    const hasContent = (appState.adminMessage || '').trim();
    adminMessageDisplay.style.display = hasContent ? 'block' : 'none';
  }
  if (adminMessageDisplay.textContent !== appState.adminMessage) {
      adminMessageDisplay.textContent = appState.adminMessage;
  }
  document.body.classList.toggle('has-admin-message', !!(appState.adminMessage || '').trim());
}

function applyMarqueeConfig() {
  const isMarquee = appState.marqueeConfig.enabled && (appState.adminMessage || '').trim();
  adminMessageDisplay.classList.toggle('marquee', isMarquee);
  if (isMarquee) {
    if (!adminMessageDisplay.querySelector('.marquee-inner')) {
      const inner = document.createElement('div');
      inner.className = 'marquee-inner';
      inner.textContent = appState.adminMessage;
      adminMessageDisplay.innerHTML = '';
      adminMessageDisplay.appendChild(inner);
    }
    adminMessageDisplay.style.setProperty('--marquee-speed', `${appState.marqueeConfig.speed}s`);
  } else {
    const inner = adminMessageDisplay.querySelector('.marquee-inner');
    if (inner) adminMessageDisplay.textContent = inner.textContent;
  }
}

let adminSaveTimeout;
adminMessageDisplay.addEventListener('input', () => {
  clearTimeout(adminSaveTimeout);
  adminSaveTimeout = setTimeout(() => {
    const message = adminMessageDisplay.textContent.trim();
    emitEvent('adminMessage:update', { message }).catch(err => alert(`Ошибка: ${err.message}`));
  }, 1000);
});

/* ================================================
   Саундборд
================================================ */
function openSoundboard() {
  soundboardModal.classList.remove('hidden');
  renderCustomSounds();
}

function closeSoundboard() {
  soundboardModal.classList.add('hidden');
}

function renderCustomSounds() {
  if (!customSoundsGrid) return;
  customSoundsGrid.innerHTML = '';
  if (appState.customSounds.length === 0) {
    customSoundsGrid.innerHTML = '<div class="sound-empty">Кастомные звуки не загружены</div>';
    return;
  }
  appState.customSounds.forEach(sound => {
    const btn = document.createElement('button');
    btn.className = 'sound-btn custom-sound';
    btn.dataset.sound = sound.filename;
    btn.innerHTML = `🎵 ${sound.name}`;
    if (isAdmin) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-sound';
      deleteBtn.innerHTML = '×';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Удалить звук "${sound.name}"?`)) {
          emitEvent('sounds:custom:delete', { id: sound.id }).catch(err => alert(`Ошибка: ${err.message}`));
        }
      });
      btn.appendChild(deleteBtn);
    }
    customSoundsGrid.appendChild(btn);
  });
}

async function uploadCustomSound() {
  const name = soundNameInput.value.trim();
  const file = soundFileInput.files[0];
  if (!name || !file) return alert('Введите название и выберите файл');
  if (file.size > 5 * 1024 * 1024) return alert('Файл слишком большой (макс 5MB)');

  const formData = new FormData();
  formData.append('soundName', name);
  formData.append('soundFile', file);

  try {
    uploadSoundBtn.disabled = true;
    uploadSoundBtn.textContent = '🔄 Загрузка...';
    const response = await fetch('/api/sounds/upload', {
      method: 'POST',
      headers: { 'x-auth-key': authKey },
      body: formData
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка загрузки');
    }
    soundNameInput.value = '';
    soundFileInput.value = '';
    alert(`Звук "${name}" успешно загружен!`);
  } catch (err) {
    alert(`Ошибка загрузки: ${err.message}`);
  } finally {
    uploadSoundBtn.disabled = false;
    uploadSoundBtn.textContent = '📤 Загрузить';
  }
}

soundboardBtn.addEventListener('click', openSoundboard);
closeSoundboardBtn.addEventListener('click', closeSoundboard);
uploadSoundBtn.addEventListener('click', uploadCustomSound);
soundboardModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('sound-btn')) {
    const soundName = e.target.dataset.sound;
    const isCustom = e.target.classList.contains('custom-sound');
    playSound(soundName, isCustom);
    if (isAdmin) emitEvent('sound:broadcast', { sound: soundName, isCustom });
  }
  if (e.target === soundboardModal) closeSoundboard();
});

function playSound(soundName, isCustom = false) {
  try {
    if (isCustom) {
      new Audio(`/sounds/${soundName}`).play().catch(e => console.warn("Playback failed"));
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audioContext = new AudioContext();
    const sound = { notification: { f: 800, d: 200, t: 'sine' }, success: { f: 600, d: 300, t: 'triangle' }, error: { f: 300, d: 500, t: 'sawtooth' }, attention: { f: 1000, d: 150, t: 'square' } }[soundName];
    if (!sound) return;
    const o = audioContext.createOscillator();
    const g = audioContext.createGain();
    o.connect(g);
    g.connect(audioContext.destination);
    o.frequency.setValueAtTime(sound.f, audioContext.currentTime);
    o.type = sound.t;
    g.gain.setValueAtTime(0.3, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + sound.d / 1000);
    o.start();
    o.stop(audioContext.currentTime + sound.d / 1000);
  } catch (e) { console.error('playSound error', e); }
}

/* ================================================
   События (Календарь)
================================================ */

function showEventsView() {
  board.classList.add('hidden');
  eventsSection.classList.remove('hidden');
  rebuildEventsCalendar();
}

function showBoardView() {
  eventsSection.classList.add('hidden');
  board.classList.remove('hidden');
}

function rebuildEventsCalendar() {
  if (!eventsCalendar || document.querySelector('.calendar-day.expanded')) return;
  eventsCalendar.innerHTML = '';
  [-1, 0, 1].forEach(offset => {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '32px';
    eventsCalendar.appendChild(wrapper);
    renderEventsCalendar(wrapper, offset);
  });
}

function renderEventsCalendar(parentEl, offset = 0) {
  const today = new Date();
  const baseMonth = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const monthName = baseMonth.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
  const title = document.createElement('h3');
  title.textContent = monthName;
  parentEl.appendChild(title);

  const calendarGrid = document.createElement('div');
  calendarGrid.className = 'events-calendar';
  parentEl.appendChild(calendarGrid);

  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'calendar-header';
    h.textContent = d;
    calendarGrid.appendChild(h);
  });

  const firstDay = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1);
  const lastDay = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - (firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1));

  let cur = new Date(startDate);
  for (let i = 0; i < 42; i++) { // Always render 6 weeks for consistency
    calendarGrid.appendChild(createCalendarDay(new Date(cur), baseMonth.getMonth()));
    cur.setDate(cur.getDate() + 1);
  }
}

function createCalendarDay(date, currentMonth) {
  const dayEl = document.createElement('div');
  const dateStr = toLocalDateString(date);
  dayEl.className = 'calendar-day';
  dayEl.dataset.date = dateStr;

  if (date.getMonth() !== currentMonth) dayEl.classList.add('other-month');
  if (date.toDateString() === new Date().toDateString()) dayEl.classList.add('today');
  if (isWeekendOrHoliday(date)) dayEl.classList.add('weekend-or-holiday');
  if (isRussianHoliday(date)) dayEl.classList.add('russian-holiday');

  const dayNumber = document.createElement('div');
  dayNumber.className = 'day-number';
  dayNumber.textContent = date.getDate();
  dayEl.appendChild(dayNumber);

  const eventsContainer = document.createElement('div');
  eventsContainer.className = 'day-events';
  appState.events.filter(event => event.date === dateStr).forEach(event => {
    const eventEl = document.createElement('div');
    eventEl.className = 'event-item';
    eventEl.textContent = event.title;
    eventEl.title = event.description || event.title;
    if (isAdmin) eventEl.addEventListener('click', () => openEditEventModal(event));
    eventsContainer.appendChild(eventEl);
  });
  dayEl.appendChild(eventsContainer);

  if (isAdmin && date.getMonth() === currentMonth) {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-event-day';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => openAddEventModal(dateStr));
    dayEl.appendChild(addBtn);
  }

  dayEl.addEventListener('click', (e) => {
    if (!e.target.closest('.event-item, .add-event-day')) {
      showExpandedDayView(dateStr);
    }
  });

  return dayEl;
}

function openAddEventModal(date = '') {
  editingEventId = null;
  eventModalTitle.textContent = 'Добавить событие';
  eventDate.value = date;
  eventTitle.value = '';
  eventDescription.value = '';
  deleteEventBtn.classList.add('hidden');
  eventModal.classList.remove('hidden');
}

function openEditEventModal(event) {
  editingEventId = event.id;
  eventModalTitle.textContent = 'Редактировать событие';
  eventDate.value = event.date;
  eventTitle.value = event.title;
  eventDescription.value = event.description || '';
  deleteEventBtn.classList.remove('hidden');
  eventModal.classList.remove('hidden');
}

function closeEventModal() {
  eventModal.classList.add('hidden');
}

function saveEvent() {
  const date = eventDate.value;
  const title = eventTitle.value.trim();
  const description = eventDescription.value.trim();
  if (!date || !title) return alert('Заполните дату и название.');

  const payload = { date, title, description };
  const eventName = editingEventId ? 'events:update' : 'events:create';
  if (editingEventId) payload.id = editingEventId;

  emitEvent(eventName, payload)
    .then(() => closeEventModal())
    .catch(err => alert(`Ошибка сохранения: ${err.message}`));
}

function deleteCurrentEvent() {
  if (editingEventId) {
    if (confirm('Удалить это событие?')) {
      emitEvent('events:delete', { id: editingEventId })
        .then(() => closeEventModal())
        .catch(err => alert(`Ошибка удаления: ${err.message}`));
    }
  }
}

// --- Обработчики событий календаря ---
eventModal.addEventListener('click', e => { if (e.target === eventModal) closeEventModal(); });
eventsBtn.addEventListener('click', showEventsView);
backToBoardBtn.addEventListener('click', showBoardView);
addEventBtn.addEventListener('click', () => openAddEventModal(toLocalDateString(new Date())));
saveEventBtn.addEventListener('click', saveEvent);
deleteEventBtn.addEventListener('click', deleteCurrentEvent);
cancelEventBtn.addEventListener('click', closeEventModal);

/* ================================================
   Вспомогательные функции и UI
================================================ */
function applyRoleRestrictions() {
  const isAdm = !!isAdmin;
  document.body.classList.toggle('admin-view', isAdm);
  document.body.classList.toggle('view-only', !isAdm);

  // Управление видимостью кнопок верхнего уровня
  timerSettingsBtn.style.display = isAdm ? '' : 'none';
  addColumnBtn.style.display = isAdm ? '' : 'none';
  addEventBtn.style.display = isAdm ? '' : 'none';
  
  // Database management controls
  if (exportDatabaseBtn) exportDatabaseBtn.style.display = isAdm ? '' : 'none';
  if (importDatabaseBtn) importDatabaseBtn.style.display = isAdm ? '' : 'none';
  if (importDatabaseFileInput) importDatabaseFileInput.style.display = isAdm ? '' : 'none';
  document.querySelectorAll('.database-controls').forEach(el => {
    el.style.display = isAdm ? '' : 'none';
  });
  
  // Для саундборда кнопка видима всем, но функционал внутри (загрузка) только для админа
  soundboardBtn.style.display = ''; 

  // Динамическое управление элементами, которые могут быть добавлены/удалены
  document.querySelectorAll('.delete-column, .delete-task, .add-task, .add-event-day').forEach(el => {
      el.style.display = isAdm ? '' : 'none';
  });

  document.querySelectorAll('.task, .column').forEach(el => {
      if(isAdm) {
          el.setAttribute('draggable', 'true');
      } else {
          el.removeAttribute('draggable');
      }
  });
}

function showAuthedUI() {
  logoutBtn.classList.remove('hidden');
  eventsBtn.style.display = '';
  soundboardBtn.style.display = '';
  applyRoleRestrictions(); // Применяем ограничения, которые покажут админские кнопки
  showBoardView();
}

function logout() {
  if (socket) socket.disconnect();
  localStorage.removeItem('authKey');
  authKey = '';
  isAdmin = false;
  document.body.classList.remove('admin-view', 'view-only');
  board.innerHTML = '';
  eventsSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  showLogin();
}
logoutBtn.addEventListener('click', logout);

function toLocalDateString(date) {
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
}

function formatDate(ts) {
  return new Date(parseInt(ts, 10)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isRussianHoliday(date) {
  const m = date.getMonth() + 1, d = date.getDate();
  const holidays = ['1-1','1-2','1-3','1-4','1-5','1-6','1-7','1-8','2-23','3-8','5-1','5-9','6-12','11-4'];
  return holidays.includes(`${m}-${d}`);
}

function isWeekendOrHoliday(date) {
  const day = date.getDay();
  return day === 0 || day === 6 || isRussianHoliday(date);
}

// --- Инициализация ---
function init() {
  // Theme
  const isDark = localStorage.getItem('dark') === '1';
  document.body.classList.toggle('dark', isDark);
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('dark', isDark ? '1' : '0');
    themeToggle.textContent = isDark ? '☀️' : '🌙';
  });

  // Initial auth check
  if (authKey) {
    attemptLogin(authKey);
  } else {
    showLogin();
  }
  
  // Hide elements until auth
  board.classList.add('hidden');
  eventsSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

// --- Expanded Day View (всплывающее окно для дня) ---
const overlay = document.createElement('div');
overlay.className = 'overlay';
document.body.appendChild(overlay);

function showExpandedDayView(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const dayEvents = appState.events.filter(event => event.date === dateStr);
  const headerDate = date.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  let eventsHTML = dayEvents.length > 0 ? dayEvents.map(event => `
    <div class="expanded-event-item" data-event-id="${event.id}" ${isAdmin ? 'title="Нажмите для редактирования"' : ''}>
      <div class="expanded-event-title">${event.title}</div>
      ${event.description ? `<div class="expanded-event-desc">${event.description}</div>` : ''}
    </div>
  `).join('') : '<div class="expanded-event-empty">На этот день событий нет.</div>';

  expandedDayView.innerHTML = `
    <div class="expanded-day-header"><h2>${headerDate}</h2><button class="close-expanded-view">&times;</button></div>
    <div class="expanded-day-content">${eventsHTML}</div>
    ${isAdmin ? '<div class="expanded-day-footer"><button class="add-event-expanded-view">+ Добавить событие</button></div>' : ''}
  `;
  
  expandedDayView.classList.add('visible');
  overlay.classList.add('active');

  expandedDayView.querySelector('.close-expanded-view').addEventListener('click', hideExpandedDayView);
  overlay.addEventListener('click', hideExpandedDayView, { once: true });
  
  if (isAdmin) {
    expandedDayView.querySelector('.add-event-expanded-view')?.addEventListener('click', () => {
      hideExpandedDayView();
      openAddEventModal(dateStr);
    });
    expandedDayView.querySelectorAll('.expanded-event-item').forEach(item => {
      item.addEventListener('click', () => {
        const event = appState.events.find(e => e.id === parseInt(item.dataset.eventId, 10));
        if (event) {
          hideExpandedDayView();
          openEditEventModal(event);
        }
      });
    });
  }
}

function hideExpandedDayView() {
  expandedDayView.classList.remove('visible');
  overlay.classList.remove('active');
}

function renderEventsOverview() {
    if (!eventsOverview) return;
    eventsOverview.innerHTML = '';
    if (isAdmin) {
        renderAdminEventsTable();
    } else {
        renderUserEventsList();
    }
}

function renderAdminEventsTable() {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 15);
    const table = document.createElement('table');
    table.className = 'admin-events-table';
    const headerRow = document.createElement('tr');
    const dataRow = document.createElement('tr');
    let currentDate = new Date(startDate);

    for (let i = 0; i < 31; i++) {
        const th = document.createElement('th');
        th.textContent = String(currentDate.getDate()).padStart(2, '0');
        if (currentDate.toDateString() === today.toDateString()) {
            th.classList.add('today');
        }
        headerRow.appendChild(th);

        const td = document.createElement('td');
        const dateStr = toLocalDateString(currentDate);
        const dayEvents = appState.events.filter(ev => ev.date === dateStr);
        if (dayEvents.length > 0) {
            td.textContent = dayEvents[0].title;
            td.title = dayEvents.map(e => e.title).join(', ');
        }
        if (isRussianHoliday(currentDate)) td.classList.add('holiday');
        else if (isWeekendOrHoliday(currentDate)) td.classList.add('weekend');
        td.addEventListener('click', () => showExpandedDayView(dateStr));
        dataRow.appendChild(td);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    table.append(headerRow, dataRow);
    eventsOverview.appendChild(table);
}

function renderUserEventsList() {
    const container = document.createElement('div');
    container.className = 'user-events-container';
    const upcoming = appState.events
        .filter(ev => new Date(ev.date + 'T00:00:00') >= new Date().setHours(0, 0, 0, 0))
        .sort((a, b) => a.date.localeCompare(b.date));

    if (!upcoming.length) {
        container.textContent = 'Ближайших событий нет';
        eventsOverview.appendChild(container);
        return;
    }

    const list = document.createElement('div');
    list.className = 'user-events-list';
    upcoming.forEach(ev => {
        const item = document.createElement('div');
        item.className = 'user-events-item';
        item.innerHTML = `<div class="evt-date">${new Date(ev.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</div><div class="evt-title">${ev.title}</div>`;
        list.appendChild(item);
    });
    container.appendChild(list);
    eventsOverview.appendChild(container);
}


init();