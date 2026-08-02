/**
 * Inline SVG icons. Kept local rather than pulled from a package so the
 * renderer has no icon-font dependency and the CSP can stay strict.
 */

type IconName =
  | 'search'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'play'
  | 'plus'
  | 'trash'
  | 'close'
  | 'settings'
  | 'swap'
  | 'user'
  | 'pause'
  | 'skip-back'
  | 'skip-forward'
  | 'step-back'
  | 'step-forward'
  | 'volume'
  | 'mute'
  | 'expand'
  | 'collapse'
  | 'more'
  | 'check'
  | 'arrow-left'
  | 'eye-off'
  | 'maximize';

const PATHS: Record<IconName, string> = {
  search: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-left': 'm15 6-6 6 6 6',
  'chevron-right': 'm9 6 6 6-6 6',
  /*
   * Spans x 7→18, so the bounding box centres on 12.5 — a hair right of the
   * viewBox centre, which is where a right-pointing triangle needs to sit to
   * look centred. The old path ran 8→19 and had to be nudged by hand at every
   * call site, each with a different value.
   */
  play: 'M7 5v14l11-7z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  close: 'M6 6l12 12M18 6 6 18',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.5-3a8.5 8.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8.4 8.4 0 0 0-2-1.2L15.6 2h-3.9l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a8.5 8.5 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h3.9l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  swap: 'M4 7h13l-3-3M20 17H7l3 3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14Z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  // Skip glyphs carry the "10" as part of the circular-arrow mark.
  'skip-back': 'M11.5 5V2L7 6l4.5 4V7a6 6 0 1 1-6 6',
  'skip-forward': 'M12.5 5V2L17 6l-4.5 4V7a6 6 0 1 0 6 6',
  'step-back': 'M19 5v14l-11-7zM6 5v14',
  'step-forward': 'M5 5v14l11-7zM18 5v14',
  volume: 'M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9H4Zm12 1 5 5m0-5-5 5',
  expand: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
  collapse: 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5',
  more: 'M12 6.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm0 6.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm0 6.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z',
  check: 'm5 13 4 4L19 7',
  'arrow-left': 'M19 12H5m0 0 6-6m-6 6 6 6',
  'eye-off': 'M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.4 3.3M6.2 6.7C4 8.2 3 10.4 3 12c0 2.5 4 7 9 7 1.3 0 2.5-.3 3.6-.8',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'
};

/** Icons drawn as filled shapes rather than strokes. */
const FILLED = new Set<IconName>(['play', 'search', 'user', 'pause', 'more', 'step-back', 'step-forward']);

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps): React.JSX.Element {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
