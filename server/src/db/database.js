import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'reelsort.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS videos (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		relative_path TEXT NOT NULL UNIQUE,
		filename TEXT NOT NULL,
		base_name TEXT NOT NULL,
		subdirectory TEXT,
		poster_relative_path TEXT,
		extension TEXT NOT NULL,
		size_bytes INTEGER NOT NULL DEFAULT 0,
		mtime_ms INTEGER NOT NULL DEFAULT 0,
		decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'kept', 'trashed')),
		playback_position_seconds REAL NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
`);

const subdirectoryColumn = db
  .prepare("SELECT 1 AS hasColumn FROM pragma_table_info('videos') WHERE name = 'subdirectory'")
  .get();

if (!subdirectoryColumn) {
  db.exec('ALTER TABLE videos ADD COLUMN subdirectory TEXT');
}

db.exec(`
	CREATE INDEX IF NOT EXISTS idx_videos_decision ON videos(decision);
	CREATE INDEX IF NOT EXISTS idx_videos_base_name ON videos(base_name);
	CREATE INDEX IF NOT EXISTS idx_videos_subdirectory ON videos(subdirectory);
	CREATE INDEX IF NOT EXISTS idx_videos_updated_at ON videos(updated_at);
`);
