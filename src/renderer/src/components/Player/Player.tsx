import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem } from '@shared/types';
import { displayTitle, displayYear } from '@renderer/lib/selectors';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import { useScrubPreview } from './useScrubPreview';
import styles from './Player.module.css';

/** Seconds the skip buttons jump. */
const SKIP = 10;
/** How long the pointer must rest before the chrome fades out. */
const IDLE_MS = 2600;
/** Progress is persisted at most this often — every frame would thrash disk. */
const SAVE_EVERY_MS = 5000;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

interface PlayerProps {
  item: LibraryItem;
  /** Where playback should resume from, in seconds. */
  startAt: number;
}

export function Player({ item, startAt }: PlayerProps): React.JSX.Element {
  const stopPlaying = useUi((s) => s.stopPlaying);
  const setProgress = useProfile((s) => s.setProgress);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  const resumed = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(startAt);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const src = useMemo(() => toMovieUrl(item.video.path), [item.video.path]);
  const { canvasRef, requestFrame } = useScrubPreview(src);

  // --- Subtitles ----------------------------------------------------------
  const [tracks, setTracks] = useState<Array<{ label: string; url: string }>>([]);
  const [activeTrack, setActiveTrack] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    void (async () => {
      const loaded: Array<{ label: string; url: string }> = [];
      for (const sub of item.subtitles) {
        const vtt = await window.api.loadSubtitle(sub.path);
        if (vtt === null) continue;
        // Blob URLs keep the CSP simple — no extra scheme to allow.
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        urls.push(url);
        loaded.push({ label: sub.label, url });
      }
      if (!cancelled) setTracks(loaded);
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [item.subtitles]);

  // Text tracks must be toggled through the API; `<track default>` is not
  // reliable once tracks are added dynamically.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const track = video.textTracks[i];
      if (track) track.mode = i === activeTrack ? 'showing' : 'disabled';
    }
  }, [activeTrack, tracks]);

  // --- Persistence --------------------------------------------------------

  const persist = useCallback(
    (position: number, total: number) => {
      if (total <= 0) return;
      void setProgress(item.id, position, total);
    },
    [item.id, setProgress]
  );

  // Save on the way out so a mid-film exit is never lost.
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video && video.duration > 0) persist(video.currentTime, video.duration);
    };
  }, [persist]);

  // --- Idle chrome --------------------------------------------------------

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake]);

  // --- Controls -----------------------------------------------------------

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const skip = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || 0);
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, time), video.duration || 0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // --- Keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never hijack typing.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          skip(e.shiftKey ? 60 : SKIP);
          break;
        case 'ArrowLeft':
          skip(e.shiftKey ? -60 : -SKIP);
          break;
        case 'ArrowUp':
          setVolume((v) => Math.min(1, v + 0.05));
          break;
        case 'ArrowDown':
          setVolume((v) => Math.max(0, v - 0.05));
          break;
        case 'm':
          setMuted((v) => !v);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen();
          else stopPlaying();
          break;
        default:
          return;
      }
      wake();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [skip, stopPlaying, toggleFullscreen, togglePlay, wake]);

  // --- Volume applied to the element --------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
  }, [rate]);

  // --- Scrub bar ----------------------------------------------------------

  const timeFromPointer = useCallback(
    (clientX: number): number => {
      const rect = scrubRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || duration <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const onScrubMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = scrubRef.current?.getBoundingClientRect();
    if (!rect) return;
    const time = timeFromPointer(e.clientX);
    setHoverTime(time);
    setHoverX(Math.min(Math.max(84, e.clientX - rect.left), rect.width - 84));
    requestFrame(time);
    if (scrubbing) seekTo(time);
  };

  useEffect(() => {
    if (!scrubbing) return;
    const onUp = (): void => setScrubbing(false);
    const onMove = (e: MouseEvent): void => seekTo(timeFromPointer(e.clientX));
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousemove', onMove);
    };
  }, [scrubbing, seekTo, timeFromPointer]);

  const progressPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const seriesLine =
    item.kind === 'series'
      ? // Series metadata is not modelled yet; the folder name is the best
        // available label until seasons and episodes are scanned.
        item.folderName
      : [displayYear(item), item.metadata?.genres.slice(0, 2).join(', ')].filter(Boolean).join('  ·  ');

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-idle={idle && playing}
      onMouseMove={wake}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        autoPlay
        onClick={togglePlay}
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          setDuration(video.duration);
          // Resume once, after metadata — setting currentTime earlier is a no-op.
          if (!resumed.current && startAt > 0 && startAt < video.duration - 5) {
            video.currentTime = startAt;
          }
          resumed.current = true;
        }}
        onTimeUpdate={(e) => {
          const video = e.currentTarget;
          setCurrent(video.currentTime);
          if (video.buffered.length > 0) {
            setBuffered(video.buffered.end(video.buffered.length - 1));
          }
          const now = Date.now();
          if (now - lastSave.current > SAVE_EVERY_MS) {
            lastSave.current = now;
            persist(video.currentTime, video.duration);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          const video = videoRef.current;
          if (video) persist(video.duration, video.duration);
        }}
        onError={() => {
          const ext = item.video.ext.toUpperCase();
          setError(
            `This file could not be played. ${ext} with this codec is not supported by the built-in player.`
          );
          setWaiting(false);
        }}
      >
        {tracks.map((track, i) => (
          <track key={track.url} kind="subtitles" label={track.label} src={track.url} default={i === activeTrack} />
        ))}
      </video>

      {waiting && !error && <div className={styles.spinner} />}

      {error && (
        <div className={styles.error}>
          {error}
          <div className={styles.errorHint}>
            Phase 2 will bundle mpv for the formats Chromium cannot decode — chiefly .mkv and
            10-bit HEVC.
          </div>
        </div>
      )}

      <div className={styles.chrome} data-visible={!idle || !playing}>
        <div className={styles.header}>
          <button type="button" className={styles.back} aria-label="Back" onClick={stopPlaying}>
            <Icon name="chevron-left" size={22} />
          </button>
          <div className={styles.titles}>
            <h1 className={styles.title}>{displayTitle(item)}</h1>
            {seriesLine && <div className={styles.subtitleLine}>{seriesLine}</div>}
          </div>
        </div>

        {!playing && !waiting && !error && (
          <button type="button" className={styles.bigPlay} aria-label="Play" onClick={togglePlay}>
            <Icon name="play" size={34} />
          </button>
        )}

        <div className={styles.controls}>
          <div className={styles.times}>
            <span>{formatTime(current)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div
            ref={scrubRef}
            className={styles.scrub}
            data-scrubbing={scrubbing}
            onMouseMove={onScrubMove}
            onMouseLeave={() => setHoverTime(null)}
            onMouseDown={(e) => {
              setScrubbing(true);
              seekTo(timeFromPointer(e.clientX));
            }}
          >
            <div className={styles.scrubTrack}>
              <div className={styles.buffered} style={{ width: `${bufferedPct}%` }} />
              <div className={styles.played} style={{ width: `${progressPct}%` }} />
              <div className={styles.knob} style={{ left: `${progressPct}%` }} />
            </div>

            {hoverTime !== null && (
              <div className={styles.preview} style={{ left: hoverX }}>
                <canvas ref={canvasRef} className={styles.previewCanvas} />
                <div className={styles.previewTime}>{formatTime(hoverTime)}</div>
              </div>
            )}
          </div>

          <div className={styles.row}>
            <div className={styles.spacerLeft}>
              <div className={styles.volumeWrap}>
                <button
                  type="button"
                  className={styles.ctrl}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  onClick={() => setMuted((v) => !v)}
                >
                  <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={19} />
                </button>
                <div className={styles.volumeSlider}>
                  <input
                    className={styles.range}
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    aria-label="Volume"
                    onChange={(e) => {
                      setVolume(Number(e.target.value));
                      setMuted(false);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className={styles.center}>
              <button
                type="button"
                className={`${styles.ctrl} ${styles.skipWrap}`}
                aria-label="Back 10 seconds"
                onClick={() => skip(-SKIP)}
              >
                <Icon name="skip-back" size={22} />
                <span className={styles.skipLabel}>10</span>
              </button>

              <button
                type="button"
                className={`${styles.ctrl} ${styles.playPause}`}
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={togglePlay}
              >
                <Icon name={playing ? 'pause' : 'play'} size={24} />
              </button>

              <button
                type="button"
                className={`${styles.ctrl} ${styles.skipWrap}`}
                aria-label="Forward 10 seconds"
                onClick={() => skip(SKIP)}
              >
                <Icon name="skip-forward" size={22} />
                <span className={styles.skipLabel}>10</span>
              </button>
            </div>

            <div className={styles.spacerRight}>
              <button
                type="button"
                className={styles.ctrl}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                onClick={toggleFullscreen}
              >
                <Icon name={fullscreen ? 'collapse' : 'expand'} size={18} />
              </button>

              <div className={styles.menuWrap}>
                <button
                  type="button"
                  className={styles.ctrl}
                  aria-label="Settings"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <Icon name="more" size={18} />
                </button>

                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    <div className={styles.menuLabel}>Subtitles</div>
                    <button
                      type="button"
                      className={styles.menuItem}
                      data-active={activeTrack === -1}
                      onClick={() => setActiveTrack(-1)}
                    >
                      <span className={styles.menuItemLabel}>Off</span>
                      <Icon name="check" size={14} className={styles.menuCheck} />
                    </button>
                    {tracks.length === 0 ? (
                      <div className={styles.menuLabel} style={{ textTransform: 'none' }}>
                        None found next to the video
                      </div>
                    ) : (
                      tracks.map((track, i) => (
                        <button
                          key={track.url}
                          type="button"
                          className={styles.menuItem}
                          data-active={activeTrack === i}
                          onClick={() => setActiveTrack(i)}
                        >
                          <span className={styles.menuItemLabel}>{track.label}</span>
                          <Icon name="check" size={14} className={styles.menuCheck} />
                        </button>
                      ))
                    )}

                    <div className={styles.menuDivider} />
                    <div className={styles.menuLabel}>Speed</div>
                    {SPEEDS.map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        className={styles.menuItem}
                        data-active={rate === speed}
                        onClick={() => setRate(speed)}
                      >
                        <span className={styles.menuItemLabel}>
                          {speed === 1 ? 'Normal' : `${speed}×`}
                        </span>
                        <Icon name="check" size={14} className={styles.menuCheck} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
