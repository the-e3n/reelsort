import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const TABS = ['library', 'filter', 'trash', 'settings'];
const FILTER_OPTIONS = [
  { value: 'active', label: 'All active' },
  { value: 'pending', label: 'Undecided' },
  { value: 'kept', label: 'Kept' },
  { value: 'trashed', label: 'Trash only' },
];
const FILTER_SCOPES = [
  { value: 'pending', label: 'Undecided queue' },
  { value: 'active', label: 'Kept + undecided' },
  { value: 'kept', label: 'Kept only' },
];
const DEFAULT_SHORTCUTS = {
  keep: 'k',
  trash: 'p',
  moveCurrent: 'm',
  playPause: 's',
  seekBack: 'a',
  seekForward: 'd',
  previous: 'ArrowLeft',
  next: 'ArrowRight',
  folderMoves: {},
};

const VALID_TAB_SET = new Set(TABS);
const VALID_LIBRARY_FILTER_SET = new Set(FILTER_OPTIONS.map((option) => option.value));
const VALID_QUEUE_SCOPE_SET = new Set(FILTER_SCOPES.map((option) => option.value));

function getUrlState() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const libraryFilter = params.get('libFilter');
  const libraryFolder = params.get('libFolder');
  const queueScope = params.get('queueScope');
  const queueFolder = params.get('queueFolder');
  const videoId = Number.parseInt(params.get('video') || '', 10);

  return {
    tab: VALID_TAB_SET.has(tab) ? tab : 'library',
    libraryFilter: VALID_LIBRARY_FILTER_SET.has(libraryFilter) ? libraryFilter : 'active',
    libraryFolder: libraryFolder || 'all',
    queueScope: VALID_QUEUE_SCOPE_SET.has(queueScope) ? queueScope : 'pending',
    hasQueueScope: VALID_QUEUE_SCOPE_SET.has(queueScope),
    queueFolder: queueFolder || 'all',
    currentFilterId: Number.isFinite(videoId) ? videoId : null,
  };
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function toFolderOptions(folderCounts = []) {
  return folderCounts.map((item) => ({
    value: item.tag,
    label: `${item.tag === '__root__' ? 'Root folder' : item.tag} (${item.count})`,
  }));
}

function normalizeShortcut(value) {
  return String(value || '').trim().toLowerCase();
}

function formatShortcutLabel(value) {
  return String(value || '').trim() || 'Unassigned';
}

function ActionButton({ icon, label, shortcut, className = '', ...props }) {
  return (
    <button type="button" className={className} {...props}>
      <span className="button-icon" aria-hidden="true">{icon}</span>
      <span className="button-label">{label}</span>
      {shortcut && <span className="button-shortcut">{shortcut}</span>}
    </button>
  );
}

function toMoveFolderOptions(folderTags = []) {
  return folderTags.map((tag) => ({
    value: tag,
    label: tag === '__root__' ? 'Root folder' : tag,
  }));
}

function mergeShortcuts(raw = {}) {
  return {
    ...DEFAULT_SHORTCUTS,
    ...raw,
    folderMoves: {
      ...DEFAULT_SHORTCUTS.folderMoves,
      ...(raw.folderMoves || {}),
    },
  };
}

function getFolderChipStyle(folderName) {
  const label = folderName === '__root__' ? 'root' : String(folderName || 'root');
  let hash = 0;

  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) % 360;
  }

  const hue = hash;
  return {
    '--chip-fg': `hsl(${hue} 68% 24%)`,
    '--chip-bg': `hsl(${hue} 85% 92%)`,
    '--chip-border': `hsl(${hue} 70% 74%)`,
  };
}

function useInfiniteObserver(callback, enabled) {
  const ref = useRef(null);

  useEffect(() => {
    if (!enabled || !ref.current) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        callback();
      }
    }, { rootMargin: '300px' });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [callback, enabled]);

  return ref;
}

function Sidebar({ branding, activeTab, onTabChange, stats }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__eyebrow">Jellyfin filter deck</span>
        <h1>{branding.appName || 'ReelSort'}</h1>
        <p>{branding.appTagline}</p>
      </div>

      <nav className="sidebar__nav">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`sidebar__tab ${tab === activeTab ? 'is-active' : ''}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className="sidebar__stats">
        <div>
          <span>Total</span>
          <strong>{stats.total}</strong>
        </div>
        <div>
          <span>Undecided</span>
          <strong>{stats.pending}</strong>
        </div>
        <div>
          <span>Trash</span>
          <strong>{stats.trashed}</strong>
        </div>
      </div>
    </aside>
  );
}

function FloatingHeader({ branding, settings, stats }) {
  return (
    <header className="floating-header">
      <div className="floating-header__brand" title={branding.appDescription}>
        <span className="eyebrow">{branding.appName}</span>
        <strong>{branding.appTagline}</strong>
      </div>
      <div className="floating-header__stats" role="status" aria-live="polite">
        <span>Total {stats.total}</span>
        <span>Undecided {stats.pending}</span>
        <span>Kept {stats.kept}</span>
        <span>Trash {stats.trashed}</span>
        <span>Size {formatBytes(stats.sizeBytes)}</span>
      </div>
      <div className="floating-header__path" title={settings.mediaPath || 'No media path configured'}>
        Path {settings.mediaPath || 'Not configured'}
      </div>
    </header>
  );
}

function LibraryCard({ item, onReview, onQuickAction }) {
  const actions = item.decision === 'pending'
    ? [
      { label: 'Keep', decision: 'kept', className: 'ghost-button' },
      { label: 'Trash', decision: 'trashed', className: 'danger-button' },
    ]
    : [{ label: 'Revert', decision: 'pending', className: 'ghost-button' }];

  return (
    <article className="video-card">
      <div className="video-card__poster-wrap">
        {item.posterUrl ? (
          <img className="video-card__poster" src={item.posterUrl} alt={item.baseName} loading="lazy" />
        ) : (
          <div className="video-card__poster video-card__poster--empty">No poster</div>
        )}
        <span className={`video-card__badge is-${item.decision}`}>{item.decision}</span>
      </div>
      <div className="video-card__meta">
        <h3 title={item.baseName}>{item.baseName}</h3>
        {item.subdirectory && (
          <span className="video-chip" style={getFolderChipStyle(item.subdirectory)} title={item.subdirectory}>
            {item.subdirectory}
          </span>
        )}
        <p>{formatBytes(item.sizeBytes)}</p>
        <div className="video-card__actions">
          <button type="button" onClick={() => onReview(item.id)}>
            Open in filter view
          </button>
          {actions.map((action) => (
            <button
              key={action.decision}
              type="button"
              className={action.className}
              onClick={() => onQuickAction(item.id, action.decision)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function LibraryListItem({ item, onReview, onQuickAction }) {
  const actions = item.decision === 'pending'
    ? [
      { label: 'Keep', decision: 'kept', className: 'ghost-button' },
      { label: 'Trash', decision: 'trashed', className: 'danger-button' },
    ]
    : [{ label: 'Revert', decision: 'pending', className: 'ghost-button' }];

  return (
    <article className="video-list-item">
      <div className="video-list-item__poster-wrap">
        {item.posterUrl ? (
          <img className="video-list-item__poster" src={item.posterUrl} alt={item.baseName} loading="lazy" />
        ) : (
          <div className="video-list-item__poster video-list-item__poster--empty">No poster</div>
        )}
      </div>
      <div className="video-list-item__body">
        <h3 title={item.baseName}>{item.baseName}</h3>
        {item.subdirectory && (
          <span className="video-chip" style={getFolderChipStyle(item.subdirectory)} title={item.subdirectory}>
            {item.subdirectory}
          </span>
        )}
        <p>{formatBytes(item.sizeBytes)}</p>
      </div>
      <div className="video-list-item__status">
        <span className={`video-card__badge is-${item.decision}`}>{item.decision}</span>
      </div>
      <div className="video-list-item__actions">
        <button type="button" onClick={() => onReview(item.id)}>
          Open in filter view
        </button>
        {actions.map((action) => (
          <button
            key={action.decision}
            type="button"
            className={action.className}
            onClick={() => onQuickAction(item.id, action.decision)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}

function LibraryView({
  items,
  hasMore,
  loading,
  onLoadMore,
  onReview,
  onQuickAction,
  filter,
  onFilterChange,
  folder,
  onFolderChange,
  folderOptions,
  search,
  onSearchChange,
  viewMode,
  onViewModeChange,
}) {

  const sentinelRef = useInfiniteObserver(onLoadMore, hasMore && !loading);

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2>Video Library</h2>
        </div>
        <div className="toolbar">
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search filename" />
          <select value={filter} onChange={(event) => onFilterChange(event.target.value)}>
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={folder} onChange={(event) => onFolderChange(event.target.value)}>
            <option value="all">All folders</option>
            {folderOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div className="view-mode-toggle" role="group" aria-label="Library view mode">
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : ''}
              onClick={() => onViewModeChange('list')}
            >
              List
            </button>
            <button
              type="button"
              className={viewMode === 'card' ? 'is-active' : ''}
              onClick={() => onViewModeChange('card')}
            >
              Card
            </button>
          </div>
        </div>
      </header>

      {viewMode === 'card' ? (
        <div className="video-grid">
          {items.map((item) => (
            <LibraryCard key={item.id} item={item} onReview={onReview} onQuickAction={onQuickAction} />
          ))}
        </div>
      ) : (
        <div className="video-list">
          {items.map((item) => (
            <LibraryListItem key={item.id} item={item} onReview={onReview} onQuickAction={onQuickAction} />
          ))}
        </div>
      )}

      {loading && <div className="panel__notice">Loading more videos…</div>}
      {!items.length && !loading && <div className="panel__notice">No videos match the current filter.</div>}
      <div ref={sentinelRef} className="scroll-sentinel" />
    </section>
  );
}

function FilterView({
  queue,
  currentId,
  onSelect,
  onDecision,
  onMoveCurrent,
  scope,
  onScopeChange,
  folder,
  onFolderChange,
  folderOptions,
  moveFolderOptions,
  skipSeconds,
  shortcuts,
  onMoveToCustomFolder,
  onRefresh,
}) {
  const videoRef = useRef(null);
  const lastPRef = useRef(0);
  const saveTickRef = useRef(0);
  const [showQueueCards, setShowQueueCards] = useState(false);
  const [moveTargetFolder, setMoveTargetFolder] = useState('__root__');
  const [customFolderName, setCustomFolderName] = useState('');
  const current = useMemo(() => queue.find((item) => item.id === currentId) || queue[0] || null, [queue, currentId]);
  const currentIndex = current ? queue.findIndex((item) => item.id === current.id) : -1;
  const previous = currentIndex > 0 ? queue[currentIndex - 1] : null;
  const next = currentIndex >= 0 ? queue[currentIndex + 1] : null;
  const currentFolderTag = current?.subdirectory || '__root__';
  const mergedMoveFolderOptions = useMemo(() => {
    const map = new Map();
    map.set('__root__', 'Root folder');

    for (const option of moveFolderOptions || []) {
      if (option?.value && option.value !== 'all') {
        map.set(option.value, option.label || option.value);
      }
    }

    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [moveFolderOptions]);
  const folderMoveShortcutEntries = useMemo(
    () => Object.entries(shortcuts.folderMoves || {}),
    [shortcuts]
  );

  useEffect(() => {
    if (!current) {
      return;
    }

    if (!mergedMoveFolderOptions.length) {
      setMoveTargetFolder('__root__');
      return;
    }

    const isValid = mergedMoveFolderOptions.some((option) => option.value === moveTargetFolder);
    if (isValid) {
      return;
    }

    const fallback = mergedMoveFolderOptions.find((option) => option.value !== currentFolderTag)?.value || '__root__';
    setMoveTargetFolder(fallback);
  }, [current, currentFolderTag, mergedMoveFolderOptions, moveTargetFolder]);

  const togglePlayPause = () => {
    if (!videoRef.current) return;

    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      return;
    }

    videoRef.current.pause();
  };

  useEffect(() => {
    if (!current) return undefined;

    const onKeyDown = async (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      const key = normalizeShortcut(event.key);
      if (key === normalizeShortcut(shortcuts.keep)) {
        event.preventDefault();
        await onDecision(current.id, 'kept');
      }
      if (key === normalizeShortcut(shortcuts.previous) && previous) {
        event.preventDefault();
        onSelect(previous.id);
      }
      if (key === normalizeShortcut(shortcuts.next) && next) {
        event.preventDefault();
        onSelect(next.id);
      }
      if (key === normalizeShortcut(shortcuts.playPause) && videoRef.current) {
        event.preventDefault();
        togglePlayPause();
      }
      if (key === normalizeShortcut(shortcuts.seekBack) && videoRef.current) {
        event.preventDefault();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - skipSeconds);
      }
      if (key === normalizeShortcut(shortcuts.seekForward) && videoRef.current) {
        event.preventDefault();
        videoRef.current.currentTime += skipSeconds;
      }
      if (key === normalizeShortcut(shortcuts.trash)) {
        const now = Date.now();
        if (now - lastPRef.current < 700) {
          event.preventDefault();
          await onDecision(current.id, 'trashed');
          lastPRef.current = 0;
        } else {
          lastPRef.current = now;
        }
      }
      if (key === normalizeShortcut(shortcuts.moveCurrent) && current && moveTargetFolder !== currentFolderTag) {
        event.preventDefault();
        await onMoveCurrent(current.id, moveTargetFolder);
      }

      for (const [targetFolder, shortcutKey] of folderMoveShortcutEntries) {
        if (!shortcutKey) continue;
        if (key === normalizeShortcut(shortcutKey) && currentFolderTag !== targetFolder) {
          event.preventDefault();
          await onMoveCurrent(current.id, targetFolder);
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    current,
    currentFolderTag,
    folderMoveShortcutEntries,
    moveTargetFolder,
    next,
    onDecision,
    onMoveCurrent,
    onSelect,
    previous,
    shortcuts,
    skipSeconds,
  ]);

  useEffect(() => {
    if (videoRef.current && current) {
      const element = videoRef.current;
      const onTimeUpdate = () => {
        const now = Date.now();
        if (now - saveTickRef.current > 2500) {
          saveTickRef.current = now;
          api.savePlayback(current.id, element.currentTime).catch(() => {});
        }
      };

      element.addEventListener('timeupdate', onTimeUpdate);
      return () => element.removeEventListener('timeupdate', onTimeUpdate);
    }

    return undefined;
  }, [current]);

  useEffect(() => {
    if (!videoRef.current || !current) {
      return undefined;
    }

    const element = videoRef.current;
    const targetTime = 0;
    const setStartTime = () => {
      element.currentTime = targetTime;
    };

    if (element.readyState >= 1) {
      setStartTime();
      return undefined;
    }

    element.addEventListener('loadedmetadata', setStartTime, { once: true });
    return () => {
      element.removeEventListener('loadedmetadata', setStartTime);
    };
  }, [current]);

  return (
    <section className="panel panel--wide panel--filter">
      <header className="panel__header panel__header--stacked">
        <div className="filter-header-main">
          <h2 className="filter-header-title" title={current?.filename || 'No video selected'}>
            {current?.filename || 'No video selected'}
          </h2>
          <div className="filter-header-meta">
            <span
              className="video-chip"
              style={getFolderChipStyle(currentFolderTag)}
              title={currentFolderTag === '__root__' ? 'Root folder' : currentFolderTag}
            >
              {currentFolderTag === '__root__' ? 'Root folder' : currentFolderTag}
            </span>
            <span className="pill">Size {formatBytes(current?.sizeBytes || 0)}</span>
            <span className="pill">{queue.length} videos in queue</span>
          </div>
        </div>
        <div className="toolbar toolbar--wrap">
          <select value={scope} onChange={(event) => onScopeChange(event.target.value)}>
            {FILTER_SCOPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={folder} onChange={(event) => onFolderChange(event.target.value)}>
            <option value="all">All folders</option>
            {folderOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <ActionButton icon="↻" label="Refresh queue" className="ghost-button" onClick={onRefresh} />
          <select value={moveTargetFolder} onChange={(event) => setMoveTargetFolder(event.target.value)}>
            {mergedMoveFolderOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <ActionButton
            icon="📁"
            label="Move current"
            className="ghost-button"
            disabled={!current || moveTargetFolder === currentFolderTag}
            onClick={() => current && onMoveCurrent(current.id, moveTargetFolder)}
          />
          <input
            value={customFolderName}
            onChange={(event) => setCustomFolderName(event.target.value)}
            placeholder="New folder under root"
          />
          <ActionButton
            icon="✚"
            label="Create + move"
            className="ghost-button"
            disabled={!current || !customFolderName.trim()}
            onClick={async () => {
              if (!current) return;
              await onMoveToCustomFolder(current.id, customFolderName.trim());
              setCustomFolderName('');
            }}
          />
          <ActionButton
            icon="🗂"
            // intentionally hidden
            style={{ display: 'none' }} 
            label={`Queue cards ${showQueueCards ? 'On' : 'Off'}`}
            className="ghost-button"
            onClick={() => setShowQueueCards((value) => !value)}
          />
        </div>
      </header>

      {!current ? (
        <div className="empty-state">
          <h3>No videos available in this queue</h3>
          <p>Change the filter scope or rescan the folder after adding more media.</p>
        </div>
      ) : (
        <>
          <div className="theater">
            <div className="theater__stage">
              <video
                key={current.id}
                ref={videoRef}
                className="theater__video"
                src={current.videoUrl}
                poster={current.posterUrl || undefined}
                controls
                autoPlay
              />
              <button
                type="button"
                className="theater__overlay-nav theater__overlay-nav--left"
                disabled={!previous}
                onClick={() => previous && onSelect(previous.id)}
              >
                {'<'}
              </button>
              <button
                type="button"
                className="theater__overlay-nav theater__overlay-nav--right"
                disabled={!next}
                onClick={() => next && onSelect(next.id)}
              >
                {'>'}
              </button>
            </div>
          </div>

          <div className="decision-bar">
            <ActionButton icon="✅" label="Keep" shortcut={formatShortcutLabel(shortcuts.keep)} onClick={() => onDecision(current.id, 'kept')} />
            <ActionButton icon="🗑" label="Delete to trash" shortcut={`${formatShortcutLabel(shortcuts.trash)} ${formatShortcutLabel(shortcuts.trash)}`} onClick={() => onDecision(current.id, 'trashed')} />
            <ActionButton
              icon="📂"
              label="Move to selected folder"
              shortcut={formatShortcutLabel(shortcuts.moveCurrent)}
              className="ghost-button"
              disabled={moveTargetFolder === currentFolderTag}
              onClick={() => onMoveCurrent(current.id, moveTargetFolder)}
            />
            <ActionButton icon="⏪" label={`-${skipSeconds}s`} shortcut={formatShortcutLabel(shortcuts.seekBack)} onClick={() => videoRef.current && (videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - skipSeconds))} />
            <ActionButton icon="⏩" label={`+${skipSeconds}s`} shortcut={formatShortcutLabel(shortcuts.seekForward)} onClick={() => videoRef.current && (videoRef.current.currentTime += skipSeconds)} />
            <ActionButton icon="⏯" label="Play/Pause" shortcut={formatShortcutLabel(shortcuts.playPause)} onClick={togglePlayPause} />
          </div>

          {showQueueCards && (
            <div className="queue-strip">
              {queue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`queue-strip__item ${item.id === current.id ? 'is-current' : ''}`}
                  onClick={() => onSelect(item.id)}
                >
                  {item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" /> : <span>No poster</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TrashView({ items, onRestore, onPermanentDelete, onPermanentDeleteAll }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <span className="eyebrow">Trash</span>
          <h2>Soft-deleted videos</h2>
        </div>
        {!!items.length && (
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              if (window.confirm('Permanently delete all trashed videos and their posters?')) {
                onPermanentDeleteAll();
              }
            }}
          >
            Delete all
          </button>
        )}
      </header>

      {!items.length ? (
        <div className="panel__notice">Trash is empty. Videos soft-deleted from filter view will land here.</div>
      ) : (
        <div className="trash-list">
          {items.map((item) => (
            <article key={item.id} className="trash-item">
              {item.posterUrl ? <img src={item.posterUrl} alt="" /> : <div className="trash-item__poster">No poster</div>}
              <div className="trash-item__content">
                <h3>{item.baseName}</h3>
                <p>{formatBytes(item.sizeBytes)}</p>
              </div>
              <div className="trash-item__actions">
                <button type="button" className="ghost-button" onClick={() => onRestore(item.id)}>Restore</button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    if (window.confirm(`Permanently delete ${item.baseName} and its poster?`)) {
                      onPermanentDelete(item.id);
                    }
                  }}
                >
                  Delete forever
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsView({ branding, settingsDraft, onChange, onShortcutChange, onSave, onScan, scanStatus, scanProgress }) {
  const percent = scanProgress.total > 0
    ? Math.min(100, Math.round((scanProgress.added / scanProgress.total) * 100))
    : 0;

  return (
    <section className="panel settings-panel">
      <header className="panel__header">
        <div>
          <span className="eyebrow">Settings</span>
          <h2>Server media path and defaults</h2>
        </div>
      </header>

      <div className="settings-grid">
        <label>
          <span>App name preview</span>
          <input value={branding.appName || ''} disabled />
        </label>
        <label>
          <span>Media folder path on server</span>
          <input value={settingsDraft.mediaPath} onChange={(event) => onChange('mediaPath', event.target.value)} placeholder="/mnt/media/downloads" />
        </label>
        <label>
          <span>Skip interval in seconds</span>
          <input type="number" min="1" value={settingsDraft.skipSeconds} onChange={(event) => onChange('skipSeconds', event.target.value)} />
        </label>
        <label>
          <span>Default filter queue</span>
          <select value={settingsDraft.filterScope} onChange={(event) => onChange('filterScope', event.target.value)}>
            {FILTER_SCOPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Shortcut: Keep</span>
          <input value={settingsDraft.shortcuts.keep} onChange={(event) => onShortcutChange('keep', event.target.value)} placeholder="k" />
        </label>
        <label>
          <span>Shortcut: Trash (double press)</span>
          <input value={settingsDraft.shortcuts.trash} onChange={(event) => onShortcutChange('trash', event.target.value)} placeholder="p" />
        </label>
        <label>
          <span>Shortcut: Move current video</span>
          <input value={settingsDraft.shortcuts.moveCurrent} onChange={(event) => onShortcutChange('moveCurrent', event.target.value)} placeholder="m" />
        </label>
        <label>
          <span>Shortcut: Play/Pause</span>
          <input value={settingsDraft.shortcuts.playPause} onChange={(event) => onShortcutChange('playPause', event.target.value)} placeholder="s" />
        </label>
        <label>
          <span>Shortcut: Seek Back</span>
          <input value={settingsDraft.shortcuts.seekBack} onChange={(event) => onShortcutChange('seekBack', event.target.value)} placeholder="a" />
        </label>
        <label>
          <span>Shortcut: Seek Forward</span>
          <input value={settingsDraft.shortcuts.seekForward} onChange={(event) => onShortcutChange('seekForward', event.target.value)} placeholder="d" />
        </label>
        <label>
          <span>Shortcut: Previous Video</span>
          <input value={settingsDraft.shortcuts.previous} onChange={(event) => onShortcutChange('previous', event.target.value)} placeholder="ArrowLeft" />
        </label>
        <label>
          <span>Shortcut: Next Video</span>
          <input value={settingsDraft.shortcuts.next} onChange={(event) => onShortcutChange('next', event.target.value)} placeholder="ArrowRight" />
        </label>
        {Object.entries(settingsDraft.shortcuts.folderMoves || {}).map(([folderName, shortcutValue]) => (
          <label key={folderName}>
            <span>Move to: {folderName === '__root__' ? 'Root folder' : folderName}</span>
            <input
              value={shortcutValue}
              onChange={(event) => onShortcutChange(`folderMoves.${folderName}`, event.target.value)}
              placeholder="Optional key"
            />
          </label>
        ))}
      </div>

      <div className="settings-actions">
        <button type="button" onClick={onSave}>Save settings</button>
        <button type="button" className="ghost-button" onClick={onScan}>Scan folder</button>
      </div>

      {(scanProgress.running || scanProgress.total > 0) && (
        <div className="scan-progress" aria-live="polite">
          <div className="scan-progress__label">
            <span>Progress</span>
            <strong>{scanProgress.added}/{scanProgress.total || 0}</strong>
          </div>
          <div className="scan-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={scanProgress.total || 0} aria-valuenow={scanProgress.added}>
            <div className="scan-progress__fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {scanStatus && <div className="panel__notice">{scanStatus}</div>}
    </section>
  );
}

export default function App() {
  const initialUrlState = getUrlState();
  const [branding, setBranding] = useState({ appName: 'ReelSort', appTagline: '' });
  const [activeTab, setActiveTab] = useState(initialUrlState.tab);
  const [settings, setSettings] = useState({ mediaPath: '', skipSeconds: 10, filterScope: 'pending', shortcuts: mergeShortcuts() });
  const [settingsDraft, setSettingsDraft] = useState({ mediaPath: '', skipSeconds: 10, filterScope: 'pending', shortcuts: mergeShortcuts() });
  const [stats, setStats] = useState({ total: 0, pending: 0, kept: 0, trashed: 0, sizeBytes: 0 });
  const [videos, setVideos] = useState([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState(initialUrlState.libraryFilter);
  const [libraryFolder, setLibraryFolder] = useState(initialUrlState.libraryFolder);
  const [libraryFolderOptions, setLibraryFolderOptions] = useState([]);
  const [libraryViewMode, setLibraryViewMode] = useState('list');
  const [search, setSearch] = useState('');
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queueScope, setQueueScope] = useState(initialUrlState.queueScope);
  const [queueFolder, setQueueFolder] = useState(initialUrlState.queueFolder);
  const [queueFolderOptions, setQueueFolderOptions] = useState([]);
  const [queueMoveFolderOptions, setQueueMoveFolderOptions] = useState([]);
  const [currentFilterId, setCurrentFilterId] = useState(initialUrlState.currentFilterId);
  const [trash, setTrash] = useState([]);
  const [scanStatus, setScanStatus] = useState('');
  const [scanProgress, setScanProgress] = useState({ running: false, added: 0, total: 0 });
  const [flash, setFlash] = useState('');

  async function refreshStats() {
    setStats(await api.getStats());
  }

  async function loadVideos({
    reset = false,
    nextFilter = libraryFilter,
    nextSearch = search,
    nextFolder = libraryFolder,
  } = {}) {
    if (loadingVideos) return;
    setLoadingVideos(true);

    try {
      const offset = reset ? 0 : nextOffset;
      const response = await api.getVideos({
        offset,
        limit: 24,
        search: nextSearch,
        filter: nextFilter,
        folder: nextFolder,
      });
      setVideos((current) => (reset ? response.items : [...current, ...response.items]));
      setNextOffset(response.nextOffset ?? 0);
      setHasMore(response.nextOffset !== null);
      setLibraryFolder(nextFolder);
      const folderCounts = Array.isArray(response.folderCounts)
        ? response.folderCounts
        : (Array.isArray(response.folders) ? response.folders.map((tag) => ({ tag, count: 0 })) : []);
      setLibraryFolderOptions(toFolderOptions(folderCounts));
    } catch (error) {
      setFlash(error.message);
    } finally {
      setLoadingVideos(false);
    }
  }

  async function loadQueue(scope = queueScope, folder = queueFolder, preferredId = currentFilterId) {
    try {
      const response = await api.getFilterQueue(scope, folder);
      setQueue(response.items);
      setQueueScope(scope);
      setQueueFolder(folder);
      const folderCounts = Array.isArray(response.folderCounts)
        ? response.folderCounts
        : (Array.isArray(response.folders) ? response.folders.map((tag) => ({ tag, count: 0 })) : []);
      setQueueFolderOptions(toFolderOptions(folderCounts));
      const allFolders = Array.isArray(response.allFolders) ? response.allFolders : [];
      setQueueMoveFolderOptions(toMoveFolderOptions(allFolders));

      setSettings((current) => ({
        ...current,
        shortcuts: mergeShortcuts({
          ...current.shortcuts,
          folderMoves: {
            ...Object.fromEntries(allFolders.map((tag) => [tag, current.shortcuts?.folderMoves?.[tag] || ''])),
          },
        }),
      }));

      setSettingsDraft((current) => ({
        ...current,
        shortcuts: mergeShortcuts({
          ...current.shortcuts,
          folderMoves: {
            ...Object.fromEntries(allFolders.map((tag) => [tag, current.shortcuts?.folderMoves?.[tag] || ''])),
          },
        }),
      }));

      const fallbackId = response.items.find((item) => item.id === preferredId)?.id ?? response.items[0]?.id ?? null;
      setCurrentFilterId(fallbackId);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function loadTrash() {
    try {
      const response = await api.getTrash();
      setTrash(response.items);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function bootstrap() {
    try {
      const [brandingResponse, settingsResponse] = await Promise.all([
        api.getBranding(),
        api.getSettings(),
      ]);
      setBranding(brandingResponse);
      const mergedSettings = {
        ...settingsResponse,
        shortcuts: mergeShortcuts(settingsResponse.shortcuts || {}),
      };
      setSettings(mergedSettings);
      setSettingsDraft(mergedSettings);
      const preferredQueueScope = initialUrlState.hasQueueScope ? queueScope : (settingsResponse.filterScope || 'pending');
      setQueueScope(preferredQueueScope);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true, nextFilter: libraryFilter, nextSearch: search, nextFolder: libraryFolder }),
        loadQueue(preferredQueueScope, queueFolder, currentFilterId),
        loadTrash(),
      ]);
    } catch (error) {
      setFlash(error.message);
    }
  }

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadVideos({ reset: true, nextFilter: libraryFilter, nextSearch: search, nextFolder: libraryFolder });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [libraryFilter, libraryFolder, search]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const isMobileLayout = window.matchMedia('(max-width: 760px)').matches;
    if (activeTab === 'filter' && !isMobileLayout) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeTab]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', activeTab);

    if (libraryFilter !== 'active') {
      params.set('libFilter', libraryFilter);
    } else {
      params.delete('libFilter');
    }

    if (libraryFolder !== 'all') {
      params.set('libFolder', libraryFolder);
    } else {
      params.delete('libFolder');
    }

    if (queueScope !== 'pending') {
      params.set('queueScope', queueScope);
    } else {
      params.delete('queueScope');
    }

    if (queueFolder !== 'all') {
      params.set('queueFolder', queueFolder);
    } else {
      params.delete('queueFolder');
    }

    if (currentFilterId) {
      params.set('video', String(currentFilterId));
    } else {
      params.delete('video');
    }

    const queryString = params.toString();
    const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  }, [activeTab, libraryFilter, libraryFolder, queueScope, queueFolder, currentFilterId]);

  async function handleSaveSettings() {
    try {
      const saved = await api.saveSettings({
        mediaPath: settingsDraft.mediaPath,
        skipSeconds: Number(settingsDraft.skipSeconds),
        filterScope: settingsDraft.filterScope,
        shortcuts: settingsDraft.shortcuts,
      });
      const mergedSettings = {
        ...saved,
        shortcuts: mergeShortcuts(saved.shortcuts || {}),
      };
      setSettings(mergedSettings);
      setSettingsDraft(mergedSettings);
      setFlash('Settings saved.');
      await loadQueue(mergedSettings.filterScope, queueFolder, currentFilterId);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handleScan() {
    try {
      setScanStatus('Starting scan…');
      setScanProgress({ running: true, added: 0, total: 0 });
      await api.startScan(settingsDraft.mediaPath);

      while (true) {
        const progress = await api.getScanProgress();
        setScanProgress({
          running: Boolean(progress.running),
          added: Number(progress.added) || 0,
          total: Number(progress.total) || 0,
        });
        setScanStatus(`Scanning ${progress.added}/${progress.total}`);

        if (!progress.running) {
          if (progress.error) {
            setScanProgress((current) => ({ ...current, running: false }));
            throw new Error(progress.error);
          }

          setScanStatus(`Scan complete: ${progress.added}/${progress.total}`);
          setScanProgress({
            running: false,
            added: Number(progress.added) || 0,
            total: Number(progress.total) || 0,
          });
          break;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 250);
        });
      }

      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, currentFilterId),
        loadTrash(),
      ]);
    } catch (error) {
      setScanProgress((current) => ({ ...current, running: false }));
      setScanStatus(error.message);
    }
  }

  async function handleDecision(id, decision) {
    try {
      const currentIndex = queue.findIndex((item) => item.id === id);
      const fallbackId = queue[currentIndex + 1]?.id ?? queue[currentIndex - 1]?.id ?? null;
      await api.setDecision(id, decision);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, fallbackId),
        loadTrash(),
      ]);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handleLibraryQuickAction(id, decision) {
    try {
      await api.setDecision(id, decision);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, currentFilterId),
        loadTrash(),
      ]);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handleMoveCurrentVideo(id, targetFolder) {
    try {
      await api.moveVideo(id, targetFolder);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, id),
        loadTrash(),
      ]);
      setFlash('Video moved.');
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handleMoveCurrentVideoToCustomFolder(id, customFolderName) {
    try {
      await api.moveVideo(id, customFolderName);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, id),
        loadTrash(),
      ]);
      setFlash(`Video moved to ${customFolderName}.`);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handleRestore(id) {
    try {
      await api.restoreTrash(id);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, currentFilterId),
        loadTrash(),
      ]);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handlePermanentDelete(id) {
    try {
      await api.permanentDelete(id);
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, currentFilterId),
        loadTrash(),
      ]);
    } catch (error) {
      setFlash(error.message);
    }
  }

  async function handlePermanentDeleteAllTrash() {
    try {
      await api.permanentDeleteAllTrash();
      await Promise.all([
        refreshStats(),
        loadVideos({ reset: true }),
        loadQueue(queueScope, queueFolder, currentFilterId),
        loadTrash(),
      ]);
    } catch (error) {
      setFlash(error.message);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar branding={branding} activeTab={activeTab} onTabChange={setActiveTab} stats={stats} />
      <main className={`main-stage ${activeTab === 'filter' ? 'main-stage--filter' : ''}`}>
        {activeTab !== 'filter' && <FloatingHeader branding={branding} settings={settings} stats={stats} />}

        {flash && <div className="flash-banner">{flash}</div>}

        {activeTab === 'library' && (
          <LibraryView
            items={videos}
            hasMore={hasMore}
            loading={loadingVideos}
            onLoadMore={() => loadVideos()}
            onReview={(id) => {
              setActiveTab('filter');
              setCurrentFilterId(id);
              loadQueue(queueScope, queueFolder, id);
            }}
            onQuickAction={handleLibraryQuickAction}
            filter={libraryFilter}
            onFilterChange={setLibraryFilter}
            folder={libraryFolder}
            onFolderChange={(value) => {
              setLibraryFolder(value);
              loadVideos({ reset: true, nextFilter: libraryFilter, nextSearch: search, nextFolder: value });
            }}
            folderOptions={libraryFolderOptions}
            search={search}
            onSearchChange={setSearch}
            viewMode={libraryViewMode}
            onViewModeChange={setLibraryViewMode}
          />
        )}

        {activeTab === 'filter' && (
          <FilterView
            queue={queue}
            currentId={currentFilterId}
            onSelect={setCurrentFilterId}
            onDecision={handleDecision}
            onMoveCurrent={handleMoveCurrentVideo}
            scope={queueScope}
            onScopeChange={(value) => {
              setQueueScope(value);
              loadQueue(value, queueFolder, currentFilterId);
            }}
            folder={queueFolder}
            onFolderChange={(value) => {
              setQueueFolder(value);
              loadQueue(queueScope, value, currentFilterId);
            }}
            folderOptions={queueFolderOptions}
            moveFolderOptions={queueMoveFolderOptions}
            skipSeconds={Number(settings.skipSeconds) || 10}
            shortcuts={settings.shortcuts || DEFAULT_SHORTCUTS}
            onMoveToCustomFolder={handleMoveCurrentVideoToCustomFolder}
            onRefresh={() => loadQueue(queueScope, queueFolder, currentFilterId)}
          />
        )}

        {activeTab === 'trash' && (
          <TrashView
            items={trash}
            onRestore={handleRestore}
            onPermanentDelete={handlePermanentDelete}
            onPermanentDeleteAll={handlePermanentDeleteAllTrash}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            branding={branding}
            settingsDraft={settingsDraft}
            onChange={(key, value) => setSettingsDraft((current) => ({ ...current, [key]: value }))}
            onShortcutChange={(key, value) => setSettingsDraft((current) => ({
              ...current,
              shortcuts: (() => {
                const shortcuts = mergeShortcuts(current.shortcuts || {});
                if (key.startsWith('folderMoves.')) {
                  const folderName = key.slice('folderMoves.'.length);
                  return {
                    ...shortcuts,
                    folderMoves: {
                      ...shortcuts.folderMoves,
                      [folderName]: value,
                    },
                  };
                }

                return {
                  ...shortcuts,
                  [key]: value,
                };
              })(),
            }))}
            onSave={handleSaveSettings}
            onScan={handleScan}
            scanStatus={scanStatus}
            scanProgress={scanProgress}
          />
        )}
      </main>
    </div>
  );
}
