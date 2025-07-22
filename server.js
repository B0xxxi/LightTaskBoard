const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // для JSON тел

// Загрузка пароля и ключей из .env или config.json
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
let KEY_FILE_SECRET = process.env.KEY_FILE_SECRET || null;
const SESSION_SECRET = process.env.SESSION_SECRET || 'session';
let VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || null;

// Временное хранилище звуковых команд (в production лучше использовать Redis или базу данных)
const soundCommands = [];
const SOUND_RETENTION_TIME = 60000; // Храним команды 1 минуту

// Настройка загрузки файлов для кастомных звуков
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const soundsDir = path.join(__dirname, 'public', 'sounds');
    if (!fs.existsSync(soundsDir)) {
      fs.mkdirSync(soundsDir, { recursive: true });
    }
    cb(null, soundsDir);
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя файла
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB лимит
  },
  fileFilter: (req, file, cb) => {
    // Разрешаем только аудио файлы
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Только аудио файлы разрешены!'), false);
    }
  }
});

function determineRole(key){
  const k = key ? String(key).trim() : '';
  if(k && ADMIN_PASSWORD && k === String(ADMIN_PASSWORD).trim()) return 'admin';
  if(k && VIEWER_PASSWORD && k === String(VIEWER_PASSWORD).trim()) return 'viewer';
  return null;
}

// Middleware проверки авторизации + определение роли
function auth(req,res,next){
  const key=req.headers['x-auth-key'];
  const role=determineRole(key);
  if(role){ req.role=role; return next(); }
  return res.status(401).json({error:'unauthorized'});
}

function requireAdmin(req,res,next){
  if(req.role==='admin') return next();
  return res.status(403).json({error:'forbidden'});
}

// Promise-обёртка
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

/**************** LOGIN ****************/
app.post('/api/login', (req, res) => {
  const { key } = req.body;
  const role = determineRole(key);
  if(role) return res.json({success:true,role});
  return res.status(401).json({success:false});
});

/**************** STATE ****************/
app.get('/api/state', auth, async (req, res) => {
  try {
    const columns = await all('SELECT * FROM columns ORDER BY position, id');
    const tasks = await all('SELECT * FROM tasks ORDER BY position, id');
    const events = await all('SELECT * FROM events ORDER BY date');
    const adminMessageRow = await get('SELECT message FROM admin_message WHERE id = 1');
    const adminMessage = adminMessageRow ? adminMessageRow.message : '';
    res.json({ columns, tasks, events, adminMessage, role: req.role });
  } catch (e) {
    console.error('Error loading state:', e);
    res.status(500).json({ error: e.message });
  }
});

/**************** COLUMNS **************/
app.post('/api/columns', auth, requireAdmin, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const row = await get('SELECT COALESCE(MAX(position),0)+1 as pos FROM columns');
    const position = row.pos;
    const info = await run('INSERT INTO columns (title, position) VALUES (?, ?)', [title, position]);
    res.json({ id: info.lastID, title, position });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/columns/:id', auth, requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM tasks WHERE column_id = ?', [req.params.id]);
    await run('DELETE FROM columns WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/columns/:id', auth, requireAdmin, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    await run('UPDATE columns SET title=? WHERE id=?', [title, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/columns/reorder', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ success: false, error: 'Invalid data' });
  }
  
  try {
    const updatedColumns = ids.map((id, i) => {
      db.prepare('UPDATE columns SET position = ? WHERE id = ?').run(i, id);
      return db.prepare('SELECT * FROM columns WHERE id = ?').get(id);
    });
    
    res.json({ success: true });
  } catch (e) {
    console.error('Ошибка при изменении порядка колонок:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**************** EVENTS ****************/
app.get('/api/events', auth, async (req, res) => {
  try {
    const events = await all('SELECT * FROM events ORDER BY date');
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events', auth, requireAdmin, async (req, res) => {
  const { date, title, description } = req.body;
  if (!date || !title) return res.status(400).json({ error: 'date & title required' });
  try {
    const info = await run('INSERT INTO events (date, title, description) VALUES (?, ?, ?)', [date, title, description || '']);
    res.json({ id: info.lastID, date, title, description });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/events/:id', auth, requireAdmin, async (req, res) => {
  const { date, title, description } = req.body;
  const sets = [];
  const params = [];
  if (date !== undefined) { sets.push('date=?'); params.push(date); }
  if (title !== undefined) { sets.push('title=?'); params.push(title); }
  if (description !== undefined) { sets.push('description=?'); params.push(description); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(req.params.id);
  try {
    await run(`UPDATE events SET ${sets.join(',')} WHERE id=?`, params);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/events/:id', auth, requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM events WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**************** TASKS ****************/
app.post('/api/tasks', auth, requireAdmin, async (req, res) => {
  const { title, column_id } = req.body;
  if (!title || !column_id) return res.status(400).json({ error: 'title & column_id required' });
  try {
    const row = await get('SELECT COALESCE(MAX(position),0)+1 as pos FROM tasks WHERE column_id = ?', [column_id]);
    const position = row.pos;
    const created_at = Date.now();
    const info = await run('INSERT INTO tasks (title, column_id, created_at, position) VALUES (?, ?, ?, ?)', [title, column_id, created_at, position]);
    res.json({ id: info.lastID, title, column_id, created_at, position });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tasks/:id', auth, requireAdmin, async (req, res) => {
  const { title, column_id, reset_created } = req.body;
  const sets = [];
  const params = [];
  if (title !== undefined) { sets.push('title=?'); params.push(title); }
  if (column_id !== undefined) { sets.push('column_id=?'); params.push(column_id); }
  if (reset_created) { sets.push('created_at=?'); params.push(Date.now()); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(req.params.id);
  try {
    await run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, params);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tasks/:id', auth, requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM tasks WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**************** CUSTOM SOUNDS ****************/
// Получить список кастомных звуков
app.get('/api/sounds/custom', auth, async (req, res) => {
  try {
    const sounds = await all('SELECT id, name, filename, original_name FROM custom_sounds ORDER BY name');
    res.json({ sounds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Загрузить кастомный звук
app.post('/api/sounds/upload', auth, requireAdmin, upload.single('soundFile'), async (req, res) => {
  try {
    const { soundName } = req.body;
    if (!soundName || !req.file) {
      return res.status(400).json({ error: 'Название и файл обязательны' });
    }

    // Проверяем, что звук с таким именем еще не существует
    const existing = await get('SELECT id FROM custom_sounds WHERE name = ?', [soundName]);
    if (existing) {
      // Удаляем загруженный файл
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Звук с таким названием уже существует' });
    }

    // Сохраняем в базу
    const info = await run(
      'INSERT INTO custom_sounds (name, filename, original_name) VALUES (?, ?, ?)',
      [soundName, req.file.filename, req.file.originalname]
    );

    res.json({ 
      id: info.lastID, 
      name: soundName,
      filename: req.file.filename,
      original_name: req.file.originalname
    });
  } catch (e) {
    // В случае ошибки удаляем файл
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: e.message });
  }
});

// Удалить кастомный звук
app.delete('/api/sounds/custom/:id', auth, requireAdmin, async (req, res) => {
  try {
    const sound = await get('SELECT filename FROM custom_sounds WHERE id = ?', [req.params.id]);
    if (sound) {
      // Удаляем файл
      const filePath = path.join(__dirname, 'public', 'sounds', sound.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      // Удаляем из базы
      await run('DELETE FROM custom_sounds WHERE id = ?', [req.params.id]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**************** SOUNDBOARD ****************/
// Очистка старых звуковых команд
function cleanOldSounds() {
  const now = Date.now();
  const index = soundCommands.findIndex(cmd => now - cmd.timestamp < SOUND_RETENTION_TIME);
  if (index > 0) {
    soundCommands.splice(0, index);
  }
}

// Отправка звука всем viewer'ам (только админ)
app.post('/api/sound/broadcast', auth, requireAdmin, async (req, res) => {
  const { sound, timestamp, isCustom } = req.body;
  if (!sound) return res.status(400).json({ error: 'sound name required' });
  
  try {
    cleanOldSounds();
    soundCommands.push({
      sound,
      timestamp: timestamp || Date.now(),
      isCustom: !!isCustom,
      id: Date.now() + Math.random() // уникальный ID для команды
    });
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Проверка новых звуковых команд (только для viewer'ов)
app.get('/api/sound/check', auth, async (req, res) => {
  if (req.role === 'admin') {
    return res.json({ sounds: [] }); // Админ не получает звуки
  }
  
  const since = parseInt(req.query.since) || 0;
  
  try {
    cleanOldSounds();
    const newSounds = soundCommands.filter(cmd => cmd.timestamp > since);
    res.json({ sounds: newSounds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**************** ADMIN MESSAGE ****************/
// Получить админ-сообщение
app.get('/api/admin-message', auth, async (req, res) => {
  try {
    const message = await get('SELECT message FROM admin_message WHERE id = 1');
    res.json({ message: message ? message.message : '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Сохранить админ-сообщение (только админ)
app.put('/api/admin-message', auth, requireAdmin, async (req, res) => {
  const { message } = req.body;
  if (message === undefined) {
    return res.status(400).json({ error: 'message is required' });
  }
  
  try {
    // Используем INSERT OR REPLACE для обновления записи с id=1
    await run('INSERT OR REPLACE INTO admin_message (id, message) VALUES (1, ?)', [message]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/********* STATIC *********/
app.use(express.static(path.join(__dirname, 'public')));

// Для SPA – отдаём index.html на все get-запросы, кроме API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
}); 
