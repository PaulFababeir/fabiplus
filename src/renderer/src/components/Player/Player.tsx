import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';

import { toMovieUrl } from '@shared/media-url';
import type { Episode, LibraryItem } from '@shared/types';
import { displayTitle, displayYear } from '@renderer/lib/selectors';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import { useOnClickOutside } from '@renderer/lib/useDismiss';
import { useScrubPreview } from './useScrubPreview';
import styles from './Player.module.css';

/** Seconds the skip buttons jump. */
const SKIP = 10;
/** How long the pointer must rest before the chrome fades out. */
const IDLE_MS = 2600;
/** Progress is persisted at most this often — every frame would thrash disk. */
const SAVE_EVERY_MS = 5000;
/** How far the pointer must travel to release a forced hide. */
const FORCE_HIDE_RELEASE_PX = 14;
/** How long an on-screen notice lingers. */
const OSD_MS = 1500;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const BRIGHTNESS = [1, 1.1, 1.2, 1.3] as const;

/**
 * Gamma applied to files that declare an HDR transfer. Chromium tone-maps
 * those for an SDR display and the result sits well below what VLC shows,
 * because release groups routinely tag SDR-graded "HYBRID" encodes as HDR.
 * An exponent below 1 lifts the midtones the tone mapper pulled down.
 */
const HDR_GAMMA = 0.72;

/** The label of the season holding an episode, for the player's subtitle line. */
function episodeSeason(item: LibraryItem, episode: Episode | null): string | null {
  if (episode === null) return null;
  const season = (item.seasons ?? []).find((s) => s.episodes.some((e) => e.id === episode.id));
  return season?.label ?? null;
}

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
  /**
   * The episode to play, for a series. Null plays the item's own file, which is
   * a film's feature.
   */
  episode: Episode | null;
  /** Where playback should resume from, in seconds. */
  startAt: number;
}

export function Player({ item, episode, startAt }: PlayerProps): React.JSX.Element {
  /**
   * Everything below plays one file and stores progress against one id. For a
   * show that is the episode, not the series — otherwise all of Sherlock would
   * share a single resume position.
   */
  const video = episode?.video ?? item.video;
  const progressId = episode?.id ?? item.id;
  const folderPath = episode?.folderPath ?? item.folderPath;
  const stopPlaying = useUi((s) => s.stopPlaying);
  const setPlayback = useUi((s) => s.setPlayback);
  const setProgress = useProfile((s) => s.setProgress);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** True while a click gesture began with the menu open. */
  const menuWasOpen = useRef(false);
  /** Pointer position when chrome was force-hidden, to ignore jitter. */
  const hiddenAt = useRef<{ x: number; y: number } | null>(null);
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
  /** Chrome pinned shut by the hide button, independent of the idle timer. */
  const [forcedHidden, setForcedHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Transient notice, VLC-style, so a blind cycle still tells you where it landed. */
  const [osd, setOsd] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(1);
  const [hdrTagged, setHdrTagged] = useState(false);
  const [compensateHdr, setCompensateHdr] = useState(true);

  // Persisted, so it is set once rather than per film.
  useEffect(() => {
    void window.api.getConfig().then((config) => setBrightness(config.videoBrightness));
  }, []);

  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const src = useMemo(() => toMovieUrl(video.path), [video.path]);

  // A file tagged PQ or HLG will be tone-mapped by Chromium; knowing that up
  // front lets the correction be on before the first frame is judged.
  useEffect(() => {
    let cancelled = false;
    void window.api.probeVideoColour(video.path).then((colour) => {
      if (!cancelled) setHdrTagged(colour.hdr);
    });
    return () => {
      cancelled = true;
    };
  }, [video.path]);
  const { canvasRef, requestFrame } = useScrubPreview(src);

  // --- Subtitles ----------------------------------------------------------
  const [tracks, setTracks] = useState<Array<{ label: string; url: string }>>([]);
  const [activeTrack, setActiveTrack] = useState(-1);
  /**
   * Starts from the catalog but can be replaced by a rescan, so a subtitle
   * added while the app is open can be picked up without a full library scan.
   */
  const [subtitleFiles, setSubtitleFiles] = useState(episode?.subtitles ?? item.subtitles);
  const [rescanning, setRescanning] = useState(false);

  useEffect(
    () => setSubtitleFiles(episode?.subtitles ?? item.subtitles),
    [episode, item.subtitles]
  );

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    void (async () => {
      const loaded: Array<{ label: string; url: string }> = [];
      for (const sub of subtitleFiles) {
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
  }, [subtitleFiles]);

  /**
   * Re-reads the film's folder. The selection is dropped rather than remapped:
   * indices refer to positions in the old list, and silently pointing at a
   * different language is worse than asking the user to pick again.
   */
  const refreshSubtitles = useCallback(async (): Promise<void> => {
    setRescanning(true);
    try {
      const found = await window.api.rescanSubtitles(folderPath);
      setActiveTrack(-1);
      setSubtitleFiles(found);
    } finally {
      setRescanning(false);
    }
  }, [folderPath]);

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

  /**
   * Records that the gesture began with the menu open, so the video's click
   * handler can tell it merely dismissed the menu and skip toggling playback.
   */
  const dismissMenu = useCallback(() => {
    menuWasOpen.current = true;
    setMenuOpen(false);
  }, []);

  useOnClickOutside(menuRef, dismissMenu, menuOpen);

  // --- Persistence --------------------------------------------------------

  const persist = useCallback(
    (position: number, total: number) => {
      if (total <= 0) return;
      void setProgress(progressId, position, total);
    },
    [progressId, setProgress]
  );

  // Save on the way out so a mid-film exit is never lost.
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video && video.duration > 0) persist(video.currentTime, video.duration);
    };
  }, [persist]);

  /**
   * Mirrors playback into the store, where the shell turns it into the Discord
   * presence. Pushed when play/pause flips or the position moves by more than a
   * minute — enough for a seek to show up, without a store write on every
   * timeupdate tick.
   *
   * The player deliberately does not talk to Discord itself: it cannot describe
   * the library view, and clearing the presence on unmount is what let Discord
   * fall back to its bare detected-app activity.
   */
  useEffect(() => {
    setPlayback({ playing, positionSec: current, durationSec: duration });
    // `current` is intentionally absent: including it would fire every tick.
  }, [playing, duration, setPlayback, Math.floor(current / 60)]);

  // --- Idle chrome --------------------------------------------------------

  /**
   * Brings the chrome back and restarts the idle countdown. A force-hide is
   * only released once the pointer has genuinely moved — otherwise the mouse
   * still resting on the hide button would undo it immediately.
   */
  const wake = useCallback((event?: React.MouseEvent) => {
    if (hiddenAt.current) {
      // Pointer movement must clear the threshold, but a keypress (no event)
      // always counts as intent — otherwise the controls would stay pinned
      // shut while the user is clearly interacting.
      if (event) {
        const dx = event.clientX - hiddenAt.current.x;
        const dy = event.clientY - hiddenAt.current.y;
        if (Math.hypot(dx, dy) < FORCE_HIDE_RELEASE_PX) return;
      }
      hiddenAt.current = null;
      setForcedHidden(false);
    }

    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  const hideChrome = useCallback((event: React.MouseEvent): void => {
    hiddenAt.current = { x: event.clientX, y: event.clientY };
    setMenuOpen(false);
    setForcedHidden(true);
    setIdle(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake]);

  useEffect(() => {
    if (!osd) return;
    const timer = setTimeout(() => setOsd(null), OSD_MS);
    return () => clearTimeout(timer);
  }, [osd]);

  // --- Controls -----------------------------------------------------------

  /**
   * Steps Off → track 1 → track 2 → … → Off, matching VLC's `v`.
   * Declared with the tracks in scope so the wrap point follows what actually
   * loaded rather than a stale count.
   */
  const cycleSubtitle = useCallback(() => {
    setActiveTrack((current) => {
      const next = current + 1 >= tracks.length ? -1 : current + 1;
      const label = next === -1 ? 'Subtitles off' : (tracks[next]?.label ?? 'Subtitles');
      setOsd(label);
      return next;
    });
  }, [tracks]);

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
        case 'v':
          cycleSubtitle();
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
  }, [cycleSubtitle, skip, stopPlaying, toggleFullscreen, togglePlay, wake]);

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

  // Forced hide wins outright; otherwise chrome only fades while playing.
  const chromeHidden = forcedHidden || (idle && playing);

  const progressPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  /** Under the title: the show and episode for a series, year and genre for a film. */
  const seriesLine =
    item.kind === 'series'
      ? [
          displayTitle(item),
          episodeSeason(item, episode),
          episode?.number === null || episode === null
            ? null
            : `Episode ${String(episode.number).padStart(2, '0')}`
        ]
          .filter(Boolean)
          .join('  ·  ')
      : [displayYear(item), item.metadata?.genres.slice(0, 2).join(', ')].filter(Boolean).join('  ·  ');

  return (
    <motion.div
      ref={rootRef}
      className={styles.root}
      // Fades and settles on the way in, and reverses on exit so returning to
      // the library is a transition rather than a hard cut.
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      data-idle={chromeHidden}
      data-chrome={!chromeHidden}
      onMouseMove={wake}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className={styles.video}
        style={
          {
            '--video-brightness': brightness,
            filter: `${hdrTagged && compensateHdr ? 'url(#hdrCompensate) ' : ''}brightness(${brightness})`
          } as React.CSSProperties
        }
        src={src}
        autoPlay
        onClick={() => {
          // A click that merely dismissed the menu should not also pause.
          if (menuWasOpen.current) {
            menuWasOpen.current = false;
            return;
          }
          togglePlay();
        }}
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
          // Naming the actual reason beats "unsupported": Matroska is refused
          // by the container alone, whatever is inside it.
          const ext = video.ext.toLowerCase();
          setError(
            ext === 'mkv'
              ? 'This file cannot be played. Chromium does not support the Matroska (.mkv) container, so the built-in player cannot open it regardless of the video codec inside.'
              : `This file could not be played. ${ext.toUpperCase()} with this codec is not supported by the built-in player.`
          );
          setWaiting(false);
        }}
      >
        {tracks.map((track, i) => (
          <track key={track.url} kind="subtitles" label={track.label} src={track.url} default={i === activeTrack} />
        ))}
      </video>

      {waiting && !error && <div className={styles.spinner} />}

      {osd && <div className={styles.osd}>{osd}</div>}

      {/*
        Gamma cannot be expressed with CSS filter functions, so the correction
        rides on an SVG filter referenced by url(). Zero-sized and hidden; it
        exists only to be pointed at.
      */}
      <svg className={styles.filterDefs} aria-hidden="true">
        <filter id="hdrCompensate" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" exponent={HDR_GAMMA} />
            <feFuncG type="gamma" exponent={HDR_GAMMA} />
            <feFuncB type="gamma" exponent={HDR_GAMMA} />
          </feComponentTransfer>
        </filter>
      </svg>

      {error && (
        <div className={styles.error}>
          {error}
          <div className={styles.errorHint}>
            Bundling mpv would cover the formats Chromium cannot decode: .mkv and
            10-bit HEVC.</div>
        </div>
      )}

      <div className={styles.chrome} data-visible={!chromeHidden}>
        <div className={styles.header}>
          <button type="button" className={styles.back} aria-label="Back" onClick={stopPlaying}>
            <Icon name="chevron-left" size={22} />
          </button>
          <div className={styles.titles}>
            <h1 className={styles.title}>{episode?.title ?? displayTitle(item)}</h1>
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
                aria-label="Hide controls"
                title="Hide controls"
                onClick={hideChrome}
              >
                <Icon name="chevron-down" size={20} />
              </button>

              <button
                type="button"
                className={styles.ctrl}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                onClick={toggleFullscreen}
              >
                <Icon name={fullscreen ? 'collapse' : 'expand'} size={18} />
              </button>

              <div className={styles.menuWrap} ref={menuRef}>
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

                    {/*
                      Subtitles are captured when the library is scanned, so one
                      downloaded mid-film is invisible until this is pressed.
                    */}
                    <button
                      type="button"
                      className={styles.menuItem}
                      disabled={rescanning}
                      onClick={() => void refreshSubtitles()}
                    >
                      <span className={styles.menuItemLabel}>
                        {rescanning ? 'Looking…' : 'Rescan for subtitles'}
                      </span>
                    </button>

                    {hdrTagged && (
                      <>
                        <div className={styles.menuDivider} />
                        <div className={styles.menuLabel}>HDR</div>
                        <button
                          type="button"
                          className={styles.menuItem}
                          data-active={compensateHdr}
                          onClick={() => setCompensateHdr((v) => !v)}
                        >
                          <span className={styles.menuItemLabel}>Compensate tone mapping</span>
                          <Icon name="check" size={14} className={styles.menuCheck} />
                        </button>
                      </>
                    )}

                    <div className={styles.menuDivider} />
                    <div className={styles.menuLabel}>Brightness</div>
                    {BRIGHTNESS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={styles.menuItem}
                        data-active={brightness === value}
                        onClick={() => {
                          setBrightness(value);
                          void window.api.setVideoBrightness(value);
                        }}
                      >
                        <span className={styles.menuItemLabel}>
                          {value === 1 ? 'Default' : `+${Math.round((value - 1) * 100)}%`}
                        </span>
                        <Icon name="check" size={14} className={styles.menuCheck} />
                      </button>
                    ))}

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
    </motion.div>
  );
}
