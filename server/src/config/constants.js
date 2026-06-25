export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.flv',
  '.f4v',
  '.mov',
  '.avi',
  '.wmv',
  '.ts',
  '.m2ts',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.m4v',
]);

export const POSTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.jfif'];

export const DECISIONS = {
  PENDING: 'pending',
  KEPT: 'kept',
  TRASHED: 'trashed',
};

export const FILTER_SCOPES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  KEPT: 'kept',
};

export const DEFAULT_PAGE_SIZE = 30;
