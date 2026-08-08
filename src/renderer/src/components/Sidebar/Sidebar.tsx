import { useEffect, useState } from 'react';

import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState } from '@shared/types';
import { AUTO_ACCEPT, TMDB_ATTRIBUTION } from '@shared/constants';
import {
  backdropFor,
  displayTitle,
  displayYear,
  posterFor,
  runtimeLabel
} from '@renderer/lib/selectors';
import { BackdropPicker } from '@renderer/components/Modal/BackdropPicker';
import { PosterPicker } from '@renderer/components/Modal/PosterPicker';
import { PosterLightbox } from './PosterLightbox';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import { WatchSection } from './WatchSection';
import styles from './Sidebar.module.css';

type Tab = 'watch' | 'cast' | 'crew' | 'details' | 'genres';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'cast', label: 'CAST' },
  { id: 'crew', label: 'CREW' },
  { id: 'details', label: 'DETAILS' },
  { id: 'genres', label: 'GENRES' }
];

/** A show leads with its episodes; a film has none, so the tab is absent. */
function tabsFor(item: LibraryItem): Array<{ id: Tab; label: string }> {
  return item.kind === 'series' ? [{ id: 'watch', label: 'WATCH' }, ...TABS] : TABS;
}

const CAST_PREVIEW = 12;

interface SidebarProps {
  item: LibraryItem | null;
  profileState: ProfileState | null;
}

/** Full-bleed backdrop layer, rendered behind the grid rather than over it. */
export function BackdropLayer({
  item,
  profileState
}: {
  item: LibraryItem | null;
  profileState: ProfileState | null;
}): React.JSX.Element {
  const backdrop = item ? backdropFor(item, profileState) : null;
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
  const tabs = item ? tabsFor(item) : TABS;

  /*
   * Open on the first tab of whatever was just selected. A show leads with its
   * episodes, so landing on CAST buries the thing the sidebar is for; keeping
   * the previous tab also risks showing WATCH for a film that has none.
   */
  useEffect(() => {
    setTab(tabs[0]?.id ?? 'cast');
    // Only on a change of title — switching tabs by hand must stick.
  }, [item?.id]);

  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'cast');
  const [showAllCast, setShowAllCast] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickingBackdrop, setPickingBackdrop] = useState(false);
  const [posterHidden, setPosterHidden] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  // Collapsing removes the panel outright — nothing peeks in from the edge.
  // Picking any film in the grid brings it back.
  if (!item || !sidebarOpen) return null;

  const poster = posterFor(item, profileState);
  const posters = item.metadata?.posters ?? [];
  const chosenIndex = profileState?.posterChoice[item.id] ?? 0;
  const backdrops = item.metadata?.backdrops ?? [];
  const chosenBackdrop = profileState?.backdropChoice[item.id] ?? 0;

  const meta = item.metadata;
  const director = meta?.crew.find((c) => c.job === 'Director')?.name ?? null;
  const runtime = runtimeLabel(meta?.runtimeMin ?? null);
  const needsReview =
    item.match !== null && !item.match.correctedByUser && item.match.confidence < AUTO_ACCEPT;

  return (
    <aside className={styles.panel}>
      <IconButton
        icon="close"
        label="Close details"
        onArtwork
        className={styles.close}
        onClick={() => select(null)}
      />

      {/*
        The frame keeps its box when hidden — only its contents go. Collapsing
        it would pull the title and synopsis up over the backdrop, which is the
        very thing hiding the poster is meant to reveal.
      */}
      <div className={styles.posterBlock}>
        <div className={styles.posterFrame} data-hidden={posterHidden}>
          {posterHidden ? (
            <button
              type="button"
              className={styles.showPoster}
              onClick={() => setPosterHidden(false)}
            >
              <Icon name="maximize" size={12} />
              Show poster
            </button>
          ) : (
            <>
              {poster && <img className={styles.posterImage} src={toMovieUrl(poster)} alt="" />}

              <div className={styles.posterTools}>
                <button
                  type="button"
                  className={styles.posterTool}
                  aria-label="Enlarge poster"
                  onClick={() => setEnlarged(true)}
                >
                  <Icon name="maximize" size={15} />
                </button>
                {backdrops.length > 1 && (
                  <button
                    type="button"
                    className={styles.posterTool}
                    aria-label="Choose the backdrop"
                    onClick={() => setPickingBackdrop(true)}
                  >
                    <Icon name="image" size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.posterTool}
                  aria-label="Hide poster to reveal the backdrop"
                  onClick={() => setPosterHidden(true)}
                >
                  <Icon name="eye-off" size={15} />
                </button>
              </div>

              {posters.length > 0 && (
                <button type="button" className={styles.swap} onClick={() => setPicking((v) => !v)}>
                  <Icon name="swap" size={12} />
                  {posters.length > 1 ? `Change poster (${posters.length})` : 'Poster options'}
                </button>
              )}
            </>
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
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={styles.tab}
                data-active={activeTab === entry.id}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className={styles.tabBody}>
            {activeTab === 'watch' && <WatchSection item={item} profileState={profileState} />}

            {activeTab === 'cast' && (
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

            {activeTab === 'crew' && (
              <div className={styles.chips}>
                {meta.crew.map((person, i) => (
                  <span key={`${person.name}-${person.job}-${i}`} className={styles.chip}>
                    {person.name} <span className={styles.chipRole}>{person.job}</span>
                  </span>
                ))}
              </div>
            )}

            {activeTab === 'details' && (
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

            {activeTab === 'genres' && (
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

      {pickingBackdrop && (
        <BackdropPicker
          item={item}
          chosenIndex={chosenBackdrop}
          onClose={() => setPickingBackdrop(false)}
        />
      )}

      {enlarged && poster && (
        <PosterLightbox src={toMovieUrl(poster)} onClose={() => setEnlarged(false)} />
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
