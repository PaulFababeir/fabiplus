/**
 * Letterboxd's three-dot mark, in their colours.
 *
 * Not an `Icon`. That component paints a single path in `currentColor`, which
 * is right for every glyph the app draws itself — but this mark is only
 * legible *because* of the three colours. Rendered monochrome the dots overlap
 * into one lozenge and read as an ellipsis, which is exactly what happened when
 * it lived in `Icon`.
 *
 * The hex values are deliberate raw literals rather than tokens: they belong to
 * someone else's brand, so they must not follow this app's theme the way a
 * design value would.
 */
const ORANGE = '#ff8000';
const GREEN = '#00e054';
const BLUE = '#40bcf4';

export function LetterboxdMark({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {/*
        Heavy overlap is the mark — the dots are meant to run into each other.
        Drawn left to right so the stacking matches the logo.
      */}
      <circle cx="6.8" cy="12" r="4.6" fill={ORANGE} />
      <circle cx="12" cy="12" r="4.6" fill={GREEN} />
      <circle cx="17.2" cy="12" r="4.6" fill={BLUE} />
    </svg>
  );
}
