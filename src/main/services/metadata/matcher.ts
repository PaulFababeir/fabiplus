import type { MatchStrategy } from '@shared/types';

/**
 * Decides which search result actually corresponds to a folder on disk.
 *
 * Kept free of any network or filesystem access so it can be tested against
 * the real library's problem cases offline.
 */

/** At or above this, the match is accepted without asking the user. */
export const AUTO_ACCEPT = 0.75;
/** Below this, we treat it as no match at all rather than guessing. */
export const REJECT_BELOW = 0.45;

const TITLE_WEIGHT = 0.75;
const YEAR_WEIGHT = 0.25;

/** A candidate from a provider search, reduced to what scoring needs. */
export interface Candidate {
  id: number;
  title: string;
  originalTitle: string;
  year: number | null;
  /** Provider popularity, used only to break ties. */
  popularity: number;
  /** Provider-side poster path. Display only — scoring ignores it. */
  posterPath?: string | null;
  /** Short synopsis, shown in the re-match dialog to disambiguate. */
  overview?: string;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  strategy: MatchStrategy;
}

/**
 * Folds case, accents and punctuation so "Amélie", "AMELIE" and "Amelie."
 * all compare equal. Accent folding matters for titles like "Affeksjonsverdi"
 * and "Timothée".
 */
export function normalizeTitle(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Character-bigram Dice coefficient: robust against typos and word order. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const gram = s.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const aGrams = bigrams(a);
  const bGrams = bigrams(b);

  let intersection = 0;
  let aTotal = 0;
  for (const [gram, count] of aGrams) {
    aTotal += count;
    const other = bGrams.get(gram);
    if (other) intersection += Math.min(count, other);
  }

  const bTotal = [...bGrams.values()].reduce((n, c) => n + c, 0);
  return (2 * intersection) / (aTotal + bTotal);
}

/**
 * Rewards a containment relationship so junk prefixes and suffixes don't sink
 * an otherwise correct match — "James Bond Casino Royale" contains
 * "Casino Royale", and "Kingsman The Secret Service Revealed" contains
 * "Kingsman The Secret Service".
 */
function titleSimilarity(parsed: string, candidate: string): number {
  const a = normalizeTitle(parsed);
  const b = normalizeTitle(candidate);
  if (a === b) return 1;

  const dice = diceCoefficient(a, b);

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter) && shorter.length >= 4) {
    // Scale by how much of the longer string the shorter one covers, so
    // "Heat" inside "Heat of the Night" does not score as a clean hit while
    // "Casino Royale" inside "James Bond Casino Royale" still does.
    const coverage = shorter.length / longer.length;
    return Math.max(dice, 0.45 + 0.55 * coverage);
  }

  return dice;
}

/** 1.0 for an exact year, tapering to 0 by four years out. */
function yearScore(parsedYear: number | null, candidateYear: number | null): number {
  if (parsedYear === null || candidateYear === null) return 0.5; // unknown, stay neutral
  const delta = Math.abs(parsedYear - candidateYear);
  if (delta === 0) return 1;
  if (delta === 1) return 0.8;
  if (delta === 2) return 0.45;
  if (delta <= 4) return 0.2;
  return 0;
}

function strategyFor(titleSim: number, parsedYear: number | null, candidateYear: number | null): MatchStrategy {
  const exactTitle = titleSim === 1;
  const exactYear = parsedYear !== null && parsedYear === candidateYear;
  if (exactTitle && exactYear) return 'exact';
  if (exactYear || (exactTitle && parsedYear === null)) return 'title-year';
  return 'fuzzy';
}

export function scoreCandidate(
  parsedTitle: string,
  parsedYear: number | null,
  candidate: Candidate
): ScoredCandidate {
  // Try both the localized and original title — "Affeksjonsverdi" is the
  // original title of a film TMDB lists in English.
  const titleSim = Math.max(
    titleSimilarity(parsedTitle, candidate.title),
    titleSimilarity(parsedTitle, candidate.originalTitle)
  );

  const base = TITLE_WEIGHT * titleSim + YEAR_WEIGHT * yearScore(parsedYear, candidate.year);

  // A confident title with a badly wrong year is usually a different cut or a
  // remake; pull it down hard rather than accepting silently.
  const yearConflict =
    parsedYear !== null && candidate.year !== null && Math.abs(parsedYear - candidate.year) > 4;
  const score = yearConflict ? base * 0.6 : base;

  return {
    candidate,
    score: Number(score.toFixed(4)),
    strategy: strategyFor(titleSim, parsedYear, candidate.year)
  };
}

/**
 * Ranks candidates best-first. Ties break on provider popularity, which sorts
 * the real film above obscure same-titled entries.
 */
export function rankCandidates(
  parsedTitle: string,
  parsedYear: number | null,
  candidates: Candidate[]
): ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(parsedTitle, parsedYear, c))
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : b.candidate.popularity - a.candidate.popularity
    );
}

export interface MatchDecision {
  best: ScoredCandidate | null;
  /** Runners-up, offered in the manual re-match UI. */
  alternatives: ScoredCandidate[];
  accepted: boolean;
  needsReview: boolean;
}

export function decideMatch(
  parsedTitle: string,
  parsedYear: number | null,
  candidates: Candidate[]
): MatchDecision {
  const ranked = rankCandidates(parsedTitle, parsedYear, candidates);
  const best = ranked[0] ?? null;

  if (!best || best.score < REJECT_BELOW) {
    return { best: null, alternatives: ranked.slice(0, 5), accepted: false, needsReview: true };
  }

  const accepted = best.score >= AUTO_ACCEPT;
  return {
    best,
    alternatives: ranked.slice(1, 6),
    accepted,
    needsReview: !accepted
  };
}
