import fs from 'node:fs/promises';
import path from 'node:path';
import { DECISIONS } from '../config/constants.js';
import {
  getTrashVideos,
  getVideoById,
  removeVideo,
  setDecision,
  updateVideoLocation,
} from '../db/videoRepository.js';
import { getSettings } from './settingsService.js';

function normalizeTargetSubdirectory(targetFolder) {
  const raw = typeof targetFolder === 'string' ? targetFolder.trim() : '';
  if (!raw || raw === '__root__') {
    return null;
  }

  const normalized = path.posix
    .normalize(raw.replaceAll('\\', '/'))
    .replace(/^\/+|\/+$/g, '');

  if (!normalized || normalized === '.' || normalized.includes('..')) {
    throw new Error('Invalid target folder.');
  }

  return normalized;
}

function getAbsoluteMediaPath(relativePath) {
  const { mediaPath } = getSettings();
  if (!mediaPath) {
    throw new Error('No media path configured.');
  }

  return path.resolve(mediaPath, relativePath);
}

export function keepVideo(id) {
  return setDecision(id, DECISIONS.KEPT);
}

export function trashVideo(id) {
  return setDecision(id, DECISIONS.TRASHED);
}

export function restoreVideo(id) {
  return setDecision(id, DECISIONS.PENDING);
}

export async function permanentlyDeleteVideo(id) {
  const video = getVideoById(id);
  if (!video) {
    throw new Error('Video not found.');
  }

  const targets = [video.relativePath, video.posterRelativePath].filter(Boolean);

  for (const target of targets) {
    const absolutePath = getAbsoluteMediaPath(target);
    await fs.rm(absolutePath, { force: true });
  }

  removeVideo(id);
  return video;
}

export async function permanentlyDeleteAllTrashedVideos() {
  const trashedVideos = getTrashVideos();

  for (const video of trashedVideos) {
    const targets = [video.relativePath, video.posterRelativePath].filter(Boolean);

    for (const target of targets) {
      const absolutePath = getAbsoluteMediaPath(target);
      await fs.rm(absolutePath, { force: true });
    }

    removeVideo(video.id);
  }

  return trashedVideos.length;
}

export async function moveVideoToFolder(id, targetFolder) {
  const video = getVideoById(id);
  if (!video) {
    throw new Error('Video not found.');
  }

  const { mediaPath } = getSettings();
  if (!mediaPath) {
    throw new Error('No media path configured.');
  }

  const targetSubdirectory = normalizeTargetSubdirectory(targetFolder);
  const nextRelativePath = targetSubdirectory
    ? path.posix.join(targetSubdirectory, video.filename)
    : video.filename;

  if (nextRelativePath === video.relativePath) {
    return video;
  }

  const sourceAbsolutePath = getAbsoluteMediaPath(video.relativePath);
  const destinationAbsolutePath = getAbsoluteMediaPath(nextRelativePath);
  await fs.mkdir(path.dirname(destinationAbsolutePath), { recursive: true });

  try {
    await fs.rename(sourceAbsolutePath, destinationAbsolutePath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Target file already exists in ${targetSubdirectory || 'root'} folder.`);
    }
    throw error;
  }

  let nextPosterRelativePath = video.posterRelativePath || null;
  if (video.posterRelativePath) {
    const posterFilename = path.posix.basename(video.posterRelativePath);
    nextPosterRelativePath = targetSubdirectory
      ? path.posix.join(targetSubdirectory, posterFilename)
      : posterFilename;

    if (nextPosterRelativePath !== video.posterRelativePath) {
      const sourcePosterAbsolutePath = getAbsoluteMediaPath(video.posterRelativePath);
      const destinationPosterAbsolutePath = getAbsoluteMediaPath(nextPosterRelativePath);
      await fs.mkdir(path.dirname(destinationPosterAbsolutePath), { recursive: true });

      try {
        await fs.rename(sourcePosterAbsolutePath, destinationPosterAbsolutePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  const stats = await fs.stat(destinationAbsolutePath);
  return updateVideoLocation({
    id,
    relativePath: nextRelativePath,
    filename: path.posix.basename(nextRelativePath),
    subdirectory: targetSubdirectory,
    posterRelativePath: nextPosterRelativePath,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
  });
}
