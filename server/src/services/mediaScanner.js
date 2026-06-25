import fs from 'node:fs/promises';
import path from 'node:path';
import { POSTER_EXTENSIONS, VIDEO_EXTENSIONS } from '../config/constants.js';
import { upsertVideos } from '../db/videoRepository.js';
import { getSettings } from './settingsService.js';

const scanProgress = {
  running: false,
  mediaPath: '',
  total: 0,
  added: 0,
  processed: 0,
  error: null,
};

async function listFilesUpToOneLevel(rootPath) {
  const files = [];
  const rootEntries = await fs.readdir(rootPath, { withFileTypes: true });
  const firstLevelDirs = [];

  for (const entry of rootEntries) {
    const absolutePath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      firstLevelDirs.push(absolutePath);
      continue;
    }

    files.push({
      absolutePath,
      relativePath: path.relative(rootPath, absolutePath),
      name: entry.name,
    });
  }

  for (const directoryPath of firstLevelDirs) {
    const nestedEntries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of nestedEntries) {
      if (entry.isDirectory()) {
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      files.push({
        absolutePath,
        relativePath: path.relative(rootPath, absolutePath),
        name: entry.name,
      });
    }
  }

  return files;
}

export function getScanProgress() {
  return { ...scanProgress };
}

function normalizeRelativePath(relativePath) {
  return relativePath.replaceAll('\\', '/');
}

function getSubdirectory(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const firstSeparator = normalizedPath.indexOf('/');
  if (firstSeparator === -1) {
    return null;
  }

  return normalizedPath.slice(0, firstSeparator) || null;
}

function getPosterLookup(files) {
  const map = new Map();

  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase();
    if (!POSTER_EXTENSIONS.includes(extension)) {
      continue;
    }

    map.set(file.relativePath.toLowerCase(), file.relativePath);
  }

  return map;
}

function toVideoRecord(rootPath, file, posterLookup) {
  const extension = path.extname(file.name).toLowerCase();
  const filename = path.basename(file.name);
  const baseName = path.basename(file.name, extension);
  const normalizedRelativePath = normalizeRelativePath(file.relativePath);
  const directory = path.dirname(normalizedRelativePath);
  const subdirectory = getSubdirectory(normalizedRelativePath);

  let posterRelativePath = null;
  for (const posterExtension of POSTER_EXTENSIONS) {
    const candidate = path
      .join(directory, `${baseName}-poster${posterExtension}`)
      .replaceAll('\\', '/');
    const matched = posterLookup.get(candidate.toLowerCase());
    if (matched) {
      posterRelativePath = matched.replaceAll('\\', '/');
      break;
    }
  }

  return fs.stat(file.absolutePath).then((stats) => ({
    relativePath: normalizedRelativePath,
    filename,
    baseName,
    subdirectory,
    posterRelativePath,
    extension,
    sizeBytes: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
  }));
}

export async function scanMediaFolder(explicitPath) {
  if (scanProgress.running) {
    throw new Error('A scan is already in progress.');
  }

  const settings = getSettings();
  const mediaPath = explicitPath || settings.mediaPath;

  if (!mediaPath) {
    throw new Error('Set a media folder before scanning.');
  }

  scanProgress.running = true;
  scanProgress.mediaPath = mediaPath;
  scanProgress.total = 0;
  scanProgress.added = 0;
  scanProgress.processed = 0;
  scanProgress.error = null;

  try {
    const stat = await fs.stat(mediaPath).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error('The selected media folder does not exist or is not a directory.');
    }

    const allFiles = await listFilesUpToOneLevel(mediaPath);
    const posterLookup = getPosterLookup(allFiles);
    const videoFiles = allFiles.filter((file) => VIDEO_EXTENSIONS.has(path.extname(file.name).toLowerCase()));

    scanProgress.total = videoFiles.length;

    const videoRecords = [];
    for (const file of videoFiles) {
      const videoRecord = await toVideoRecord(mediaPath, file, posterLookup);
      videoRecords.push(videoRecord);
      scanProgress.processed += 1;
      scanProgress.added = videoRecords.length;
    }

    upsertVideos(videoRecords);

    return {
      mediaPath,
      totalFiles: allFiles.length,
      indexedVideos: videoRecords.length,
      added: scanProgress.added,
      total: scanProgress.total,
    };
  } catch (error) {
    scanProgress.error = error.message || 'Scan failed.';
    throw error;
  } finally {
    scanProgress.running = false;
  }
}

export function startScan(explicitPath) {
  if (scanProgress.running) {
    throw new Error('A scan is already in progress.');
  }

  scanMediaFolder(explicitPath).catch(() => {});
  return getScanProgress();
}
