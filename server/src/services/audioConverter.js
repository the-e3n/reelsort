import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSettings } from './settingsService.js';
import { getVideos, getVideoById } from '../db/videoRepository.js';

const state = {
  running: false,
  folder: null,
  mediaPath: null,
  total: 0,
  processed: 0,
  queue: [],
  current: null,
  perFile: {},
  error: null,
  procs: new Map(),
};

function resetState() {
  state.running = false;
  state.folder = null;
  state.mediaPath = null;
  state.total = 0;
  state.processed = 0;
  state.queue = [];
  state.current = null;
  state.perFile = {};
  state.error = null;
  state.procs.clear();
}

const HISTORY_FILE = path.resolve(process.cwd(), 'server', 'data', 'conversion-history.jsonl');

async function appendHistory(entry) {
  try {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await fs.appendFile(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // ignore history write errors
  }
}

async function ffprobeAudioCodec(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    let out = '';
    proc.stdout.on('data', (b) => (out += String(b)));
    proc.on('close', () => {
      const codec = out.trim() || null;
      resolve(codec);
    });
    proc.on('error', () => resolve(null));
  });
}

export function getConversionProgress() {
  // shallow copy; perFile may be updated in place
  return { ...state, perFile: { ...state.perFile } };
}

async function ffprobeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (b) => (out += String(b)));
    proc.stderr.on('data', (b) => (err += String(b)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || `ffprobe exited ${code}`));
        return;
      }
      const v = parseFloat(out.trim());
      if (Number.isFinite(v) && v > 0) {
        resolve(v);
      } else {
        resolve(null);
      }
    });
  });
}

function spawnFfmpegWithProgress(inputPath, coverPath, outputPath, durationSec, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-y'];

    if (options.hwAccel) {
      // best-effort: allow ffmpeg to select available hw accel
      args.push('-hwaccel', 'auto');
    }

    args.push('-i', inputPath);

    if (coverPath) {
      args.push('-i', coverPath);
    }

    if (coverPath) {
      args.push('-map', '0:a?', '-map', '1:0');
    } else {
      args.push('-map', '0:a?');
    }

    // encoding: select codec and quality based on options
    if (options.copy) {
      // copy audio stream
      args.push('-c:a', 'copy');
    } else if (options.format === 'm4a' || outputPath.toLowerCase().endsWith('.m4a')) {
      // AAC
      args.push('-c:a', 'aac');
      if (options.quality) {
        // assume bitrate like '192k'
        args.push('-b:a', options.quality);
      }
    } else {
      // default to mp3
      args.push('-c:a', 'libmp3lame');
      if (options.quality && typeof options.quality === 'string' && options.quality.endsWith('k')) {
        args.push('-b:a', options.quality);
      } else if (options.quality && typeof options.quality === 'number') {
        args.push('-q:a', String(options.quality));
      } else {
        args.push('-q:a', '2');
      }
      args.push('-id3v2_version', '3');
    }

    if (coverPath) {
      args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    }

    args.push(outputPath);

    // progress
    args.unshift('-progress', 'pipe:1');

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    state.procs.set(outputPath, proc);

    let stdout = '';
    proc.stdout.on('data', (chunk) => {
      const s = String(chunk);
      stdout += s;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_ms' && value && durationSec) {
          const outMs = Number(value);
          const percent = Math.min(100, Math.round((outMs / (durationSec * 1_000_000)) * 100));
          onProgress(percent, outMs / 1_000_000);
        }
      }
    });

    let stderr = '';
    proc.stderr.on('data', (b) => {
      stderr += String(b);
      const m = String(b).match(/time=([0-9:.]+)/);
      if (m && durationSec) {
        const parts = m[1].split(':').map(Number);
        const secs = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
        const percent = Math.min(100, Math.round((secs / durationSec) * 100));
        onProgress(percent, secs);
      }
    });

    proc.on('close', (code) => {
      try { state.procs.delete(outputPath); } catch (e) {}
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited ${code}`));
      }
    });
  });
}

export async function startConversion(opts) {
  if (state.running) {
    throw new Error('Conversion already running.');
  }

  resetState();
  const settings = getSettings();
  const mediaPath = settings.mediaPath;
  if (!mediaPath) {
    throw new Error('No media path configured.');
  }

  state.running = true;
  state.mediaPath = mediaPath;

  // support startConversion(folder) or startConversion({ folder, videoIds })
  let videos = [];
  if (typeof opts === 'string') {
    state.folder = opts || 'all';
    const videosResult = getVideos({ offset: 0, limit: 1000000, filter: 'active', folder: state.folder || 'all' });
    videos = videosResult.items || [];
  } else if (opts && Array.isArray(opts.videoIds)) {
    state.folder = opts.folder || null;
    videos = opts.videoIds.map((id) => getVideoById(Number(id))).filter(Boolean);
  } else {
    state.folder = (opts && opts.folder) || 'all';
    const videosResult = getVideos({ offset: 0, limit: 1000000, filter: 'active', folder: state.folder || 'all' });
    videos = videosResult.items || [];
  }

  state.queue = videos;
  state.total = videos.length;

  (async () => {
    try {
      const settingsNow = getSettings();
      const conv = settingsNow.converter || {};
      const concurrency = Math.max(1, Number(conv.concurrency) || 1);

      // ensure server output dir if needed (support custom relative outputPath)
      let serverBaseDir = path.resolve(process.cwd(), 'server', 'data', 'audio');
      if (conv.outputPath && typeof conv.outputPath === 'string' && conv.outputPath.trim() !== '') {
        // allow relative paths from project root
        serverBaseDir = path.resolve(process.cwd(), conv.outputPath);
      }
      if (conv.output === 'server') {
        await fs.mkdir(serverBaseDir, { recursive: true });
      }

      // worker pool
      const queue = videos.slice();

      async function worker() {
        while (queue.length > 0 && state.running) {
          const video = queue.shift();
          if (!video) break;
          state.current = { id: video.id, filename: video.filename, baseName: video.baseName };
          state.perFile[video.id] = { percent: 0, seconds: 0, status: 'running' };

          const inputPath = path.resolve(mediaPath, video.relativePath);
          const posterPath = video.posterRelativePath ? path.resolve(mediaPath, video.posterRelativePath) : null;

          let outputDir = path.dirname(inputPath);
          if (conv.output === 'server') {
            outputDir = serverBaseDir;
          }

          const outExt = (conv.format === 'm4a') ? '.m4a' : '.mp3';
          const outBase = `${video.baseName}${outExt}`;
          const safeOut = path.join(outputDir, outBase);

          const coverPath = posterPath ? await fs.stat(posterPath).then(() => posterPath).catch(() => null) : null;

          const duration = await ffprobeDuration(inputPath).catch(() => null);

          // determine if copy is possible and desired
          let shouldCopy = false;
          if (conv.copyIfPossible) {
            const codec = await ffprobeAudioCodec(inputPath).catch(() => null);
            if (codec) {
              const target = (conv.format === 'm4a') ? 'aac' : 'mp3';
              if (codec.toLowerCase().includes(target)) {
                shouldCopy = true;
              }
            }
          }

          const opts = { hwAccel: Boolean(conv.hwAccel), format: conv.format, quality: conv.quality, copy: shouldCopy };

          let attempt = 0;
          const maxAttempts = Math.max(1, Number(conv.retryCount) || 1);
          let lastError = null;

          while (attempt < maxAttempts && state.running) {
            attempt += 1;
            try {
              await spawnFfmpegWithProgress(inputPath, coverPath, safeOut, duration, (percent, secs) => {
                state.perFile[video.id] = { percent, seconds: secs, status: 'running', attempt };
              }, opts);

              state.perFile[video.id] = { percent: 100, seconds: duration || 0, status: 'done', output: safeOut };
              state.processed += 1;
              state.current = null;
              await appendHistory({ timestamp: Date.now(), videoId: video.id, input: inputPath, output: safeOut, status: 'done', attempts: attempt });
              lastError = null;
              break;
            } catch (err) {
              lastError = err;
              state.perFile[video.id] = { percent: state.perFile[video.id]?.percent || 0, seconds: state.perFile[video.id]?.seconds || 0, status: 'error', error: String(err), attempt };
              state.current = null;
              state.error = String(err);
              await appendHistory({ timestamp: Date.now(), videoId: video.id, input: inputPath, output: safeOut, status: 'error', error: String(err), attempt });
              // small delay before retry
              if (attempt < maxAttempts) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          }

          if (lastError) {
            // exhausted retries
            // leave perFile.status as error
          }
        }
      }

      const workers = [];
      for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);

      state.running = false;
    } catch (error) {
      state.error = error?.message || String(error);
      state.running = false;
      state.current = null;
    }
  })();

  return getConversionProgress();
}

export function stopConversion() {
  if (!state.running) return;

  state.error = 'Stop requested';
  state.running = false;

  for (const [key, proc] of Array.from(state.procs.entries())) {
    try {
      proc.kill('SIGTERM');
    } catch (e) {
      try { proc.kill('SIGKILL'); } catch (e2) {}
    }
    state.procs.delete(key);
  }
  state.current = null;
}

export default { getConversionProgress, startConversion, stopConversion };
