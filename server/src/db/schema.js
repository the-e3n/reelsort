import { db } from './database.js';

export function ensureSchema() {
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
}
