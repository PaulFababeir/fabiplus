import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { toMovieUrl } from '@shared/media-url';
import { nextEpisode } from '@shared/next-episode';
import { subtitleFileName } from '@shared/subtitles';
import type { Episode, LibraryItem, Season, SubtitleOption } from '@shared/types';
import { displayTitle, displayYear, runtimeLabel } from '@renderer/lib/selectors';
import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useOnClickOutside } from '@renderer/lib/useDismiss';
import { useScrubPreview } from './useScrubPreview';
import { PlayerInfo } from './PlayerInfo';
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

/**
 * The season holding an episode.
 *
 * Returns the season rather than its label because two things want it now: the
 * subtitle line under the title, and the episode drawer, which offers exactly
 * this season's episodes and nothing else.
 */
function episodeSeason(item: LibraryItem, episode: Episode | null): Season | null {
  if (episode === null) return null;
  return (item.seasons ?? []).find((s) => s.episodes.some((e) => e.id === episode.id)) ?? null;
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
  /** What `ended` rolls into. Null for a film, or at the end of a show. */
  const upNext = useMemo(
    () => (episode === null ? null : nextEpisode(item, episode.id)),
    [item, episode]
  );
  /*
   * Only the current season is offered. A show's full episode list is the
   * sidebar's job; mid-film the useful question is "what else is in this run",
   * and a flat strip of every season would need a picker of its own inside a
   * bar that is already full.
   */
  const season = useMemo(() => episodeSeason(item, episode), [item, episode]);
  const episodeList = season?.episodes ?? [];

  const stopPlaying = useUi((s) => s.stopPlaying);
  const play = useUi((s) => s.play);
  const setPlayback = useUi((s) => s.setPlayback);
  const setProgress = useProfile((s) => s.setProgress);
  const reloadLibrary = useLibrary((s) => s.load);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
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
  const [episodesOpen, setEpisodesOpen] = useState(false);
  /** Chrome pinned shut by the hide button, independent of the idle timer. */
  const [forcedHidden, setForcedHidden] = useState(false);
  /**
   * The details panel. Kept outside `.chrome` when rendered, so it stays put
   * while the controls fade — reading a cast list takes longer than the idle
   * timeout, and having it vanish mid-scroll would be maddening.
   */
  const [infoOpen, setInfoOpen] = useState(false);
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

  /**
   * Resolved through main before loading: a file whose audio Chromium cannot
   * decode is converted once and served from cache, everything else resolves
   * to itself. Held in state rather than derived so the conversion happens
   * before the element is given a source, not after it has failed.
   */
  const [playablePath, setPlayablePath] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPlayablePath(null);
    setPreparing(0);

    const stop = window.api.onPrepareProgress((fraction) => {
      if (!cancelled) setPreparing(fraction);
    });

    void window.api.prepareVideo(video.path).then((result) => {
      if (cancelled) return;
      if (result.error !== null) setError(`This file could not be prepared. ${result.error}`);
      setPlayablePath(result.path || video.path);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [video.path]);

  const src = useMemo(
    () => (playablePath === null ? '' : toMovieUrl(playablePath)),
    [playablePath]
  );

  /*
   * Convert the next episode while this one plays.
   *
   * Audio Chromium cannot decode is converted before playback, and on a real
   * DDP5.1 episode that is minutes, not seconds — long enough that
   * next-episode autoplay felt broken. An episode is fifty minutes of runway,
   * so doing it now makes the wait disappear for everything after the first.
   *
   * Gated on `playablePath` so the two conversions never overlap: starting the
   * next one while this one is still converting would halve the speed of the
   * file the viewer is actually waiting for. Files that need no conversion
   * cost a header read and return immediately.
   */
  useEffect(() => {
    if (upNext === null || playablePath === null) return;
    void window.api.prewarmVideo(upNext.video.path).catch(() => undefined);
  }, [upNext, playablePath]);

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

  /**
   * Languages available online. Null until asked for, so opening the menu never
   * reaches the network on its own — the app works offline and should not start
   * making requests because someone looked at the settings.
   */
  const [online, setOnline] = useState<SubtitleOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const searchOnline = useCallback(async (): Promise<void> => {
    setSearching(true);
    try {
      setOnline(await window.api.findSubtitlesOnline(video.path));
    } finally {
      setSearching(false);
    }
  }, [video.path]);

  /**
   * Downloads one language and picks it up immediately.
   *
   * The file lands beside the video, so the returned list is what a rescan
   * would have found — no separate bookkeeping, and the track appears in the
   * list above without leaving the player.
   */
  const downloadOne = useCallback(
    async (option: SubtitleOption): Promise<void> => {
      setDownloading(option.code);
      try {
        const found = await window.api.downloadSubtitle(video.path, option.path, option.language);
        if (found.length > 0) setSubtitleFiles(found);
        await reloadLibrary();
      } finally {
        setDownloading(null);
      }
    },
    [video.path, reloadLibrary]
  );

  // A different file has a different set; keep nothing from the last one.
  useEffect(() => {
    setOnline(null);
  }, [video.path]);

  /**
   * Which offered languages are already sitting beside the video.
   *
   * Matched on the filename `subtitleFileName` produces rather than on the
   * track label: `subtitleLabel` reads a single trailing word, so anything like
   * "Portuguese (Brazil)" comes back as "Default" and would never line up.
   * Comparing the name main actually wrote is exact for every language.
   */
  const downloaded = useMemo(() => {
    const fileName = video.path.split(/[\\/]/).pop() ?? '';
    const have = subtitleFiles.map((f) => f.path.toLowerCase());
    const owned = new Set<string>();

    for (const option of online ?? []) {
      const expected = subtitleFileName(fileName, option.language).toLowerCase();
      if (have.some((p) => p.endsWith(expected))) owned.add(option.code);
    }
    return owned;
  }, [online, subtitleFiles, video.path]);

  useEffect(
    () => setSubtitleFiles(episode?.subtitles ?? item.subtitles),
    [episode, item.subtitles]
  );

  /**
   * Tracks stored inside the container, which `<track>` cannot read in place.
   * Appended to whatever sits beside the file, so a sidecar still comes first.
   */
  useEffect(() => {
    let cancelled = false;
    void window.api.embeddedSubtitles(video.path).then((found) => {
      if (cancelled || found.length === 0) return;
      setSubtitleFiles((current) => {
        const known = new Set(current.map((f) => f.path));
        return [...current, ...found.filter((f) => !known.has(f.path))];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [video.path]);

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
      // Main wrote the result to the catalog; pull it in so the in-memory copy
      // matches and the tracks are still there next time this film is opened.
      await reloadLibrary();
    } finally {
      setRescanning(false);
    }
  }, [folderPath, reloadLibrary]);

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
          // Peels one layer per press: panel, then fullscreen, then the player.
          if (infoOpen) setInfoOpen(false);
          else if (document.fullscreenElement) void document.exitFullscreen();
          else stopPlaying();
          break;
        default:
          return;
      }
      // Every recognised shortcut is an interaction with the film, so the panel
      // gets out of the way — the same rule the pointer handler follows.
      setInfoOpen(false);
      wake();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cycleSubtitle, infoOpen, skip, stopPlaying, toggleFullscreen, togglePlay, wake]);

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

  /*
   * A wheel scrolls the episode strip sideways.
   *
   * A mouse reports its wheel as deltaY, and an `overflow-x` scroller ignores
   * that entirely — the strip sat still unless you held Shift or dragged the
   * bar, which is not discoverable. A trackpad's own sideways gesture arrives
   * as deltaX and is left alone, so two-finger swiping still behaves natively.
   *
   * Registered by hand rather than through React's `onWheel`, because React
   * attaches wheel listeners as passive: preventDefault there is a no-op and
   * the console says so. Keyed on `episodesOpen` since the strip only exists
   * while the drawer is open.
   */
  useEffect(() => {
    const el = stripRef.current;
    if (el === null) return;

    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      // Some mice report lines rather than pixels; a line is about 16px.
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [episodesOpen]);

  /*
   * Forced hide wins outright; otherwise chrome only fades while playing — and
   * not while the episode drawer is open, which is a list to read rather than a
   * control to press. Left alone it faded out from under the pointer after
   * 2.6s, taking the drawer with it.
   */
  const chromeHidden = forcedHidden || (idle && playing && !episodesOpen);

  const progressPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  /** Under the title: the show and episode for a series, year and genre for a film. */
  const seriesLine =
    item.kind === 'series'
      ? [
          displayTitle(item),
          season?.label ?? null,
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
      /*
       * Touching the film closes the details panel — pause, seek, skip, the
       * picture itself. Two exclusions: the panel's own contents, where a click
       * is reading rather than interacting, and the toggle, which owns its own
       * open/close. Without the second the button could never open the panel,
       * because pointerdown lands here before its click ever fires.
       */
      onPointerDown={(e) => {
        if (!infoOpen) return;
        const t = e.target as HTMLElement;
        if (t.closest('[data-info-panel]') || t.closest('[data-info-toggle]')) return;
        setInfoOpen(false);
      }}
      /*
       * Only the video surface toggles fullscreen. The handler sits on the root
       * so a double-click anywhere on the picture works, but that also caught
       * double-clicks on the controls — jabbing skip or pause twice threw the
       * window in and out of fullscreen.
       */
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest(`.${styles.chrome}`)) return;
        toggleFullscreen();
      }}
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

          /*
           * Roll into the next episode. The shell keys the player on the
           * episode id, so this remounts with a fresh source and a resume
           * position read back from the profile — nothing here has to reset.
           *
           * Only on a genuine `ended`: reaching the credits is the one
           * unambiguous signal that the viewer wants what comes next.
           */
          if (upNext) {
            setOsd(`Next: ${upNext.title ?? `Episode ${upNext.number ?? ''}`.trim()}`);
            play(item.id, upNext.id);
          }
        }}
        onError={() => {
          /*
           * Do not blame the container here. Matroska and HEVC were both
           * assumed unplayable and both were measured playing natively on this
           * Electron — see `audio-support.ts`. Audio Chromium cannot decode is
           * converted before this element is given a source, so what is left is
           * the video stream itself.
           */
          setError(
            `This file could not be played. Its video stream is in a format the built-in player cannot decode (${video.ext.toUpperCase()}).`
          );
          setWaiting(false);
        }}
      >
        {tracks.map((track, i) => (
          <track key={track.url} kind="subtitles" label={track.label} src={track.url} default={i === activeTrack} />
        ))}
      </video>

      {/*
        Converting is a one-off wait measured in seconds, not a stall, so it
        says so rather than showing the same spinner as buffering.
      */}
      {playablePath === null && !error ? (
        <div className={styles.preparing}>
          <div className={styles.spinner} />
          <span className={styles.preparingLabel}>
            {preparing > 0
              ? `Converting audio for playback… ${Math.round(preparing * 100)}%`
              : 'Checking this file…'}
          </span>
        </div>
      ) : (
        waiting && !error && <div className={styles.spinner} />
      )}

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
            Bundling mpv would cover the codecs Chromium cannot decode.
          </div>
        </div>
      )}



      {/*
        Outside `.chrome`, so it survives the controls fading — reading a cast
        list takes longer than the idle timeout. Declared *before* it, though,
        so the control bar paints over the panel's bottom edge rather than the
        panel burying the very button that opened it.
      */}
      <AnimatePresence>
        {infoOpen && <PlayerInfo item={item} onClose={() => setInfoOpen(false)} />}
      </AnimatePresence>

      <div className={styles.chrome} data-visible={!chromeHidden}>
        <div className={styles.header}>
          <IconButton
            icon="chevron-left"
            label="Back"
            size="xl"
            onArtwork
            className={styles.back}
            onClick={stopPlaying}
          />
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
              {/*
                Only for a series, and only once the season is known — a film
                has nothing to list, and an empty drawer is worse than no
                button. Labelled rather than icon-only: every other control in
                this bar is a universally understood glyph and this one is not.
              */}
              {episodeList.length > 0 && (
                <button
                  type="button"
                  className={styles.episodesToggle}
                  data-open={episodesOpen}
                  aria-expanded={episodesOpen}
                  aria-controls="player-episodes"
                  onClick={() => setEpisodesOpen((v) => !v)}
                >
                  <span>Episodes</span>
                  <Icon name="chevron-down" size={14} />
                </button>
              )}

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
                aria-label={infoOpen ? 'Hide film details' : 'Show film details'}
                title={infoOpen ? 'Hide film details' : 'Show film details'}
                aria-pressed={infoOpen}
                data-active={infoOpen}
                data-info-toggle="true"
                onClick={() => setInfoOpen((v) => !v)}
              >
                <Icon name="info" size={20} />
              </button>

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

                    {/*
                      Downloading, so a film with nothing beside it does not
                      send the user out to a browser and a file manager.
                      Searched only when asked: it is a network call, and the
                      app is otherwise usable with the network off.
                    */}
                    <div className={styles.menuDivider} />
                    <div className={styles.menuLabel}>Download</div>

                    {online === null ? (
                      <button
                        type="button"
                        className={styles.menuItem}
                        disabled={searching}
                        onClick={() => void searchOnline()}
                      >
                        <span className={styles.menuItemLabel}>
                          {searching ? 'Searching…' : 'Find subtitles online'}
                        </span>
                      </button>
                    ) : online.length === 0 ? (
                      <div className={styles.menuLabel} style={{ textTransform: 'none' }}>
                        Nothing found for this release
                      </div>
                    ) : (
                      online.map((option) => (
                        <button
                          key={option.code}
                          type="button"
                          className={styles.menuItem}
                          // Already on disk, so there is nothing to fetch. The
                          // track itself is in the list above.
                          data-active={downloaded.has(option.code)}
                          disabled={downloading !== null || downloaded.has(option.code)}
                          onClick={() => void downloadOne(option)}
                        >
                          <span className={styles.menuItemLabel}>{option.language}</span>
                          {downloaded.has(option.code) ? (
                            <Icon name="check" size={14} className={styles.menuCheck} />
                          ) : (
                            <span className={styles.menuHint}>
                              {downloading === option.code ? 'Saving…' : 'Download'}
                            </span>
                          )}
                        </button>
                      ))
                    )}

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

          {/*
            Below the control row and inside `.controls`, which is anchored to
            `bottom: 0` — so the drawer growing is what pushes the scrub bar and
            the buttons upward. The controls are not separately animated; they
            are simply displaced by this.
          */}
          <AnimatePresence initial={false}>
            {episodesOpen && episodeList.length > 0 && (
              <motion.div
                id="player-episodes"
                className={styles.episodesWrap}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={styles.episodeStrip} ref={stripRef}>
                  {episodeList.map((ep) => {
                    const number = ep.number === null ? null : String(ep.number).padStart(2, '0');
                    const epLabel = ep.title ?? `Episode ${number ?? '?'}`;
                    const current = ep.id === episode?.id;

                    return (
                      /*
                        The card is the control. A 400px target with a 30px
                        button in the corner asks the user to aim at the corner
                        for no reason — everything on the card describes the
                        one thing it does.
                      */
                      <button
                        key={ep.id}
                        type="button"
                        className={styles.episodeCard}
                        data-current={current}
                        aria-current={current ? 'true' : undefined}
                        aria-label={current ? `Restart ${epLabel}` : `Play ${epLabel}`}
                        onClick={() => {
                          play(item.id, ep.id);
                          setEpisodesOpen(false);
                        }}
                      >
                        {ep.still ? (
                          <img
                            className={styles.episodeStill}
                            src={toMovieUrl(ep.still.localPath)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                          />
                        ) : (
                          <div className={styles.episodeStill} data-placeholder="true">
                            <Icon name="image" size={18} />
                          </div>
                        )}

                        <div className={styles.episodeHead}>
                          <span className={styles.episodeTitle}>
                            {number && <span className={styles.episodeNum}>{number}</span>}
                            {epLabel}
                          </span>
                          <span className={styles.episodeTime}>
                            {runtimeLabel(ep.runtimeMin) ?? '—'}
                          </span>
                        </div>

                        {/*
                          Synopses arrive with enrichment, so a catalog that has
                          not been refetched since they were added shows the
                          placeholder rather than a collapsed card.
                        */}
                        <p className={styles.episodeDesc} data-empty={!ep.overview}>
                          {ep.overview ? ep.overview : 'No synopsis.'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/*
        Somewhere to pick the window up by. The player covers the shell’s own
        title strip, so without this a playing window cannot be dragged to
        another monitor at all.

        Last on purpose. Chromium builds the drag region by walking the tree
        in order — union for `drag`, difference for `no-drag` — so `.chrome`,
        which is no-drag and covers `inset: 0`, subtracts anything declared
        before it. Sitting earlier in the tree this band existed and did
        nothing, however it was stacked; z-index has no say in it.
      */}
      <div className={styles.dragBand} />
    </motion.div>
  );
}