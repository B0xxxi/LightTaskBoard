const express = require('express');
const path = require('path');
const fs = require('fs');
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
    res.json({ columns, tasks });
  } catch (e) {
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

/********* STATIC *********/
app.use(express.static(path.join(__dirname, 'public')));

// Для SPA – отдаём index.html на все get-запросы, кроме API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
}); 