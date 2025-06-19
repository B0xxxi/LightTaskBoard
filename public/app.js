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
  console.error('Критическая ошибка: шаблоны не найдены');
  alert('Не удалось загрузить шаблоны. Перезагрузите страницу.');
}

// Модальные окна
const settingsModal = document.getElementById('settingsModal');
const warnInput = document.getElementById('warnMinutes');
const dangerInput = document.getElementById('dangerMinutes');
const resetCheckbox = document.getElementById('resetOnMove');
const saveSettingsBtn = document.getElementById('saveSettings');
const closeSettingsBtn = document.getElementById('closeSettings');

const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const fileDrop = document.getElementById('fileDrop');
const keyFileInput = document.getElementById('keyFileInput');
const themeToggle = document.getElementById('themeToggle');

const logoutBtn = document.getElementById('logoutBtn');

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

/* ================================================
   Авторизация
================================================ */
let authKey = localStorage.getItem('authKey') || '';
let isAdmin = false;

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

async function attemptLogin(key) {
  try {
    const resp = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ key }),
      headers: { 'Content-Type': 'application/json' },
    });
    authKey = key;
    localStorage.setItem('authKey', key);
    isAdmin = resp.role === 'admin';
    hideLogin();
    await loadState();
    applyRoleRestrictions();
    showAuthedUI();
  } catch (e) {
    console.error('login-error', e);
    localStorage.removeItem('authKey');
    authKey='';
    alert('Неверный пароль или ключ.');
  }
}

function showLogin() {
  loginModal.classList.remove('hidden');
}
function hideLogin() {
  loginModal.classList.add('hidden');
}

loginBtn.addEventListener('click', () => {
  const key = passwordInput.value.trim();
  attemptLogin(key);
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
  const file = e.dataTransfer.files[0];
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
  attemptLogin(authKey);
} else {
  showLogin();
}

/* ================================================
   Работа с колонками
================================================ */
function createColumnDOM({ id, title }) {
  try {
    if (!columnTemplate || !columnTemplate.content) {
      console.error('Критическая ошибка: Шаблон колонки (columnTemplate) не найден или пуст.');
      return null;
    }

    // Дополнительная отладка: что внутри шаблона?
    console.log('Отладка шаблона колонки:', columnTemplate.innerHTML);


    const columnClone = columnTemplate.content.cloneNode(true);
    const columnEl = columnClone.querySelector('.column');
    
    if (!columnEl) {
      console.error('Не удалось найти элемент ".column" в клоне шаблона.', columnClone);
      // Попробуем найти его другим способом для отладки
      const childNodes = Array.from(columnClone.childNodes).map(n => n.nodeName);
      console.log('Дочерние узлы в клоне:', childNodes);
      return null;
    }

    const titleEl = columnClone.querySelector('.column-title');
    const deleteBtn = columnClone.querySelector('.delete-column');
    const addTaskBtn = columnClone.querySelector('.add-task');
    const tasksContainer = columnClone.querySelector('.tasks');
    
    if (!titleEl || !deleteBtn || !addTaskBtn || !tasksContainer) {
      console.error('Структура шаблона колонки некорректна, один из элементов не найден');
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

    // Возвращаем созданный элемент для единообразия
    return columnEl;

  } catch (error) {
    console.error('Ошибка при создании DOM элемента колонки:', error);
    return null;
  }
}

/* ================================================
   Работа с задачами
================================================ */
function createTaskDOM({ id, title, created_at }) {
  try {
    if (!taskTemplate) {
      console.error('Шаблон задачи не инициализирован');
      return null;
    }

    const taskClone = taskTemplate.content.cloneNode(true);
    const taskEl = taskClone.querySelector('.task');
    if (!taskEl) {
      console.error('Структура шаблона задачи некорректна');
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
          console.error('Ошибка при обновлении задачи:', err);
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
    console.error('Ошибка при создании DOM элемента задачи:', error);
    return null;
  }
}

/* ================================================
   Drag & Drop логика
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
   Модальное окно настроек таймера
================================================ */
function openSettingsModal() {
  warnInput.value = timerConfig.warnSeconds / 60;
  dangerInput.value = timerConfig.dangerSeconds / 60;
  resetCheckbox.checked = timerConfig.resetOnMove;
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
      console.error('Шаблоны не инициализированы. Отмена загрузки состояния.');
      return;
    }

    const data = await apiFetch('/api/state');
    if (!data || !data.columns) {
      console.error('Неверные данные от API:', data);
      return;
    }

    board.innerHTML = '';
    
    // Создаём колонки
    data.columns.forEach((col) => {
      if (col && col.id && col.title) {
        createColumnDOM(col);
      } else {
        console.warn('Пропущена колонка с недопустимыми данными:', col);
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
          console.warn('Пропущена задача с недопустимыми данными:', task);
          return;
        }
        
        const container = map[task.column_id];
        if (container) {
          const taskDOM = createTaskDOM(task);
          if (taskDOM) container.appendChild(taskDOM);
        } else {
          console.warn(`Контейнер для колонки ${task.column_id} не найден`);
        }
      });
    }
  } catch (err) {
    console.error('Ошибка при загрузке состояния:', err);
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

/* format date */
function formatDate(ts) {
  const d = new Date(parseInt(ts, 10));
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function applyRoleRestrictions() {
  const isAdminView = isAdmin === true;

  // Показываем или скрываем статические кнопки
  if (addColumnBtn) addColumnBtn.style.display = isAdminView ? '' : 'none';
  if (timerSettingsBtn) timerSettingsBtn.style.display = isAdminView ? '' : 'none';

  // Показываем или скрываем кнопки внутри колонок и задач
  document.querySelectorAll('.delete-column,.delete-task,.add-task').forEach(el => {
    el.style.display = isAdminView ? '' : 'none';
  });

  // Включаем или отключаем перетаскивание
  document.querySelectorAll('.task').forEach(t => {
    if (isAdminView) {
      t.setAttribute('draggable', 'true');
    } else {
      t.removeAttribute('draggable');
    }
  });

  // Добавляем/убираем класс для глобального отключения drag-n-drop листенеров
  document.body.classList.toggle('view-only', !isAdminView);
}

function showAuthedUI() {
  logoutBtn.classList.remove('hidden');
}
function hideAuthedUI() {
  logoutBtn.classList.add('hidden');
}

function logout() {
  localStorage.removeItem('authKey');
  authKey = '';
  isAdmin = false;
  
  // Очищаем доску и скрываем кнопки
  board.innerHTML = '';
  hideAuthedUI();
  showLogin();
}
logoutBtn.addEventListener('click', logout); 