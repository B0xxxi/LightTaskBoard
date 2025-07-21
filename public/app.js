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
const cancelEventBtn = document.getElementById('cancelEvent');

let currentEvents = [];
let editingEventId = null;

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

async function attemptLogin(key) {
  // после успешного логина позже вызовем загрузку событий и отрисовку

  try {
    const resp = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ key }),
      headers: { 'Content-Type': 'application/json' },
    });
    authKey = key;
    localStorage.setItem('authKey', key);
    isAdmin = resp.role === 'admin';
      await loadEvents();
      renderEventsOverview();
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
  if (addEventBtn) addEventBtn.style.display = isAdminView ? '' : 'none';

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

/* ================================================
   События - функции
================================================ */

// Загрузка событий
async function loadEvents() {
  try {
    const data = await apiFetch('/api/events');
    currentEvents = data.events || [];
  } catch (err) {
    console.error('Ошибка при загрузке событий:', err);
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
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const table = document.createElement('table');
  table.className = 'admin-events-table';

  // Первая строка – номера
  const headerRow = document.createElement('tr');
  for (let d = 1; d <= daysInMonth; d++) {
    const th = document.createElement('th');
    th.textContent = String(d).padStart(2, '0');
    headerRow.appendChild(th);
  }
  table.appendChild(headerRow);

  // Вторая строка – содержимое (звёздочки на выходные)
  const dataRow = document.createElement('tr');
  for (let d = 1; d <= daysInMonth; d++) {
    const td = document.createElement('td');
    const dateObj = new Date(year, month, d);
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
    let dayEvents = currentEvents.filter(ev=>ev.date===new Date(year,month,d).toISOString().split('T')[0]);
    if(dayEvents.length){
      td.textContent=dayEvents[0].title;
    } else if(isWeekend){
      td.classList.add('weekend');
      td.textContent='*';
    }

    // контекстное меню
    td.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCellContextMenu(e.pageX, e.pageY, td);
    });

    dataRow.appendChild(td);
  }
  table.appendChild(dataRow);
  eventsOverview.appendChild(table);
}

let userEventsPage=0;
function renderUserEventsList() {
  if(eventsOverview) eventsOverview.innerHTML='';
  const container=document.createElement('div');
  container.className='user-events-container';
  const viewport=document.createElement('div');
  viewport.className='user-events-viewport';

  const prevBtn=document.createElement('button');
  prevBtn.className='events-nav prev';
  prevBtn.textContent='◀';
  const nextBtn=document.createElement('button');
  nextBtn.className='events-nav next';
  nextBtn.textContent='▶';
  const STEP=2;
  prevBtn.addEventListener('click',()=>{userEventsStart=Math.max(0,userEventsStart-STEP); renderUserEventsList();});
  nextBtn.addEventListener('click',()=>{userEventsStart=Math.min(upcomingAll.length-12, userEventsStart+STEP); renderUserEventsList();});

  const track=document.createElement('div');
  track.className='user-events-list';

  const upcoming=[...currentEvents]
    .filter(ev=> new Date(ev.date)>=new Date())
    .sort((a,b)=>a.date.localeCompare(b.date));

  if (!upcoming.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Ближайших событий нет';
    wrapper.appendChild(empty);
  } else {
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
  }
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
function showCellContextMenu(x, y, cell) {
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
    { label: '✏️ Редактировать', action: () => editCellEvent(cell) },
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
function editCellEvent(cell) {
  const row = cell.parentElement;
  if (!row || !row.previousSibling) return;
  const day = Array.from(row.children).indexOf(cell) + 1;
  if (!day) return;
  const today = new Date();
  const dateStr = new Date(today.getFullYear(), today.getMonth(), day).toISOString().split('T')[0];
  openAddEventModal(dateStr);
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
  if(!eventsCalendar) return;
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

  // далее старая логика генерации дней, но в grid calendarGrid
  const firstDay=new Date(currentYear,currentMonth,1);
  const lastDay=new Date(currentYear,currentMonth+1,0);
  const startDate=new Date(firstDay);
  startDate.setDate(startDate.getDate()-(firstDay.getDay()===0?6:firstDay.getDay()-1));
  const endDate=new Date(lastDay);
  endDate.setDate(endDate.getDate()+(7-lastDay.getDay())%7);
  const dayHeaders=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  dayHeaders.forEach(d=>{
    const h=document.createElement('div');
    h.className='calendar-header';
    h.textContent=d;
    calendarGrid.appendChild(h);
  });
  const cur=new Date(startDate);
  while(cur<=endDate){
     const dayEl=createCalendarDay(cur,currentMonth);
     calendarGrid.appendChild(dayEl);
     cur.setDate(cur.getDate()+1);
   }
}

function showBoardView() {
  eventsSection.classList.add('hidden');
  board.classList.remove('hidden');
}



// Создание элемента дня календаря
function createCalendarDay(date, currentMonth) {
  const dayEl = document.createElement('div');
  dayEl.className = 'calendar-day';

  const isCurrentMonth = date.getMonth() === currentMonth;
  const isToday = date.toDateString() === new Date().toDateString();

  if (!isCurrentMonth) {
    dayEl.classList.add('other-month');
  }
  if (isToday) {
    dayEl.classList.add('today');
  }

  // Номер дня
  const dayNumber = document.createElement('div');
  dayNumber.className = 'day-number';
  dayNumber.textContent = date.getDate();
  dayEl.appendChild(dayNumber);

  // Контейнер для событий
  const eventsContainer = document.createElement('div');
  eventsContainer.className = 'day-events';

  // Находим события для этого дня
  const dateStr = date.toISOString().split('T')[0];
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

  // Кнопка добавления события (только для админа)
  if (isAdmin && isCurrentMonth) {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-event-day';
    addBtn.textContent = '+ Событие';
    addBtn.addEventListener('click', () => openAddEventModal(dateStr));
    eventsContainer.appendChild(addBtn);
  }

  dayEl.appendChild(eventsContainer);
  return dayEl;
}

// Открытие модального окна для добавления события
function openAddEventModal(date = '') {
  editingEventId = null;
  eventModalTitle.textContent = 'Добавить событие';
  eventDate.value = date;
  eventTitle.value = '';
  eventDescription.value = '';
  eventModal.classList.remove('hidden');
}

// Открытие модального окна для редактирования события
function openEditEventModal(event) {
  editingEventId = event.id;
  eventModalTitle.textContent = 'Редактировать событие';
  eventDate.value = event.date;
  eventTitle.value = event.title;
  eventDescription.value = event.description || '';
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
    console.error('Ошибка при сохранении события:', err);
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
    console.error('Ошибка при удалении события:', err);
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
