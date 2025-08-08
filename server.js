const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config();
const { db } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Загрузка паролей и ключей ---
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
let VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || 'viewer';

// --- Promise-обёртки для базы данных ---
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// --- Хелперы ---
function determineRole(key) {
  const k = key ? String(key).trim() : '';
  if (k && ADMIN_PASSWORD && k === String(ADMIN_PASSWORD).trim()) return 'admin';
  if (k && VIEWER_PASSWORD && k === String(VIEWER_PASSWORD).trim()) return 'viewer';
  return null;
}

// --- Получение полного состояния приложения ---
async function getFullState() {
  const columns = await all('SELECT * FROM columns ORDER BY position, id');
  const tasks = await all('SELECT * FROM tasks ORDER BY position, id');
  const events = await all('SELECT * FROM events ORDER BY date');
  const adminMessageRow = await get('SELECT message FROM admin_message WHERE id = 1');
  const marqueeConfigRow = await get("SELECT value FROM settings WHERE key = 'marqueeConfig'");
  const customSounds = await all('SELECT id, name, filename, original_name FROM custom_sounds ORDER BY name');

  const adminMessage = adminMessageRow ? adminMessageRow.message : '';
  const marqueeConfig = marqueeConfigRow ? JSON.parse(marqueeConfigRow.value) : { enabled: false, speed: 15 };

  return { columns, tasks, events, adminMessage, marqueeConfig, customSounds };
}

// --- Middleware для Socket.io ---
io.use((socket, next) => {
  const key = socket.handshake.auth.token;
  const role = determineRole(key);
  if (role) {
    socket.role = role;
    next();
  } else {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  console.log(`A user connected with role: ${socket.role}`);

  // --- Начальная отправка состояния ---
  getFullState()
    .then(state => {
      socket.emit('state:initial', { ...state, role: socket.role });
    })
    .catch(err => socket.emit('error', { message: 'Failed to get initial state', details: err.message }));

  // --- Общая функция для трансляции обновлений ---
  async function broadcastStateUpdate() {
    try {
      const state = await getFullState();
      io.emit('state:updated', state);
    } catch (err) {
      console.error('Failed to broadcast state update:', err);
      io.emit('error', { message: 'Failed to broadcast state update' });
    }
  }

  // --- Middleware для проверки прав администратора ---
  function requireAdmin(handler) {
    return (payload, callback) => {
      if (socket.role !== 'admin') {
        return callback?.({ error: 'forbidden' });
      }
      return handler(payload, callback);
    };
  }

  // --- Обработчики событий ---

  // --- Колонки ---
  socket.on('columns:create', requireAdmin(async ({ title }, callback) => {
    if (!title) return callback?.({ error: 'title required' });
    try {
      const row = await get('SELECT COALESCE(MAX(position),0)+1 as pos FROM columns');
      const position = row.pos;
      const info = await run('INSERT INTO columns (title, position) VALUES (?, ?)', [title, position]);
      await broadcastStateUpdate();
      callback?.({ id: info.lastID, title, position });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('columns:delete', requireAdmin(async ({ id }, callback) => {
    try {
      await run('DELETE FROM tasks WHERE column_id = ?', [id]);
      await run('DELETE FROM columns WHERE id = ?', [id]);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('columns:update', requireAdmin(async ({ id, title }, callback) => {
    if (!title) return callback?.({ error: 'title required' });
    try {
      await run('UPDATE columns SET title=? WHERE id=?', [title, id]);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('columns:reorder', requireAdmin(async ({ ids }, callback) => {
    if (!ids || !Array.isArray(ids)) return callback?.({ error: 'Invalid data' });
    try {
      await run('BEGIN TRANSACTION');
      await Promise.all(ids.map((id, index) =>
        run('UPDATE columns SET position = ? WHERE id = ?', [index, id])
      ));
      await run('COMMIT');
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      await run('ROLLBACK').catch(err => console.error('Rollback failed', err));
      callback?.({ error: e.message });
    }
  }));

  // --- Задачи ---
  socket.on('tasks:create', requireAdmin(async ({ title, column_id }, callback) => {
    if (!title || !column_id) return callback?.({ error: 'title & column_id required' });
    try {
      const row = await get('SELECT COALESCE(MAX(position),0)+1 as pos FROM tasks WHERE column_id = ?', [column_id]);
      const position = row.pos;
      const created_at = Date.now();
      const info = await run('INSERT INTO tasks (title, column_id, created_at, position) VALUES (?, ?, ?, ?)', [title, column_id, created_at, position]);
      await broadcastStateUpdate();
      callback?.({ id: info.lastID, title, column_id, created_at, position });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('tasks:update', requireAdmin(async ({ id, title, reset_created }, callback) => {
    const sets = [];
    const params = [];
    if (title !== undefined) { sets.push('title=?'); params.push(title); }
    if (reset_created) { sets.push('created_at=?'); params.push(Date.now()); }
    if (!sets.length) return callback?.({ error: 'no fields to update' });
    params.push(id);
    try {
      await run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, params);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('tasks:reorder', requireAdmin(async ({ column_id, task_ids, moved_task_id_to_reset_timer }, callback) => {
    if (!column_id || !task_ids || !Array.isArray(task_ids)) return callback?.({ error: 'column_id and task_ids array are required' });
    try {
      await run('BEGIN TRANSACTION');
      await Promise.all(task_ids.map((id, index) =>
        run('UPDATE tasks SET position = ?, column_id = ? WHERE id = ?', [index, column_id, id])
      ));
      if (moved_task_id_to_reset_timer) {
        await run('UPDATE tasks SET created_at = ? WHERE id = ?', [Date.now(), moved_task_id_to_reset_timer]);
      }
      await run('COMMIT');
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      await run('ROLLBACK').catch(err => console.error('Rollback failed', err));
      callback?.({ error: e.message });
    }
  }));

  socket.on('tasks:delete', requireAdmin(async ({ id }, callback) => {
    try {
      await run('DELETE FROM tasks WHERE id=?', [id]);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  // --- События ---
  socket.on('events:create', requireAdmin(async ({ date, title, description }, callback) => {
    if (!date || !title) return callback?.({ error: 'date & title required' });
    try {
      const info = await run('INSERT INTO events (date, title, description) VALUES (?, ?, ?)', [date, title, description || '']);
      await broadcastStateUpdate();
      callback?.({ id: info.lastID, date, title, description });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('events:update', requireAdmin(async ({ id, date, title, description }, callback) => {
    const sets = [];
    const params = [];
    if (date !== undefined) { sets.push('date=?'); params.push(date); }
    if (title !== undefined) { sets.push('title=?'); params.push(title); }
    if (description !== undefined) { sets.push('description=?'); params.push(description); }
    if (!sets.length) return callback?.({ error: 'nothing to update' });
    params.push(id);
    try {
      await run(`UPDATE events SET ${sets.join(',')} WHERE id=?`, params);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('events:delete', requireAdmin(async ({ id }, callback) => {
    try {
      await run('DELETE FROM events WHERE id=?', [id]);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  // --- Звуки ---
  socket.on('sound:broadcast', requireAdmin(({ sound, isCustom }) => {
    io.emit('sound:play', { sound, isCustom });
  }));

  socket.on('sounds:custom:delete', requireAdmin(async ({ id }, callback) => {
    try {
      const sound = await get('SELECT filename FROM custom_sounds WHERE id = ?', [id]);
      if (sound) {
        const filePath = path.join(__dirname, 'public', 'sounds', sound.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await run('DELETE FROM custom_sounds WHERE id = ?', [id]);
      }
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  // --- Админ-сообщение и настройки ---
  socket.on('adminMessage:update', requireAdmin(async ({ message }, callback) => {
    if (message === undefined) return callback?.({ error: 'message is required' });
    try {
      await run('INSERT OR REPLACE INTO admin_message (id, message) VALUES (1, ?)', [message]);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('settings:marquee:update', requireAdmin(async ({ config }, callback) => {
    if (!config || typeof config.enabled !== 'boolean' || typeof config.speed !== 'number') {
      return callback?.({ error: 'Valid config object is required' });
    }
    try {
      await run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['marqueeConfig', JSON.stringify(config)]);
      await broadcastStateUpdate();
      callback?.({ success: true });
    } catch (e) {
      callback?.({ error: e.message });
    }
  }));

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// --- HTTP API (только для логина и загрузки файлов) ---
app.use(express.json());

app.post('/api/login', (req, res) => {
  const { key } = req.body;
  const role = determineRole(key);
  if (role) return res.json({ success: true, role });
  return res.status(401).json({ success: false });
});

// --- Настройка загрузки файлов ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const soundsDir = path.join(__dirname, 'public', 'sounds');
    if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
    cb(null, soundsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true);
    cb(new Error('Только аудио файлы разрешены!'), false);
  }
});

// Middleware для HTTP-авторизации
function httpAuth(req, res, next) {
  const key = req.headers['x-auth-key'];
  const role = determineRole(key);
  if (role) {
    req.role = role;
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}
function httpRequireAdmin(req, res, next) {
  if (req.role === 'admin') return next();
  return res.status(403).json({ error: 'forbidden' });
}

app.post('/api/sounds/upload', httpAuth, httpRequireAdmin, upload.single('soundFile'), async (req, res) => {
  try {
    const { soundName } = req.body;
    if (!soundName || !req.file) {
      return res.status(400).json({ error: 'Название и файл обязательны' });
    }
    const existing = await get('SELECT id FROM custom_sounds WHERE name = ?', [soundName]);
    if (existing) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Звук с таким названием уже существует' });
    }
    const info = await run(
      'INSERT INTO custom_sounds (name, filename, original_name) VALUES (?, ?, ?)',
      [soundName, req.file.filename, req.file.originalname]
    );
    
    // --- Транслируем обновление всем ---
    const state = await getFullState();
    io.emit('state:updated', state);

    res.json({
      id: info.lastID,
      name: soundName,
      filename: req.file.filename,
      original_name: req.file.originalname
    });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: e.message });
  }
});


// --- Статика и SPA ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
}); 
