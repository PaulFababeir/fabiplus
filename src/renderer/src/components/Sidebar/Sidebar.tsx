import { useState } from 'react';

import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState } from '@shared/types';
import { TMDB_ATTRIBUTION } from '@renderer/lib/attribution';
import { AUTO_ACCEPT_UI } from '@renderer/lib/constants';
import { displayTitle, displayYear, posterFor, runtimeLabel } from '@renderer/lib/selectors';
import { PosterPicker } from '@renderer/components/Modal/PosterPicker';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './Sidebar.module.css';

type Tab = 'cast' | 'crew' | 'details' | 'genres';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'cast', label: 'CAST' },
  { id: 'crew', label: 'CREW' },
  { id: 'details', label: 'DETAILS' },
  { id: 'genres', label: 'GENRES' }
];

const CAST_PREVIEW = 12;

interface SidebarProps {
  item: LibraryItem | null;
  profileState: ProfileState | null;
}

/** Full-bleed backdrop layer, rendered behind the grid rather than over it. */
export function BackdropLayer({ item }: { item: LibraryItem | null }): React.JSX.Element {
  const backdrop = item?.metadata?.backdrop?.localPath ?? null;
  return (
    <div className={styles.backdropLayer} data-visible={backdrop !== null} aria-hidden="true">
      {backdrop && <img className={styles.backdropImage} src={toMovieUrl(backdrop)} alt="" />}
      <div className={styles.backdropFade} />
    </div>
  );
}

export function Sidebar({ item, profileState }: SidebarProps): React.JSX.Element | null {
  const { sidebarOpen, select, setRematchOpen } = useUi();
  const [tab, setTab] = useState<Tab>('cast');
  const [showAllCast, setShowAllCast] = useState(false);
  const [picking, setPicking] = useState(false);

  // Collapsing removes the panel outright — nothing peeks in from the edge.
  // Picking any film in the grid brings it back.
  if (!item || !sidebarOpen) return null;

  const poster = posterFor(item, profileState);
  const posters = item.metadata?.posters ?? [];
  const chosenIndex = profileState?.posterChoice[item.id] ?? 0;

  const meta = item.metadata;
  const director = meta?.crew.find((c) => c.job === 'Director')?.name ?? null;
  const runtime = runtimeLabel(meta?.runtimeMin ?? null);
  const needsReview =
    item.match !== null && !item.match.correctedByUser && item.match.confidence < AUTO_ACCEPT_UI;

  return (
    <aside className={styles.panel}>
      <button
        type="button"
        className={styles.close}
        aria-label="Close details"
        onClick={() => select(null)}
      >
        <Icon name="close" size={16} />
      </button>

      <div className={styles.posterBlock}>
        <div className={styles.posterFrame}>
          {poster && <img className={styles.posterImage} src={toMovieUrl(poster)} alt="" />}
          {posters.length > 1 && (
            <button type="button" className={styles.swap} onClick={() => setPicking((v) => !v)}>
              <Icon name="swap" size={12} />
              Change poster
            </button>
          )}
        </div>
      </div>

      <div className={styles.header}>
        <h2 className={styles.title}>
          {displayTitle(item)}
          <span className={styles.year}>{displayYear(item) ?? ''}</span>
        </h2>
        <div className={styles.metaLine}>
          {[director && `Directed by ${director}`, runtime, meta?.rating ? `★ ${meta.rating.toFixed(1)}` : null]
            .filter(Boolean)
            .join('  ·  ')}
        </div>
      </div>

      {meta?.tagline && <p className={styles.tagline}>{meta.tagline}</p>}
      {meta?.overview && <p className={styles.overview}>{meta.overview}</p>}

      {needsReview && (
        <p className={styles.reviewNotice}>
          This match wasn&apos;t confident. If it&apos;s the wrong film, pick the right one below.
        </p>
      )}

      {meta && (
        <>
          <div className={styles.tabs}>
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={styles.tab}
                data-active={tab === entry.id}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className={styles.tabBody}>
            {tab === 'cast' && (
              <>
                <div className={styles.chips}>
                  {(showAllCast ? meta.cast : meta.cast.slice(0, CAST_PREVIEW)).map((person) => (
                    <span key={`${person.name}-${person.order}`} className={styles.chip}>
                      {person.name}
                    </span>
                  ))}
                </div>
                {meta.cast.length > CAST_PREVIEW && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => setShowAllCast((v) => !v)}
                  >
                    {showAllCast ? 'Show less' : `Show all ${meta.cast.length}…`}
                  </button>
                )}
              </>
            )}

            {tab === 'crew' && (
              <div className={styles.chips}>
                {meta.crew.map((person, i) => (
                  <span key={`${person.name}-${person.job}-${i}`} className={styles.chip}>
                    {person.name} <span className={styles.chipRole}>{person.job}</span>
                  </span>
                ))}
              </div>
            )}

            {tab === 'details' && (
              <div>
                <Detail label="Original title" value={meta.originalTitle} />
                <Detail label="Released" value={meta.releaseDate} />
                <Detail label="Runtime" value={runtime} />
                <Detail label="Rating" value={meta.rating ? `${meta.rating.toFixed(1)} / 10` : null} />
                <Detail label="Quality" value={item.parsed.tags.resolution} />
                <Detail label="Source" value={item.parsed.tags.source} />
                <Detail label="Codec" value={item.parsed.tags.codec} />
                <Detail
                  label="Subtitles"
                  value={
                    item.subtitles.length > 0
                      ? item.subtitles.map((s) => s.label).join(', ')
                      : 'None found'
                  }
                />
                <Detail label="Size" value={`${(item.video.size / 1e9).toFixed(2)} GB`} />
                <Detail label="Folder" value={item.folderName} />
              </div>
            )}

            {tab === 'genres' && (
              <div className={styles.chips}>
                {meta.genres.map((genre) => (
                  <span key={genre} className={styles.chip}>
                    {genre}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {picking && (
        <PosterPicker item={item} chosenIndex={chosenIndex} onClose={() => setPicking(false)} />
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.rematchLink}
          onClick={() => setRematchOpen(true, item.id)}
        >
          Wrong film or details? Search again
        </button>
        <p style={{ margin: '10px 0 0' }}>{TMDB_ATTRIBUTION}</p>
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string | null }): React.JSX.Element | null {
  if (!value) return null;
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailKey}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}
