/**
 * Mirrors `AUTO_ACCEPT` from the main-process matcher. Duplicated rather than
 * imported because the renderer must not reach into main; the matcher test
 * suite owns the authoritative value.
 */
export const AUTO_ACCEPT_UI = 0.75;
