import express from 'express';
import path from 'node:path';
import { BRANDING } from '../config/branding.js';
import { DECISIONS, DEFAULT_PAGE_SIZE, FILTER_SCOPES } from '../config/constants.js';
import {
  getFilterQueueFolderCounts,
  getFilterQueue,
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
  permanentlyDeleteAllTrashedVideos,
  permanentlyDeleteVideo,
  restoreVideo,
  trashVideo,
} from '../services/fileActions.js';
import { getScanProgress, scanMediaFolder, startScan } from '../services/mediaScanner.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

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
  res.json({ items: queue, scope, folder, folders, folderCounts });
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
