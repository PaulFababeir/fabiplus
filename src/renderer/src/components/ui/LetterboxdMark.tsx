/**
 * Letterboxd's three-dot mark.
 *
 * Geometry copied verbatim from their official `letterboxd-logo-v-neg-rgb.svg`
 * rather than redrawn. An earlier hand-made version had the dots merely
 * overlapping, which is wrong twice over: the real mark has *white lenses*
 * where they cross, and drawn in one colour the three circles fuse into a
 * lozenge that reads as an ellipsis. Both are visible at 14px.
 *
 * Not an `Icon`. That component paints a single path in `currentColor`, and
 * this needs five shapes in four fixed colours — they belong to someone else's
 * brand, so they must not follow this app's theme the way a design value would.
 *
 * The source viewBox is the `Dots` group with its translate removed, so the
 * mark is 262×97 and therefore markedly wider than it is tall.
 */
const RATIO = 262 / 97;

export function LetterboxdMark({ height = 14 }: { height?: number }): React.JSX.Element {
  return (
    <svg
      width={Math.round(height * RATIO)}
      height={height}
      viewBox="0 0 262 97"
      fill="none"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse fill="#40BCF4" cx="213.426966" cy="48.5" rx="48.5730337" ry="48.5" />
      <ellipse fill="#00E054" cx="131" cy="48.5" rx="48.5730337" ry="48.5" />
      <ellipse fill="#FF8000" cx="48.5730337" cy="48.5" rx="48.5730337" ry="48.5" />
      {/* The lenses where the dots cross. Without these it is not the logo. */}
      <path
        fill="#FFFFFF"
        d="M89.7865169,74.179439 C85.1226166,66.7324866 82.4269663,57.9305714 82.4269663,48.5 C82.4269663,39.0694286 85.1226166,30.2675134 89.7865169,22.820561 C94.4504171,30.2675134 97.1460674,39.0694286 97.1460674,48.5 C97.1460674,57.9305714 94.4504171,66.7324866 89.7865169,74.179439 Z"
      />
      <path
        fill="#FFFFFF"
        d="M172.213483,22.820561 C176.877383,30.2675134 179.573034,39.0694286 179.573034,48.5 C179.573034,57.9305714 176.877383,66.7324866 172.213483,74.179439 C167.549583,66.7324866 164.853933,57.9305714 164.853933,48.5 C164.853933,39.0694286 167.549583,30.2675134 172.213483,22.820561 Z"
      />
    </svg>
  );
}
