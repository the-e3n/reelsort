import { db } from '../db/database.js';
import { BRANDING } from '../config/branding.js';

const defaults = {
  mediaPath: '',
  skipSeconds: BRANDING.defaultSkipSeconds,
  filterScope: 'pending',
  shortcuts: {
    keep: 'k',
    trash: 'p',
    moveCurrent: 'm',
    playPause: 's',
    seekBack: 'a',
    seekForward: 'd',
    previous: 'ArrowLeft',
    next: 'ArrowRight',
    folderMoves: {},
  },
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
  const savedShortcuts = getSetting('shortcuts', {});

  return {
    mediaPath: getSetting('mediaPath', defaults.mediaPath),
    skipSeconds: getSetting('skipSeconds', defaults.skipSeconds),
    filterScope: getSetting('filterScope', defaults.filterScope),
    shortcuts: {
      ...defaults.shortcuts,
      ...savedShortcuts,
      folderMoves: {
        ...defaults.shortcuts.folderMoves,
        ...(savedShortcuts.folderMoves || {}),
      },
    },
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
  setSetting('shortcuts', {
    ...defaults.shortcuts,
    ...(merged.shortcuts || {}),
    folderMoves: {
      ...defaults.shortcuts.folderMoves,
      ...((merged.shortcuts || {}).folderMoves || {}),
    },
  });

  return getSettings();
}
