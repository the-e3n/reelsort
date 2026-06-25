import { db } from '../db/database.js';
import { BRANDING } from '../config/branding.js';

const defaults = {
  mediaPath: '',
  skipSeconds: BRANDING.defaultSkipSeconds,
  filterScope: 'pending',
};

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(`
  INSERT INTO settings (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

export function getSetting(key, fallback = null) {
  const row = getStmt.get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  setStmt.run(key, JSON.stringify(value));
}

export function getSettings() {
  return {
    mediaPath: getSetting('mediaPath', defaults.mediaPath),
    skipSeconds: getSetting('skipSeconds', defaults.skipSeconds),
    filterScope: getSetting('filterScope', defaults.filterScope),
  };
}

export function updateSettings(next) {
  const current = getSettings();
  const merged = {
    ...current,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined)
    ),
  };

  setSetting('mediaPath', merged.mediaPath);
  setSetting('skipSeconds', Number(merged.skipSeconds) || defaults.skipSeconds);
  setSetting('filterScope', merged.filterScope || defaults.filterScope);

  return getSettings();
}
