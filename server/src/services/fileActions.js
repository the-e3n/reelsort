import fs from 'node:fs/promises';
import path from 'node:path';
import { DECISIONS } from '../config/constants.js';
import {
  getTrashVideos,
  getVideoById,
  removeVideo,
  setDecision,
} from '../db/videoRepository.js';
import { getSettings } from './settingsService.js';

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
