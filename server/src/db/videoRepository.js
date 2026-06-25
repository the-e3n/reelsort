import { db } from './database.js';
import { DECISIONS, DEFAULT_PAGE_SIZE } from '../config/constants.js';

const mapVideo = (row) => ({
  id: row.id,
  filename: row.filename,
  baseName: row.base_name,
  subdirectory: row.subdirectory,
  relativePath: row.relative_path,
  posterRelativePath: row.poster_relative_path,
  extension: row.extension,
  sizeBytes: row.size_bytes,
  mtimeMs: row.mtime_ms,
  decision: row.decision,
  playbackPositionSeconds: row.playback_position_seconds,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const upsertStmt = db.prepare(`
  INSERT INTO videos (
    relative_path,
    filename,
    base_name,
    subdirectory,
    poster_relative_path,
    extension,
    size_bytes,
    mtime_ms,
    updated_at
  ) VALUES (
    @relativePath,
    @filename,
    @baseName,
    @subdirectory,
    @posterRelativePath,
    @extension,
    @sizeBytes,
    @mtimeMs,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(relative_path) DO UPDATE SET
    filename = excluded.filename,
    base_name = excluded.base_name,
    subdirectory = excluded.subdirectory,
    poster_relative_path = excluded.poster_relative_path,
    extension = excluded.extension,
    size_bytes = excluded.size_bytes,
    mtime_ms = excluded.mtime_ms,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteMissingStmt = db.prepare(
  'DELETE FROM videos WHERE relative_path NOT IN (SELECT value FROM json_each(?))'
);
const deleteAllStmt = db.prepare('DELETE FROM videos');
const updateDecisionStmt = db.prepare(
  'UPDATE videos SET decision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
);
const updatePlaybackStmt = db.prepare(
  'UPDATE videos SET playback_position_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
);
const findByIdStmt = db.prepare('SELECT * FROM videos WHERE id = ?');
const findManyByDecisionStmt = db.prepare(
  'SELECT * FROM videos WHERE decision = ? ORDER BY base_name COLLATE NOCASE ASC'
);
const trashStmt = db.prepare(
  "SELECT * FROM videos WHERE decision = 'trashed' ORDER BY updated_at DESC, base_name COLLATE NOCASE ASC"
);

export function replaceAllVideos(items) {
  const transaction = db.transaction((videos) => {
    deleteAllStmt.run();
    for (const video of videos) {
      upsertStmt.run(video);
    }
  });

  transaction(items);
}

export function upsertVideos(items) {
  const transaction = db.transaction((videos) => {
    for (const video of videos) {
      upsertStmt.run(video);
    }

    if (videos.length > 0) {
      deleteMissingStmt.run(JSON.stringify(videos.map((video) => video.relativePath)));
    } else {
      deleteAllStmt.run();
    }
  });

  transaction(items);
}

export function getVideos({ offset = 0, limit = DEFAULT_PAGE_SIZE, search = '', filter = 'active' }) {
  const where = [];
  const params = {};

  if (filter === DECISIONS.PENDING || filter === DECISIONS.KEPT || filter === DECISIONS.TRASHED) {
    where.push('decision = @decision');
    params.decision = filter;
  } else if (filter === 'active') {
    where.push("decision != 'trashed'");
  }

  if (search) {
    where.push('(base_name LIKE @search OR filename LIKE @search)');
    params.search = `%${search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.limit = limit;
  params.offset = offset;

  const rows = db
    .prepare(
      `SELECT * FROM videos ${clause} ORDER BY base_name COLLATE NOCASE ASC LIMIT @limit OFFSET @offset`
    )
    .all(params);

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM videos ${clause}`)
    .get(params);

  return {
    items: rows.map(mapVideo),
    total: countRow.count,
    nextOffset: offset + rows.length < countRow.count ? offset + rows.length : null,
  };
}

export function getFilterQueue(scope = 'pending') {
  let query = "SELECT * FROM videos WHERE decision = 'pending'";

  if (scope === 'active') {
    query = "SELECT * FROM videos WHERE decision != 'trashed'";
  } else if (scope === 'kept') {
    query = "SELECT * FROM videos WHERE decision = 'kept'";
  }

  const rows = db.prepare(`${query} ORDER BY base_name COLLATE NOCASE ASC`).all();
  return rows.map(mapVideo);
}

export function getVideoById(id) {
  const row = findByIdStmt.get(id);
  return row ? mapVideo(row) : null;
}

export function setDecision(id, decision) {
  updateDecisionStmt.run(decision, id);
  return getVideoById(id);
}

export function setPlaybackPosition(id, positionSeconds) {
  updatePlaybackStmt.run(positionSeconds, id);
  return getVideoById(id);
}

export function getTrashVideos() {
  return trashStmt.all().map(mapVideo);
}

export function removeVideo(id) {
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
}

export function getStats() {
  const counts = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN decision = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN decision = 'kept' THEN 1 ELSE 0 END) AS kept,
        SUM(CASE WHEN decision = 'trashed' THEN 1 ELSE 0 END) AS trashed,
        SUM(size_bytes) AS sizeBytes
      FROM videos`
    )
    .get();

  return {
    total: counts.total || 0,
    pending: counts.pending || 0,
    kept: counts.kept || 0,
    trashed: counts.trashed || 0,
    sizeBytes: counts.sizeBytes || 0,
  };
}
