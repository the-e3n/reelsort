import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BRANDING } from '../config/branding.js';
import { DECISIONS, DEFAULT_PAGE_SIZE, FILTER_SCOPES } from '../config/constants.js';
import {
  getFilterQueueFolderCounts,
  getFilterQueue,
  getQueueFolderTags,
  getStats,
  getVideoFolderCounts,
  getTrashVideos,
  getVideoById,
  getVideos,
  setDecision,
  setPlaybackPosition,
} from '../db/videoRepository.js';
import {
  keepVideo,
  moveVideoToFolder,
  permanentlyDeleteAllTrashedVideos,
  permanentlyDeleteVideo,
  restoreVideo,
  trashVideo,
} from '../services/fileActions.js';
import { getScanProgress, scanMediaFolder, startScan } from '../services/mediaScanner.js';
import { getSettings, updateSettings } from '../services/settingsService.js';
import audioConverter from '../services/audioConverter.js';

const router = express.Router();

function serializeVideo(video) {
  return {
    ...video,
    videoUrl: `/api/videos/${video.id}/stream`,
    posterUrl: video.posterRelativePath ? `/api/videos/${video.id}/poster` : null,
  };
}

router.get('/branding', (_req, res) => {
  res.json(BRANDING);
});

router.get('/settings', (_req, res) => {
  res.json(getSettings());
});

router.post('/settings', (req, res) => {
  const mediaPath = typeof req.body.mediaPath === 'string' ? req.body.mediaPath.trim() : undefined;
  const skipSeconds = Number(req.body.skipSeconds);
  const filterScope = typeof req.body.filterScope === 'string' ? req.body.filterScope : undefined;
  const shortcuts = typeof req.body.shortcuts === 'object' && req.body.shortcuts !== null
    ? req.body.shortcuts
    : undefined;
  const converter = typeof req.body.converter === 'object' && req.body.converter !== null
    ? req.body.converter
    : undefined;

  const payload = {};

  if (mediaPath !== undefined) {
    payload.mediaPath = mediaPath;
  }

  if (Number.isFinite(skipSeconds) && skipSeconds > 0) {
    payload.skipSeconds = skipSeconds;
  }

  if (Object.values(FILTER_SCOPES).includes(filterScope)) {
    payload.filterScope = filterScope;
  }

  if (shortcuts !== undefined) {
    payload.shortcuts = shortcuts;
  }

  if (converter !== undefined) {
    payload.converter = converter;
  }

  const settings = updateSettings(payload);

  res.json(settings);
});

router.post('/scan', async (req, res, next) => {
  try {
    const result = await scanMediaFolder(req.body?.mediaPath);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/scan/start', (req, res, next) => {
  try {
    const progress = startScan(req.body?.mediaPath);
    res.status(202).json(progress);
  } catch (error) {
    next(error);
  }
});

router.get('/scan/progress', (_req, res) => {
  res.json(getScanProgress());
});

router.get('/stats', (_req, res) => {
  res.json(getStats());
});

router.get('/convert/folders', (_req, res) => {
  try {
    const folderCounts = getVideoFolderCounts({ filter: 'active' });
    const folders = folderCounts.map((item) => item.tag);
    res.json({ folders: folders, folderCounts });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to list folders.' });
  }
});

router.post('/convert', (req, res, next) => {
  try {
    const videoIds = Array.isArray(req.body?.videoIds) ? req.body?.videoIds.map((v) => Number(v)) : null;
    const folder = typeof req.body?.folder === 'string' ? req.body?.folder : undefined;
    const outputPath = typeof req.body?.outputPath === 'string' ? req.body.outputPath : undefined;
    const output = typeof req.body?.output === 'string' ? req.body.output : undefined;
    const arg = videoIds ? { videoIds, folder, outputPath, output } : (folder !== undefined ? { folder, outputPath, output } : undefined);
    const progress = audioConverter.startConversion(arg);
    res.status(202).json(progress);
  } catch (error) {
    next(error);
  }
});

router.post('/convert/history/clear', async (_req, res, next) => {
  try {
    const historyPath = path.resolve(process.cwd(), 'server', 'data', 'conversion-history.jsonl');
    await fs.writeFile(historyPath, '');
    res.json({ cleared: true });
  } catch (error) {
    next(error);
  }
});

router.get('/convert/progress', (_req, res) => {
  try {
    res.json(audioConverter.getConversionProgress());
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to get conversion progress.' });
  }
});

router.post('/convert/stop', (_req, res) => {
  try {
    audioConverter.stopConversion();
    res.json({ stopped: true });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to stop conversion.' });
  }
});

router.get('/convert/queue', (_req, res) => {
  try {
    const progress = audioConverter.getConversionProgress();
    res.json({ queue: progress.queue || [], current: progress.current || null });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to get queue.' });
  }
});

router.get('/convert/history', async (_req, res) => {
  try {
    const historyPath = path.resolve(process.cwd(), 'server', 'data', 'conversion-history.jsonl');
    const content = await fs.readFile(historyPath, 'utf8').catch(() => '');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const items = lines.map((l) => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean).reverse();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to read history.' });
  }
});

router.get('/videos', (req, res) => {
  const offset = Number.parseInt(req.query.offset, 10) || 0;
  const limit = Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'active';
  const folder = typeof req.query.folder === 'string' ? req.query.folder : 'all';

  const result = getVideos({ offset, limit, search, filter, folder });
  const folderCounts = getVideoFolderCounts({ filter, search });
  const folders = folderCounts.map((item) => item.tag);
  res.json({
    ...result,
    folderCounts,
    folders,
    items: result.items.map(serializeVideo),
  });
});

router.get('/filter/queue', (req, res) => {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : FILTER_SCOPES.PENDING;
  const folder = typeof req.query.folder === 'string' ? req.query.folder : 'all';
  const queue = getFilterQueue(scope, folder).map(serializeVideo);
  const folderCounts = getFilterQueueFolderCounts(scope);
  const folders = folderCounts.map((item) => item.tag);
  const allFoldersFromDb = getQueueFolderTags();
  // try to include empty folders from the filesystem as well
  const { mediaPath } = getSettings();

  async function listFoldersOnDisk(rootPath) {
    if (!rootPath) return [];
    try {
      const results = [];
      async function walk(dir, relative) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        let hasSubdir = false;
        for (const entry of entries) {
          if (entry.isDirectory()) {
            hasSubdir = true;
            const childRel = relative ? path.posix.join(relative, entry.name) : entry.name;
            results.push(childRel);
            await walk(path.resolve(dir, entry.name), childRel);
          }
        }
      }

      await walk(mediaPath, '');
      // include root as special tag
      return ['__root__', ...results.map((r) => r)];
    } catch (error) {
      return [];
    }
  }

  (async () => {
    const fsFolders = await listFoldersOnDisk(mediaPath);
    const set = new Set([...(allFoldersFromDb || []), ...(fsFolders || [])]);
    const allFolders = Array.from(set.values());
    res.json({ items: queue, scope, folder, folders, folderCounts, allFolders });
  })();
});

router.post('/videos/:id/move', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const targetFolder = typeof req.body?.targetFolder === 'string' ? req.body.targetFolder : '__root__';
    const keep = Boolean(req.body?.keep);
    const moved = await moveVideoToFolder(id, targetFolder);
    if (keep) {
      // mark the moved video as kept in the DB
      const video = keepVideo(id);
      res.json(serializeVideo(video));
    } else {
      res.json(serializeVideo(moved));
    }
  } catch (error) {
    next(error);
  }
});

router.post('/videos/:id/decision', (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const decision = req.body?.decision;

    if (![DECISIONS.PENDING, DECISIONS.KEPT, DECISIONS.TRASHED].includes(decision)) {
      res.status(400).json({ message: 'Invalid decision.' });
      return;
    }

    let video;
    if (decision === DECISIONS.KEPT) {
      video = keepVideo(id);
    } else if (decision === DECISIONS.TRASHED) {
      video = trashVideo(id);
    } else {
      video = restoreVideo(id);
    }

    res.json(serializeVideo(video));
  } catch (error) {
    next(error);
  }
});

router.post('/videos/:id/playback', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const positionSeconds = Math.max(0, Number(req.body?.positionSeconds) || 0);
  const video = setPlaybackPosition(id, positionSeconds);
  res.json(serializeVideo(video));
});

router.get('/trash', (_req, res) => {
  res.json({ items: getTrashVideos().map(serializeVideo) });
});

router.post('/trash/:id/restore', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const video = restoreVideo(id);
  res.json(serializeVideo(video));
});

router.delete('/trash/:id/permanent', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const removed = await permanentlyDeleteVideo(id);
    res.json({ removed: serializeVideo(removed) });
  } catch (error) {
    next(error);
  }
});

router.delete('/trash/permanent-all', async (_req, res, next) => {
  try {
    const deletedCount = await permanentlyDeleteAllTrashedVideos();
    res.json({ deletedCount });
  } catch (error) {
    next(error);
  }
});

router.get('/videos/:id/stream', (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const video = getVideoById(id);
    const { mediaPath } = getSettings();

    if (!video || !mediaPath) {
      res.status(404).json({ message: 'Video not found.' });
      return;
    }

    res.sendFile(path.resolve(mediaPath, video.relativePath));
  } catch (error) {
    next(error);
  }
});

router.get('/videos/:id/poster', (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const video = getVideoById(id);
    const { mediaPath } = getSettings();

    if (!video?.posterRelativePath || !mediaPath) {
      res.status(404).json({ message: 'Poster not found.' });
      return;
    }

    res.sendFile(path.resolve(mediaPath, video.posterRelativePath));
  } catch (error) {
    next(error);
  }
});

router.use((error, _req, res, _next) => {
  res.status(500).json({ message: error.message || 'Unexpected server error.' });
});

export default router;
