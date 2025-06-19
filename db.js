const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'tasks.db');
const exists = fs.existsSync(dbPath);
const db = new sqlite3.Database(dbPath);

// Инициализация схемы при первом запуске
if (!exists) {
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
  });
}

module.exports = { db }; 