const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'tasks.db');
const db = new sqlite3.Database(dbPath);

// Инициализация/миграция схемы (создание таблиц при отсутствии)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    column_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,         /* ISO 8601 (YYYY-MM-DD) */
    title TEXT NOT NULL,
    description TEXT
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS custom_sounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,  /* Название звука */
    filename TEXT NOT NULL,     /* Имя файла */
    original_name TEXT NOT NULL, /* Оригинальное имя файла */
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );`);
});

module.exports = { db };
