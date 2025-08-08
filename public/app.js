/* ================================================
   Переменные и DOM элементы
================================================ */
const board = document.getElementById('board');
const addColumnBtn = document.getElementById('addColumnBtn');
const timerSettingsBtn = document.getElementById('timerSettingsBtn');

const columnTemplate = document.getElementById('columnTemplate');
const taskTemplate = document.getElementById('taskTemplate');

// Проверка доступности шаблонов - без них работа невозможна
if(!columnTemplate || !taskTemplate || !board) {
  alert('Не удалось загрузить шаблоны. Перезагрузите страницу.');
}

// Модальные окна
const settingsModal = document.getElementById('settingsModal');
const warnInput = document.getElementById('warnMinutes');
const dangerInput = document.getElementById('dangerMinutes');
const resetCheckbox = document.getElementById('resetOnMove');
const saveSettingsBtn = document.getElementById('saveSettings');
const closeSettingsBtn = document.getElementById('closeSettings');
const marqueeEnabledInput = document.getElementById('marqueeEnabled');
const marqueeSpeedInput = document.getElementById('marqueeSpeed');

const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const fileDrop = document.getElementById('fileDrop');
const keyFileInput = document.getElementById('keyFileInput');
const themeToggle = document.getElementById('themeToggle');

const logoutBtn = document.getElementById('logoutBtn');
// Админское сообщение
const adminMessageDisplay = document.getElementById('adminMessageDisplay');

// Саундборд
const soundboardBtn = document.getElementById('soundboardBtn');
const soundboardModal = document.getElementById('soundboardModal');
const closeSoundboardBtn = document.getElementById('closeSoundboard');
const uploadSoundBtn = document.getElementById('uploadSound');
const soundNameInput = document.getElementById('soundName');
const soundFileInput = document.getElementById('soundFile');
const customSoundsGrid = document.getElementById('customSoundsGrid');

const expandedDayView = document.getElementById('expandedDayView');

// События
const eventsBtn = document.getElementById('eventsBtn');
const eventsSection = document.getElementById('eventsSection');
const addEventBtn = document.getElementById('addEventBtn');
const backToBoardBtn = document.getElementById('backToBoardBtn');
const eventsCalendar = document.getElementById('eventsCalendar');

const eventModal = document.getElementById('eventModal');
const eventModalTitle = document.getElementById('eventModalTitle');
const eventDate = document.getElementById('eventDate');
const eventTitle = document.getElementById('eventTitle');
const eventDescription = document.getElementById('eventDescription');
const saveEventBtn = document.getElementById('saveEvent');
const deleteEventBtn = document.getElementById('deleteEvent');
const cancelEventBtn = document.getElementById('cancelEvent');

let currentEvents = [];
let editingEventId = null;
let lastSoundCheck = 0; // Временная метка последней проверки звуков
let customSounds = []; // Список кастомных звуков

/* ================================================
   Конфигурация таймера (секунды)
================================================ */
let timerConfig = {
  warnSeconds: 300, // 5 минут
  dangerSeconds: 900, // 15 минут
  baseFont: 12,
  increment: 6,
  resetOnMove: false,
};

let marqueeConfig = {
    enabled: false,
    speed: 15, // seconds
};

/* ================================================
   Авторизация
================================================ */
let authKey = localStorage.getItem('authKey') || '';
let isAdmin = false;
const eventsOverview = document.getElementById('eventsOverview');
let contextMenuEl = null;

async function apiFetch(url, opts = {}) {
  const options = { ...opts };
  options.headers = options.headers || {};
  if (!options.headers['Content-Type'] && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
  }
  if (authKey) options.headers['x-auth-key'] = authKey;
  const response = await fetch(url, options);
  if (response.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'error');
  }
  return response.json();
}

async function attemptLogin(key, silent = false) {
  // Try login API
  let resp;
  try {
    resp = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ key }),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('login-error', e);
    localStorage.removeItem('authKey');
    authKey = '';
    if (!silent) alert('Неверный пароль или ключ.');
    return;
  }
  // On successful login
  authKey = key;
  localStorage.setItem('authKey', key);
  isAdmin = resp.role === 'admin';
  lastSoundCheck = Date.now(); // Инициализируем проверку звуков
  hideLogin();
  // Post-login data loading
  try {
    await loadEvents();
    renderEventsOverview();
    await loadState();
  } catch (e) {
    console.error('post-login load error', e);
  }
  applyRoleRestrictions();
  showAuthedUI();
  startAutoRefresh(); // Запускаем автообновление после успешного входа
}

function showLogin() {
  loginModal.classList.remove('hidden');
}
function hideLogin() {
  loginModal.classList.add('hidden');
}

loginBtn.addEventListener('click', () => {
  const key = passwordInput.value.trim();
  attemptLogin(key, false);
});
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

/* Drag & drop файла с ключом */
['dragenter', 'dragover'].forEach((evt) => {
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDrop.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDrop.classList.remove('dragover');
  });
});
fileDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const json = JSON.parse(ev.target.result);
      if (json.key) attemptLogin(json.key, false);
      else alert('Ключ не найден в файле.');
    } catch (err) {
      alert('Некорректный JSON файл.');
    }
  };
  reader.readAsText(file);
});

/* Чтение файла из input */
keyFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
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
});

/* Проверяем токен из localStorage */
if (authKey) {
  // Silent auto-login to avoid error alert on page load
  attemptLogin(authKey, true);
} else {
  showLogin();
}

/* ================================================
   Работа с колонками
================================================ */
function createColumnDOM({ id, title }) {
  try {
    if (!columnTemplate || !columnTemplate.content) {
      return null;
    }



    const columnClone = columnTemplate.content.cloneNode(true);
    const columnEl = columnClone.querySelector('.column');

    if (!columnEl) {
      // Попробуем найти его другим способом для отладки
      const childNodes = Array.from(columnClone.childNodes).map(n => n.nodeName);
      return null;
    }

    const titleEl = columnClone.querySelector('.column-title');
    const deleteBtn = columnClone.querySelector('.delete-column');
    const addTaskBtn = columnClone.querySelector('.add-task');
    const tasksContainer = columnClone.querySelector('.tasks');

    if (!titleEl || !deleteBtn || !addTaskBtn || !tasksContainer) {
      return null;
    }

    columnEl.dataset.id = id;
    titleEl.textContent = title;

    // Изменение названия колонки на blur
    titleEl.addEventListener('blur', async () => {
      const newTitle = titleEl.textContent.trim();
      await apiFetch(`/api/columns/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle }),
      }).catch(() => {});
    });

    // Удаление колонки
    deleteBtn.addEventListener('click', async () => {
      if (confirm('Удалить эту категорию со всеми задачами?')) {
        await apiFetch(`/api/columns/${id}`, { method: 'DELETE' });
        columnEl.remove();
      }
    });

    // Добавление задачи
    addTaskBtn.addEventListener('click', async () => {
      const taskTitle = prompt('Название задачи?', 'Новая задача');
      if (taskTitle) {
        const data = await apiFetch('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: taskTitle, column_id: id }),
        });
        const taskDOM = createTaskDOM(data);
        tasksContainer.appendChild(taskDOM);
      }
    });

    board.appendChild(columnEl); // ВАЖНО: добавляем сам элемент, а не DocumentFragment

    // Drag & drop обработчики для колонок (draggable атрибут устанавливается в applyRoleRestrictions)
    let isReorderInProgress = false;
    columnEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      columnEl.classList.add('dragging');
    });
    columnEl.addEventListener('dragend', async () => {
      columnEl.classList.remove('dragging');
      if (!isAdmin || isReorderInProgress) return;
      isReorderInProgress = true;
      try {
        const ids = Array.from(board.querySelectorAll('.column')).map(c => c.dataset.id);
        await apiFetch('/api/columns/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
      } catch (err) {
        await loadState();
      } finally {
        isReorderInProgress = false;
      }
    });

    // Возвращаем созданный элемент для единообразия
    return columnEl;

  } catch (error) {
    return null;
  }
}

/* ================================================
   Работа с задачами
================================================ */
function createTaskDOM({ id, title, created_at }) {
  try {
    if (!taskTemplate) {
      return null;
    }

    const taskClone = taskTemplate.content.cloneNode(true);
    const taskEl = taskClone.querySelector('.task');
    if (!taskEl) {
      return null;
    }

    taskEl.dataset.id = id;
    taskEl.dataset.createdAt = created_at;

    const titleEl = taskClone.querySelector('.task-title');
    if (titleEl) {
      titleEl.textContent = title;
      // Добавляем обработчик для сохранения при снятии фокуса
      titleEl.addEventListener('blur', async () => {
        const newTitle = titleEl.textContent.trim();
        if (newTitle === title) return; // не отправлять запрос если ничего не поменялось
        try {
          await apiFetch(`/api/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ title: newTitle }),
          });
          // Обновляем title в памяти чтобы повторные blur не слали запросы
          title = newTitle; 
        } catch (err) {
          // опционально: вернуть старый текст или показать ошибку
          titleEl.textContent = title; 
        }
      });
    }

    const createdDateSpan = taskClone.querySelector('.created-date');
    if (createdDateSpan) {
      createdDateSpan.textContent = formatDate(created_at);
    }

    // Обработка удаления
    const deleteBtn = taskClone.querySelector('.delete-task');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (confirm('Удалить задачу?')) {
          await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
          taskEl.remove();
        }
      });
    }

    // Drag events
    taskEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      taskEl.classList.add('dragging');
    });
    taskEl.addEventListener('dragend', () => {
      taskEl.classList.remove('dragging');
    });

    return taskClone;
  } catch (error) {
    return null;
  }
}

/* ================================================
   Drag & Drop логика для задач
================================================ */
let draggedElement = null;

document.addEventListener('dragstart', (e) => {
  if (e.target.classList.contains('task')) {
    draggedElement = e.target;
  }
});

document.addEventListener('dragover', (e) => {
  const container = e.target.closest('.tasks');
  if (container) {
    e.preventDefault();
    const afterElement = getDragAfterElement(container, e.clientY);
    if (!afterElement) {
      container.appendChild(draggedElement);
    } else {
      container.insertBefore(draggedElement, afterElement);
    }
  }
});

document.addEventListener('drop', async (e) => {
  const container = e.target.closest('.tasks');
  if (!container || !draggedElement) return;
  const taskId = draggedElement.dataset.id;
  const newColumnId = container.closest('.column').dataset.id;
  const reset_created = timerConfig.resetOnMove;
  await apiFetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ column_id: newColumnId, reset_created }),
  });
  if (reset_created) draggedElement.dataset.createdAt = Date.now();
  draggedElement = null;
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task:not(.dragging)')];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

/* ================================================
   Drag & Drop логика для колонок
================================================ */
function getColumnAfterElement(container, x) {
  const draggableElements = [...container.querySelectorAll('.column:not(.dragging)')];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

// Глобальные обработчики для drag & drop колонок
let dragOverTimeout = null;

document.addEventListener('dragover', (e) => {
  // Проверяем, что перетаскиваем колонку
  const draggingColumn = board.querySelector('.column.dragging');
  if (!draggingColumn || !isAdmin) return;
  
  // Находим ближайшую колонку под курсором
  const column = e.target.closest('.column');
  if (!column || column === draggingColumn) return;
  
  e.preventDefault();
  
  // Ограничиваем частоту перестановки колонок
  if (dragOverTimeout) return;
  dragOverTimeout = setTimeout(() => {
    dragOverTimeout = null;
  }, 10); // Ограничиваем до 100 раз в секунду
  
  // Определяем позицию для вставки
  const afterElement = getColumnAfterElement(board, e.clientX);
  if (!afterElement) {
    board.appendChild(draggingColumn);
  } else {
    board.insertBefore(draggingColumn, afterElement);
  }
});

let saveInProgress = false;

document.addEventListener('drop', async (e) => {
  const draggingColumn = board.querySelector('.column.dragging');
  if (!draggingColumn || !isAdmin) return;
  
  e.preventDefault();
  draggingColumn.classList.remove('dragging');
  
  // Предотвращаем множественные сохранения
  if (saveInProgress) return;
  saveInProgress = true;
  
  try {
    // Сохраняем новый порядок на сервере
    const ids = Array.from(board.querySelectorAll('.column')).map(col => col.dataset.id);
    
    const response = await apiFetch('/api/columns/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
    
  } catch (error) {
    // Перезагружаем состояние в случае ошибки
    await loadState();
  } finally {
    saveInProgress = false;
  }
});

/* ================================================
   Таймер задач
================================================ */
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
}

function updateTimers() {
  const now = Date.now();
  document.querySelectorAll('.task').forEach((task) => {
    const created = parseInt(task.dataset.createdAt, 10);
    const diffSec = Math.floor((now - created) / 1000);
    const timerSpan = task.querySelector('.timer');
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
  });
}
setInterval(updateTimers, 1000);

/* ================================================
   Автообновление данных
================================================ */
let autoRefreshInterval = null;

let lastUserActivity = Date.now();

// Трекинг активности пользователя
document.addEventListener('mousedown', () => {
  lastUserActivity = Date.now();
});

document.addEventListener('dragstart', () => {
  lastUserActivity = Date.now();
});

async function autoRefresh() {
  if (!authKey) return; // Не обновляем если не авторизованы
  
  try {
    
    // Обновляем события
    await loadEvents();
    renderEventsOverview();
    
    // Проверяем звуковые команды для viewer'ов
    if (!isAdmin) {
      await checkForSounds();
    }
    
    // Синхронизируем админ-сообщение для всех пользователей
    try {
      const msgData = await apiFetch('/api/admin-message');
      const serverMessage = msgData.message || '';
      const currentMessage = adminMessageDisplay.textContent;
      
      // Обновляем только если сообщение изменилось и сейчас не редактируется
      if (serverMessage !== currentMessage && !adminMessageDisplay.classList.contains('editing')) {
        adminMessageDisplay.textContent = serverMessage;
        
        if (serverMessage.trim()) {
          document.body.classList.add('has-admin-message');
        } else {
          document.body.classList.remove('has-admin-message');
        }
        applyAdminMessageUI();
      }
    } catch (e) {
      // Игнорируем ошибки синхронизации админ-сообщения
    }
    
    // Обновляем состояние доски только если:
    // 1. Доска видима
    // 2. Нет активного перетаскивания
    // 3. Пользователь не активен последние 3 секунды
    // 4. Не админ (админы управляют состоянием сами)
    const isDragging = board.querySelector('.column.dragging, .task.dragging');
    const isUserActive = (Date.now() - lastUserActivity) < 3000;
    
    if (!board.classList.contains('hidden') && !isDragging && !isUserActive && !isAdmin) {
      await loadState();
    } else if (isDragging) {
    } else if (isUserActive) {
    } else if (isAdmin) {
    }
    
    // Обновляем календари событий если они видимы
    if (!eventsSection.classList.contains('hidden')) {
      rebuildEventsCalendar();
    }
    
  } catch (error) {
    // Не показываем ошибки автообновления пользователю
  }
}

function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  // Запускаем автообновление каждые 7.5 секунд
  autoRefreshInterval = setInterval(autoRefresh, 7500);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/* ================================================
   Настройки бегущей строки
================================================ */
function loadMarqueeConfig() {
    const saved = localStorage.getItem('marqueeConfig');
    if (saved) {
        marqueeConfig = JSON.parse(saved);
    }
}

function applyMarqueeConfig() {
    const isMarquee = marqueeConfig.enabled && adminMessageDisplay.textContent.trim();

    if (isMarquee) {
        if (!adminMessageDisplay.querySelector('.marquee-inner')) {
            const inner = document.createElement('div');
            inner.className = 'marquee-inner';
            inner.textContent = adminMessageDisplay.textContent;
            adminMessageDisplay.innerHTML = '';
            adminMessageDisplay.appendChild(inner);
        }
        adminMessageDisplay.classList.add('marquee');
        adminMessageDisplay.style.setProperty('--marquee-speed', `${marqueeConfig.speed}s`);
    } else {
        const inner = adminMessageDisplay.querySelector('.marquee-inner');
        if (inner) {
            adminMessageDisplay.textContent = inner.textContent;
        }
        adminMessageDisplay.classList.remove('marquee');
    }
}

function saveMarqueeConfig() {
    marqueeConfig.enabled = marqueeEnabledInput.checked;
    const speed = parseInt(marqueeSpeedInput.value, 10);
    if (speed > 0) {
        marqueeConfig.speed = speed;
    }
    localStorage.setItem('marqueeConfig', JSON.stringify(marqueeConfig));
    applyMarqueeConfig();
}

/* ================================================
   Модальное окно настроек таймера
================================================ */
function openSettingsModal() {
  warnInput.value = timerConfig.warnSeconds / 60;
  dangerInput.value = timerConfig.dangerSeconds / 60;
  resetCheckbox.checked = timerConfig.resetOnMove;
  marqueeEnabledInput.checked = marqueeConfig.enabled;
  marqueeSpeedInput.value = marqueeConfig.speed;
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
    saveMarqueeConfig();
    closeSettingsModal();
  } else {
    alert('Проверьте введённые значения.');
  }
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

/* ================================================
   Загрузка состояния
================================================ */
async function loadState() {
  try {
    // Проверяем, что все требуемые шаблоны существуют перед загрузкой
    if (!columnTemplate || !taskTemplate) {
      return;
    }

    const data = await apiFetch('/api/state');
    if (!data || !data.columns) {
      return;
    }

    board.innerHTML = '';

    // Создаём колонки в правильном порядке по position
    const sortedColumns = data.columns
      .sort((a, b) => (a.position || 0) - (b.position || 0)); // Сортируем по position
    
    
    sortedColumns.forEach((col) => {
      if (col && col.id && col.title) {
        createColumnDOM(col);
      } else {
      }
    });

    // Сопоставление колонки -> tasks контейнер
    const map = {};
    board.querySelectorAll('.column').forEach((colEl) => {
      const tasksContainer = colEl.querySelector('.tasks');
      if (colEl.dataset.id && tasksContainer) {
        map[colEl.dataset.id] = tasksContainer;
      }
    });

    // Размещаем задачи
    if (data.tasks && Array.isArray(data.tasks)) {
      data.tasks.forEach((task) => {
        if (!task || !task.id || !task.column_id) {
          return;
        }

        const container = map[task.column_id];
        if (container) {
          const taskDOM = createTaskDOM(task);
          if (taskDOM) container.appendChild(taskDOM);
        } else {
        }
      });
    }
    
    // Загружаем админ-сообщение из состояния
    if (data.adminMessage !== undefined) {
      adminMessageDisplay.textContent = data.adminMessage;
      // Управляем классами body для отступов
      if (data.adminMessage.trim()) {
        document.body.classList.add('has-admin-message');
      } else {
        document.body.classList.remove('has-admin-message');
      }
      applyAdminMessageUI();
    }
    
    // Применяем ограничения ролей после загрузки
    applyRoleRestrictions();
  } catch (err) {
    alert('Произошла ошибка при загрузке данных. Попробуйте перезагрузить страницу.');
  }
}

/* ================================================
   Создание новой колонки
================================================ */
addColumnBtn.addEventListener('click', async () => {
  const title = prompt('Название категории?', 'Новая категория');
  if (!title) return;
  const data = await apiFetch('/api/columns', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  createColumnDOM(data);
});

/* ======= Theme toggle ======= */
function applyStoredTheme() {
  const isDark = localStorage.getItem('dark') === '1';
  document.body.classList.toggle('dark', isDark);
  themeToggle.textContent = isDark ? '☀️' : '🌙';
}

themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('dark', isDark ? '1' : '0');
  themeToggle.textContent = isDark ? '☀️' : '🌙';
});
applyStoredTheme();
loadMarqueeConfig();
applyMarqueeConfig();

/* format date */
function formatDate(ts) {
  const d = new Date(parseInt(ts, 10));
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Функция для получения локальной даты в формате YYYY-MM-DD
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function applyRoleRestrictions() {
  const isAdminView = isAdmin === true;

  // Показываем или скрываем статические кнопки
  if (addColumnBtn) addColumnBtn.style.display = isAdminView ? '' : 'none';
  if (timerSettingsBtn) timerSettingsBtn.style.display = isAdminView ? '' : 'none';
  if (addEventBtn) addEventBtn.style.display = isAdminView ? '' : 'none';
  if (soundboardBtn) soundboardBtn.style.display = isAdminView ? '' : 'none';

  // Показываем или скрываем кнопки внутри колонок и задач
  document.querySelectorAll('.delete-column,.delete-task,.add-task').forEach(el => {
    el.style.display = isAdminView ? '' : 'none';
  });

  // Включаем или отключаем перетаскивание задач
  document.querySelectorAll('.task').forEach(t => {
    if (isAdminView) {
      t.setAttribute('draggable', 'true');
    } else {
      t.removeAttribute('draggable');
    }
  });

  // Включаем или отключаем перетаскивание колонок
  document.querySelectorAll('.column').forEach(col => {
    if (isAdminView) {
      col.setAttribute('draggable', 'true');
    } else {
      col.removeAttribute('draggable');
    }
  });

  // Добавляем/убираем класс для глобального отключения drag-n-drop листенеров
  document.body.classList.toggle('view-only', !isAdminView);
}

function showAuthedUI() {
  logoutBtn.classList.remove('hidden');
  eventsBtn.style.display = '';
  showBoardView();
  loadAdminMessage(); // This now calls applyAdminMessageUI internally
  // Always show admin message block for admin
  if (isAdmin) {
    // Add placeholder if empty
    if (!adminMessageDisplay.textContent.trim()) {
      adminMessageDisplay.textContent = '';
      adminMessageDisplay.setAttribute('placeholder', 'Нажмите для ввода сообщения администратора...');
      adminMessageDisplay.style.minHeight = '60px';
    }
  }
}
function hideAuthedUI() {
  logoutBtn.classList.add('hidden');
}

function logout() {
  stopAutoRefresh(); // Останавливаем автообновление
  localStorage.removeItem('authKey');
  authKey = '';
  isAdmin = false;

  // Очищаем доску и скрываем кнопки
  board.innerHTML = '';
  hideAuthedUI();
  showLogin();
  // Перезагружаем страницу после выхода
  window.location.reload();
}
logoutBtn.addEventListener('click', logout);

/* ================================================
   Саундборд
================================================ */

// Функция открытия/закрытия саундборда
function openSoundboard() {
  soundboardModal.classList.remove('hidden');
  if (isAdmin) {
    loadCustomSounds();
  }
}

function closeSoundboard() {
  soundboardModal.classList.add('hidden');
}

// Функция воспроизведения звука локально
function playSound(soundName, isCustom = false) {
  try {
    if (isCustom) {
      // Кастомный звук - воспроизводим аудио файл
      const audio = new Audio(`/sounds/${soundName}`);
      audio.volume = 0.7;
      audio.play().catch(error => {
      });
      return;
    }
    
    // Встроенные звуки через Web Audio API
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    
    const audioContext = new AudioContext();
    
    const sounds = {
      notification: { frequency: 800, duration: 200, type: 'sine' },
      success: { frequency: 600, duration: 300, type: 'triangle' },
      error: { frequency: 300, duration: 500, type: 'sawtooth' },
      attention: { frequency: 1000, duration: 150, type: 'square' },
      applause: { frequency: 400, duration: 1000, type: 'noise' },
      horn: { frequency: 200, duration: 800, type: 'sawtooth' },
      bell: { frequency: 880, duration: 400, type: 'sine' },
      whistle: { frequency: 1200, duration: 250, type: 'triangle' }
    };
    
    const sound = sounds[soundName];
    if (!sound) {
      return;
    }
    
    if (sound.type === 'noise') {
      // Белый шум для аплодисментов
      const bufferSize = audioContext.sampleRate * (sound.duration / 1000);
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      
      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + sound.duration / 1000);
      
      source.start();
    } else {
      // Обычные тоновые звуки
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(sound.frequency, audioContext.currentTime);
      oscillator.type = sound.type;
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + sound.duration / 1000);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + sound.duration / 1000);
    }
  } catch (error) {
  }
}

// Функция отправки звука всем viewer'ам (только для админа)
async function broadcastSound(soundName, isCustom = false) {
  if (!isAdmin) return;
  
  try {
    await apiFetch('/api/sound/broadcast', {
      method: 'POST',
      body: JSON.stringify({ 
        sound: soundName, 
        timestamp: Date.now(),
        isCustom: isCustom 
      })
    });
  } catch (err) {
  }
}

// Функция проверки новых звуковых команд (для viewer'ов)
async function checkForSounds() {
  if (isAdmin) return; // Админ не получает звуки
  
  try {
    const data = await apiFetch(`/api/sound/check?since=${lastSoundCheck}`);
    if (data.sounds && data.sounds.length > 0) {
      data.sounds.forEach(soundCommand => {
        playSound(soundCommand.sound, soundCommand.isCustom);
        lastSoundCheck = Math.max(lastSoundCheck, soundCommand.timestamp);
      });
    }
  } catch (err) {
    // Тихо игнорируем ошибки проверки звуков
  }
}

// Загрузка списка кастомных звуков
async function loadCustomSounds() {
  if (!isAdmin) return;
  
  try {
    const data = await apiFetch('/api/sounds/custom');
    customSounds = data.sounds || [];
    renderCustomSounds();
  } catch (err) {
  }
}

// Отрисовка кастомных звуков
function renderCustomSounds() {
  if (!customSoundsGrid) return;
  
  customSoundsGrid.innerHTML = '';
  
  if (customSounds.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.textContent = 'Кастомные звуки не загружены';
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = '#666';
    emptyMsg.style.fontStyle = 'italic';
    customSoundsGrid.appendChild(emptyMsg);
    return;
  }
  
  customSounds.forEach(sound => {
    const btn = document.createElement('button');
    btn.className = 'sound-btn custom-sound';
    btn.dataset.sound = sound.filename;
    btn.dataset.soundId = sound.id;
    btn.innerHTML = `🎵 ${sound.name}`;
    
    if (isAdmin) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-sound';
      deleteBtn.innerHTML = '×';
      deleteBtn.title = 'Удалить звук';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCustomSound(sound.id, sound.name);
      });
      btn.appendChild(deleteBtn);
    }
    
    customSoundsGrid.appendChild(btn);
  });
}

// Загрузка нового кастомного звука
async function uploadCustomSound() {
  const name = soundNameInput.value.trim();
  const file = soundFileInput.files[0];
  
  if (!name || !file) {
    alert('Пожалуйста, введите название и выберите файл');
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    alert('Файл слишком большой (максимум 5MB)');
    return;
  }
  
  const formData = new FormData();
  formData.append('soundName', name);
  formData.append('soundFile', file);
  
  try {
    uploadSoundBtn.disabled = true;
    uploadSoundBtn.textContent = '🔄 Загрузка...';
    
    const response = await fetch('/api/sounds/upload', {
      method: 'POST',
      headers: {
        'x-auth-key': authKey
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка загрузки');
    }
    
    // Очищаем форму
    soundNameInput.value = '';
    soundFileInput.value = '';
    
    // Перезагружаем список
    await loadCustomSounds();
    
    alert(`Звук "${name}" успешно загружен!`);
  } catch (err) {
    alert(`Ошибка загрузки: ${err.message}`);
  } finally {
    uploadSoundBtn.disabled = false;
    uploadSoundBtn.textContent = '📤 Загрузить';
  }
}

// Удаление кастомного звука
async function deleteCustomSound(soundId, soundName) {
  if (!confirm(`Удалить звук "${soundName}"?`)) return;
  
  try {
    await apiFetch(`/api/sounds/custom/${soundId}`, {
      method: 'DELETE'
    });
    
    await loadCustomSounds();
  } catch (err) {
    alert(`Ошибка удаления: ${err.message}`);
  }
}

// Обработчики событий для саундборда
soundboardBtn.addEventListener('click', openSoundboard);
closeSoundboardBtn.addEventListener('click', closeSoundboard);
uploadSoundBtn.addEventListener('click', uploadCustomSound);

// Обработчик клика по кнопкам звуков
soundboardModal.addEventListener('click', async (e) => {
  if (e.target.classList.contains('sound-btn') && !e.target.classList.contains('delete-sound')) {
    const soundName = e.target.dataset.sound;
    const isCustom = e.target.classList.contains('custom-sound');
    
    // Воспроизводим звук локально у админа
    playSound(soundName, isCustom);
    
    // Отправляем звук всем viewer'ам
    await broadcastSound(soundName, isCustom);
  }
});

// Закрытие модального окна по клику вне его
soundboardModal.addEventListener('click', (e) => {
  if (e.target === soundboardModal) closeSoundboard();
});

/* ================================================
   События - функции
================================================ */

// Загрузка событий
async function loadEvents() {
  try {
    const data = await apiFetch('/api/events');
    currentEvents = data.events || [];
  } catch (err) {
    currentEvents = [];
  }
}

/* ================================================
   Events Overview Rendering (главная страница)
================================================ */
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
  
  // Создаем диапазон ±15 дней от сегодня
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 15);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 15);
  
  const totalDays = 31; // всего 31 день (15 + 1 + 15)

  const table = document.createElement('table');
  table.className = 'admin-events-table';

  // Первая строка – номера дней
  const headerRow = document.createElement('tr');
  const currentDate = new Date(startDate);
  for (let i = 0; i < totalDays; i++) {
    const th = document.createElement('th');
    th.textContent = String(currentDate.getDate()).padStart(2, '0');
    
    // Выделяем сегодняшний день
    if (currentDate.toDateString() === today.toDateString()) {
      th.style.backgroundColor = 'var(--accent)';
      th.style.color = 'white';
      th.style.fontWeight = 'bold';
    }
    
    headerRow.appendChild(th);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  table.appendChild(headerRow);

  // Вторая строка – содержимое
  const dataRow = document.createElement('tr');
  const dateIterator = new Date(startDate);
  
  for (let i = 0; i < totalDays; i++) {
    const td = document.createElement('td');
    const isWeekendOrHol = isWeekendOrHoliday(dateIterator);
    const isHoliday = isRussianHoliday(dateIterator);
    
    let dayEvents = currentEvents.filter(ev => 
      ev.date === toLocalDateString(dateIterator)
    );
    
    if (dayEvents.length) {
      td.textContent = dayEvents[0].title;
      if (isHoliday) {
        td.classList.add('color-red');
      } else if (isWeekendOrHol) {
        td.classList.add('weekend');
      }
    } else if (isHoliday) {
      td.classList.add('color-red');
      td.textContent = '🎉';
    } else if (isWeekendOrHol) {
      td.classList.add('weekend');
      td.textContent = '*';
    }

    // контекстное меню
    td.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCellContextMenu(e.pageX, e.pageY, td, toLocalDateString(dateIterator));
    });

    dataRow.appendChild(td);
    dateIterator.setDate(dateIterator.getDate() + 1);
  }
  table.appendChild(dataRow);
  eventsOverview.appendChild(table);
}

let userEventsStart = 0;
function renderUserEventsList() {
  if(eventsOverview) eventsOverview.innerHTML='';
  const container=document.createElement('div');
  container.className='user-events-container';
  const viewport=document.createElement('div');
  viewport.className='user-events-viewport';

  // Получаем все будущие события
  const upcoming=[...currentEvents]
    .filter(ev=> new Date(ev.date + 'T00:00:00') >= new Date().setHours(0,0,0,0))
    .sort((a,b)=>a.date.localeCompare(b.date));

  const prevBtn=document.createElement('button');
  prevBtn.className='events-nav prev';
  prevBtn.textContent='◀';
  const nextBtn=document.createElement('button');
  nextBtn.className='events-nav next';
  nextBtn.textContent='▶';
  const STEP=2;
  prevBtn.addEventListener('click',()=>{userEventsStart=Math.max(0,userEventsStart-STEP); renderUserEventsList();});
  nextBtn.addEventListener('click',()=>{userEventsStart=Math.min(upcoming.length-12, userEventsStart+STEP); renderUserEventsList();});

  const track=document.createElement('div');
  track.className='user-events-list';

  if (!upcoming.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Ближайших событий нет';
    empty.style.textAlign = 'center';
    empty.style.padding = '20px';
    empty.style.color = 'var(--text)';
    container.appendChild(empty);
    eventsOverview.appendChild(container);
    return;
  } 
  
  upcoming.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'user-events-item';
    const dateEl = document.createElement('div');
    dateEl.className = 'evt-date';
    dateEl.textContent = new Date(ev.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const titleEl = document.createElement('div');
    titleEl.className='evt-title';
    titleEl.textContent = ev.title;
    item.appendChild(dateEl);
    item.appendChild(titleEl);
    track.appendChild(item);
  });
  
  viewport.appendChild(track);
  container.appendChild(prevBtn);
  container.appendChild(viewport);
  container.appendChild(nextBtn);
  eventsOverview.appendChild(container);

  let colWidth;
  const visibleCols=6;
  function ensureColWidth(){
    if(colWidth) return;
    const card=track.querySelector('.user-events-item');
    if(card) colWidth=card.offsetWidth+8; // gap
  }
  const step=1; // one column
  let currentCol=0;
  function updateNav(){
    prevBtn.disabled=currentCol===0;
    const totalCols=Math.ceil(upcoming.length/2);
    nextBtn.disabled=currentCol+visibleCols>=totalCols;
  }
  function slide(dir){
    ensureColWidth();
    const totalCols=Math.ceil(upcoming.length/2);
    currentCol=Math.min(Math.max(0,currentCol+dir), totalCols-visibleCols);
    track.style.transform=`translateX(${-currentCol*colWidth}px)`;
    updateNav();
  }
  prevBtn.addEventListener('click',()=>slide(-step));
  nextBtn.addEventListener('click',()=>slide(step));
  ensureColWidth();
  updateNav();
}

/* =========== контекстное меню для ячеек =========== */
function showCellContextMenu(x, y, cell, dateStr = null) {
  hideContextMenu();
  contextMenuEl = document.createElement('div');
  contextMenuEl.style.position = 'absolute';
  contextMenuEl.style.left = x + 'px';
  contextMenuEl.style.top = y + 'px';
  contextMenuEl.style.background = 'var(--card-bg)';
  contextMenuEl.style.border = '1px solid var(--border)';
  contextMenuEl.style.borderRadius = '4px';
  contextMenuEl.style.zIndex = 2000;
  contextMenuEl.style.minWidth = '120px';
  const options = [
    { label: '🟩 Зелёный', action: () => toggleCellColor(cell, 'color-green') },
    { label: '🟥 Красный', action: () => toggleCellColor(cell, 'color-red') },
    { label: '✏️ Редактировать', action: () => editCellEvent(cell, dateStr) },
    { label: '❌ Очистить', action: () => clearCell(cell) },
  ];
  options.forEach(opt => {
    const div = document.createElement('div');
    div.textContent = opt.label;
    div.style.padding = '6px 8px';
    div.style.cursor = 'pointer';
    div.addEventListener('mouseover', () => div.style.background = 'var(--bg)');
    div.addEventListener('mouseout', () => div.style.background = '');
    div.addEventListener('click', () => { opt.action(); hideContextMenu(); });
    contextMenuEl.appendChild(div);
  });
  document.body.appendChild(contextMenuEl);
  document.addEventListener('click', hideContextMenu, { once: true });
}

function hideContextMenu() { if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; } }
function toggleCellColor(cell, cls) { cell.classList.toggle(cls); }
function clearCell(cell) { cell.classList.remove('color-green','color-red'); cell.textContent=''; }
function editCellEvent(cell, dateStr = null) {
  if (dateStr) {
    // Если дата передана напрямую, используем её
    openAddEventModal(dateStr);
  } else {
    // Старая логика для обратной совместимости
    const row = cell.parentElement;
    if (!row || !row.previousSibling) return;
    const day = Array.from(row.children).indexOf(cell) + 1;
    if (!day) return;
    const today = new Date();
    const calculatedDateStr = toLocalDateString(new Date(today.getFullYear(), today.getMonth(), day));
    openAddEventModal(calculatedDateStr);
  }
}

// Переключение между доской и событиями
function showEventsView() {
  // расширенный календарь на 3 месяца
  board.classList.add('hidden');
  eventsSection.classList.remove('hidden');
  loadEvents().then(()=>{
    eventsCalendar.innerHTML='';
    const offsets=[-1,0,1];
    offsets.forEach(off=>{
      const wrapper=document.createElement('div');
      wrapper.style.marginBottom='32px';
      eventsCalendar.appendChild(wrapper);
      renderEventsCalendar(wrapper,off);
    });
  });
}

// пересборка трёхмесячного календаря
function rebuildEventsCalendar(){
  if(!eventsCalendar || document.querySelector('.calendar-day.expanded')) return; // Не перестраивать, если ячейка увеличена
  eventsCalendar.innerHTML='';
  [-1,0,1].forEach(off=>{
    const wrapper=document.createElement('div');
    wrapper.style.marginBottom='32px';
    eventsCalendar.appendChild(wrapper);
    renderEventsCalendar(wrapper,off);
  });
}

// новая сигнатура: parent element + month offset
function renderEventsCalendar(parentEl, offset=0){
  const today=new Date();
  const baseMonth=new Date(today.getFullYear(), today.getMonth()+offset,1);
  const currentMonth=baseMonth.getMonth();
  const currentYear=baseMonth.getFullYear();
  const monthName=baseMonth.toLocaleString('ru-RU',{month:'long', year:'numeric'});
  const title=document.createElement('h3');
  title.textContent=monthName;
  parentEl.appendChild(title);

  const calendarGrid=document.createElement('div');
  calendarGrid.className='events-calendar';
  parentEl.appendChild(calendarGrid);

  // Логика генерации месячного календаря
  const firstDay=new Date(currentYear,currentMonth,1);
  const lastDay=new Date(currentYear,currentMonth+1,0);
  const startDate=new Date(firstDay);
  startDate.setDate(startDate.getDate()-(firstDay.getDay()===0?6:firstDay.getDay()-1));
  const endDate=new Date(lastDay);
  endDate.setDate(endDate.getDate()+(7-lastDay.getDay())%7);

  // Заголовки дней недели
  const dayHeaders=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  dayHeaders.forEach(d=>{
    const h=document.createElement('div');
    h.className='calendar-header';
    h.textContent=d;
    h.style.fontWeight = 'bold';
    h.style.padding = '8px';
    h.style.backgroundColor = 'var(--accent)';
    h.style.color = 'white';
    h.style.textAlign = 'center';
    calendarGrid.appendChild(h);
  });

  const cur=new Date(startDate);
  while(cur<=endDate){
     const dayEl=createCalendarDay(new Date(cur), currentMonth); // Передаем копию даты
     calendarGrid.appendChild(dayEl);
     cur.setDate(cur.getDate()+1);
   }
}

function showBoardView() {
  eventsSection.classList.add('hidden');
  board.classList.remove('hidden');
}

// Функция определения российских праздников
function isRussianHoliday(date) {
  const month = date.getMonth() + 1; // JavaScript месяцы начинаются с 0
  const day = date.getDate();
  const year = date.getFullYear();
  
  // Фиксированные праздники
  const fixedHolidays = [
    { month: 1, day: 1 },   // Новый год
    { month: 1, day: 2 },   // Новогодние каникулы
    { month: 1, day: 3 },   // Новогодние каникулы
    { month: 1, day: 4 },   // Новогодние каникулы
    { month: 1, day: 5 },   // Новогодние каникулы
    { month: 1, day: 6 },   // Новогодние каникулы
    { month: 1, day: 7 },   // Рождество Христово
    { month: 1, day: 8 },   // Новогодние каникулы
    { month: 2, day: 23 },  // День защитника Отечества
    { month: 3, day: 8 },   // Международный женский день
    { month: 5, day: 1 },   // Праздник Весны и Труда
    { month: 5, day: 9 },   // День Победы
    { month: 6, day: 12 },  // День России
    { month: 11, day: 4 },  // День народного единства
  ];
  
  // Проверяем фиксированные праздники
  for (const holiday of fixedHolidays) {
    if (month === holiday.month && day === holiday.day) {
      return true;
    }
  }
  
  // Переходящие праздники (примерные даты для ближайших лет)
  // Пасха и связанные с ней праздники рассчитываются сложно, 
  // здесь упрощенная версия для основных дат
  
  return false;
}

// Функция определения выходных дней (суббота, воскресенье + праздники)
function isWeekendOrHoliday(date) {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6 || isRussianHoliday(date);
}



// Создание элемента дня календаря
function createCalendarDay(date, currentMonth) {
  const dayEl = document.createElement('div');
  dayEl.className = 'calendar-day';
  dayEl.dataset.date = toLocalDateString(date);

  const isCurrentMonth = date.getMonth() === currentMonth;
  const isToday = date.toDateString() === new Date().toDateString();
  const isWeekendOrHol = isWeekendOrHoliday(date);
  const isHoliday = isRussianHoliday(date);

  if (!isCurrentMonth) {
    dayEl.classList.add('other-month');
  }
  
  if (isToday) {
    dayEl.classList.add('today');
  }
  
  // Добавляем класс для выходных и праздников
  if (isWeekendOrHol) {
    dayEl.classList.add('weekend-or-holiday');
  }
  
  // Специальный класс для государственных праздников
  if (isHoliday) {
    dayEl.classList.add('russian-holiday');
  }

  // Номер дня
  const dayNumber = document.createElement('div');
  dayNumber.className = 'day-number';
  dayNumber.textContent = date.getDate();
  
  // Добавляем индикатор праздника только для текущего месяца
  if (isCurrentMonth) {
    if (isHoliday) {
      dayNumber.textContent += ' 🎉';
    } else if (isWeekendOrHol) {
      dayNumber.textContent += ' 🏠';
    }
  }
  
  dayEl.appendChild(dayNumber);

  // Контейнер для событий
  const eventsContainer = document.createElement('div');
  eventsContainer.className = 'day-events';

  // Находим события для этого дня
  const dateStr = toLocalDateString(date);
  const dayEvents = currentEvents.filter(event => event.date === dateStr);

  dayEvents.forEach(event => {
    const eventEl = document.createElement('div');
    eventEl.className = 'event-item';
    if (isAdmin) {
      eventEl.classList.add('admin-mode');
    }
    eventEl.textContent = event.title;
    eventEl.title = event.description || event.title;

    if (isAdmin) {
      eventEl.addEventListener('click', () => openEditEventModal(event));
    }

    eventsContainer.appendChild(eventEl);
  });

  // Кнопка добавления события (только для админа и только для дней текущего месяца)
  if (isAdmin && isCurrentMonth) {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-event-day';
    addBtn.textContent = '+ Событие';
    addBtn.addEventListener('click', () => openAddEventModal(dateStr));
    eventsContainer.appendChild(addBtn);
  }

  dayEl.appendChild(eventsContainer);

  // Expand cell on click
  dayEl.addEventListener('click', (e) => {
    if (e.target.closest('.event-item, .add-event-day')) {
      return; // Don't expand if clicking on an event or add button
    }
    showExpandedDayView(dayEl.dataset.date);
  });

  return dayEl;
}

// Overlay for modals and expanded views
const overlay = document.createElement('div');
overlay.className = 'overlay';
document.body.appendChild(overlay);

function showExpandedDayView(dateStr) {
  stopAutoRefresh();
  
  const date = new Date(dateStr + 'T00:00:00');
  const dayEvents = currentEvents.filter(event => event.date === dateStr);
  
  // Format date for header
  const headerDate = date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  let eventsHTML = '';
  if (dayEvents.length > 0) {
    eventsHTML = dayEvents.map(event => `
      <div class="expanded-event-item" data-event-id="${event.id}" ${isAdmin ? 'title="Нажмите для редактирования"' : ''}>
        <div class="expanded-event-title">${event.title}</div>
        ${event.description ? `<div class="expanded-event-desc">${event.description}</div>` : ''}
      </div>
    `).join('');
  } else {
    eventsHTML = '<div class="expanded-event-empty">На этот день событий нет.</div>';
  }
  
  let adminControls = '';
  if (isAdmin) {
    adminControls = `<button class="add-event-expanded-view">+ Добавить событие</button>`;
  }

  expandedDayView.innerHTML = `
    <div class="expanded-day-header">
      <h2>${headerDate}</h2>
      <button class="close-expanded-view">&times;</button>
    </div>
    <div class="expanded-day-content">
      ${eventsHTML}
    </div>
    <div class="expanded-day-footer">
      ${adminControls}
    </div>
  `;
  
  expandedDayView.classList.add('visible');
  overlay.classList.add('active');
  
  // Add event listeners
  expandedDayView.querySelector('.close-expanded-view').addEventListener('click', hideExpandedDayView);
  overlay.addEventListener('click', hideExpandedDayView, { once: true });
  
  if (isAdmin) {
    expandedDayView.querySelector('.add-event-expanded-view')?.addEventListener('click', () => {
      hideExpandedDayView();
      openAddEventModal(dateStr);
    });
    
    // Add click listener for editing events
    expandedDayView.querySelectorAll('.expanded-event-item').forEach(item => {
      item.addEventListener('click', () => {
        const eventId = parseInt(item.dataset.eventId, 10);
        const event = currentEvents.find(e => e.id === eventId);
        if (event) {
          hideExpandedDayView();
          openEditEventModal(event);
        }
      });
    });
  }
}

function hideExpandedDayView() {
  if (!expandedDayView.classList.contains('visible')) return;

  expandedDayView.classList.remove('visible');
  overlay.classList.remove('active');
  
  // Clear content after transition to prevent seeing old data on next open
  setTimeout(() => {
    expandedDayView.innerHTML = '';
  }, 300); // Should match CSS transition duration
  
  startAutoRefresh();
}

// Открытие модального окна для добавления события
function openAddEventModal(date = '') {
  editingEventId = null;
  eventModalTitle.textContent = 'Добавить событие';
  eventDate.value = date;
  eventTitle.value = '';
  eventDescription.value = '';
  deleteEventBtn.classList.add('hidden'); // Скрываем кнопку удаления при добавлении
  eventModal.classList.remove('hidden');
}

// Открытие модального окна для редактирования события
function openEditEventModal(event) {
  editingEventId = event.id;
  eventModalTitle.textContent = 'Редактировать событие';
  eventDate.value = event.date;
  eventTitle.value = event.title;
  eventDescription.value = event.description || '';
  deleteEventBtn.classList.remove('hidden'); // Показываем кнопку удаления при редактировании
  eventModal.classList.remove('hidden');
}

// Закрытие модального окна события
function closeEventModal() {
  eventModal.classList.add('hidden');
  editingEventId = null;
}

// Сохранение события
async function saveEvent() {
  const date = eventDate.value;
  const title = eventTitle.value.trim();
  const description = eventDescription.value.trim();

  if (!date || !title) {
    alert('Пожалуйста, заполните дату и название события.');
    return;
  }

  try {
    if (editingEventId) {
      // Редактирование
      await apiFetch(`/api/events/${editingEventId}`, {
        method: 'PUT',
        body: JSON.stringify({ date, title, description }),
      });
    } else {
      // Добавление
      await apiFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify({ date, title, description }),
      });
    }

    closeEventModal();
    await loadEvents();
    rebuildEventsCalendar();
    renderEventsOverview();
  } catch (err) {
    alert('Произошла ошибка при сохранении события.');
  }
}

// Удаление события
async function deleteEvent(eventId) {
  if (!confirm('Удалить это событие?')) return;

  try {
    await apiFetch(`/api/events/${eventId}`, { method: 'DELETE' });
    await loadEvents();
    rebuildEventsCalendar();
    renderEventsOverview();
  } catch (err) {
    alert('Произошла ошибка при удалении события.');
  }
}

/* ================================================
   События - обработчики
================================================ */

eventsBtn.addEventListener('click', showEventsView);
backToBoardBtn.addEventListener('click', showBoardView);
addEventBtn.addEventListener('click', () => openAddEventModal());
saveEventBtn.addEventListener('click', saveEvent);
deleteEventBtn.addEventListener('click', async () => {
  if (editingEventId && confirm('Удалить это событие?')) {
    await deleteEvent(editingEventId);
    closeEventModal();
  }
});
cancelEventBtn.addEventListener('click', closeEventModal);

// Закрытие модального окна по клику вне его
eventModal.addEventListener('click', (e) => {
  if (e.target === eventModal) closeEventModal();
});

// Обработка Enter в полях формы
eventTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveEvent();
});

// Добавляем контекстное меню для удаления событий (только для админа)
document.addEventListener('contextmenu', (e) => {
  if (!isAdmin) return;

  const eventItem = e.target.closest('.event-item');
  if (eventItem) {
    e.preventDefault();
    const eventTitle = eventItem.textContent;
    const event = currentEvents.find(ev => ev.title === eventTitle);
    if (event && confirm(`Удалить событие "${event.title}"?`)) {
      deleteEvent(event.id);
    }
  }
});

// Загрузка и отображение admin-сообщения
async function loadAdminMessage() {
  try {
    // Загружаем сообщение с сервера
    const data = await apiFetch('/api/admin-message');
    const msg = data.message || '';
    adminMessageDisplay.textContent = msg;
    
    // Управляем классами body для отступов
    if (msg.trim()) {
      document.body.classList.add('has-admin-message');
    } else {
      document.body.classList.remove('has-admin-message');
    }
    
    // Apply UI logic after loading message
    applyAdminMessageUI();
  } catch (e) {
    // Fallback to localStorage if server request fails
    const msg = localStorage.getItem('adminMessage') || '';
    adminMessageDisplay.textContent = msg;
    
    if (msg.trim()) {
      document.body.classList.add('has-admin-message');
    } else {
      document.body.classList.remove('has-admin-message');
    }
    
    applyAdminMessageUI();
  }
}

// Показываем или скрываем админский ввод
function applyAdminMessageUI() {
  // Admin edits inline in display
  if (isAdmin) {
    // Make display editable and always visible for admin
    adminMessageDisplay.setAttribute('contenteditable', 'true');
    adminMessageDisplay.classList.add('admin-editable');
    adminMessageDisplay.style.display = 'block';
  } else {
    adminMessageDisplay.removeAttribute('contenteditable');
    adminMessageDisplay.classList.remove('admin-editable');
    // For non-admin: show if there's content, hide if empty
    const inner = adminMessageDisplay.querySelector('.marquee-inner');
    const hasContent = (inner || adminMessageDisplay).textContent.trim();
    adminMessageDisplay.style.display = hasContent ? 'block' : 'none';
  }
  applyMarqueeConfig();
}

// Сохранение admin-сообщения
// Remove manual save button handler
// saveAdminMessageBtn.addEventListener('click', ...);

// Debounced inline save when admin stops typing
let adminSaveTimeout;
adminMessageDisplay.addEventListener('input', () => {
  clearTimeout(adminSaveTimeout);
  adminMessageDisplay.classList.add('editing');
  adminSaveTimeout = setTimeout(async () => {
    const msg = adminMessageDisplay.textContent.trim();
    
    try {
      // Сохраняем на сервере
      await apiFetch('/api/admin-message', {
        method: 'PUT',
        body: JSON.stringify({ message: msg })
      });
      
      // Также сохраняем в localStorage как fallback
      localStorage.setItem('adminMessage', msg);
      
      // Update body padding
      if (msg) document.body.classList.add('has-admin-message');
      else document.body.classList.remove('has-admin-message');
      
      adminMessageDisplay.classList.remove('editing');
      // Update UI visibility
      applyAdminMessageUI();
    } catch (e) {
      // Если ошибка сервера, сохраняем только в localStorage
      localStorage.setItem('adminMessage', msg);
      
      if (msg) document.body.classList.add('has-admin-message');
      else document.body.classList.remove('has-admin-message');
      
      adminMessageDisplay.classList.remove('editing');
      applyAdminMessageUI();
    }
  }, 1000);
});

// Скрыть основной UI до авторизации
board.classList.add('hidden');
eventsSection.classList.add('hidden');
addColumnBtn.style.display = 'none';
timerSettingsBtn.style.display = 'none';
eventsBtn.style.display = 'none';
soundboardBtn.style.display = 'none';
