/**
 * Inline SVG icons. Kept local rather than pulled from a package so the
 * renderer has no icon-font dependency and the CSP can stay strict.
 */

export type IconName =
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
  | 'volume'
  | 'mute'
  | 'expand'
  | 'collapse'
  | 'more'
  | 'check'
  | 'eye-off'
  | 'maximize'
  | 'image'
  | 'pencil';

/** A value may be several paths when the mark cannot be drawn with one. */
const PATHS: Record<IconName, string | string[]> = {
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
  /*
   * Lucide's rotate-ccw / rotate-cw. The hand-drawn arcs they replace were
   * lopsided — the arrowhead sat off the circle and the two did not mirror —
   * which is exactly the kind of thing that reads as sloppy at 22px.
   */
  'skip-back': ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  'skip-forward': ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  volume: 'M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9H4Zm12 1 5 5m0-5-5 5',
  expand: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
  collapse: 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5',
  more: 'M12 6.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm0 6.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm0 6.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z',
  check: 'm5 13 4 4L19 7',
  'eye-off': 'M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.4 3.3M6.2 6.7C4 8.2 3 10.4 3 12c0 2.5 4 7 9 7 1.3 0 2.5-.3 3.6-.8',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  /* Frame, sun, horizon — the landscape reads as "backdrop" where a poster
     glyph would not, and both sit in the same tool cluster. */
  image: [
    'M4 4h16v16H4z',
    'M9.2 10.4a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4',
    'm4 16.5 4.2-4.2 3.3 3.3L15 12l5 5'
  ],
  pencil: ['M12 20h8', 'M16.2 3.8a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z']
};

/** Icons drawn as filled shapes rather than strokes. */
const FILLED = new Set<IconName>(['play', 'search', 'user', 'pause', 'more']);

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
      {(Array.isArray(PATHS[name]) ? PATHS[name] : [PATHS[name]]).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
