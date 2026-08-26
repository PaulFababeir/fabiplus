import { useState } from 'react';
import { motion } from 'motion/react';

import { TMDB_IMAGE_BASE } from '@shared/constants';
import { toMovieUrl } from '@shared/media-url';
import type { CastMember, LibraryItem } from '@shared/types';
import { displayTitle, displayYear, posterFor, runtimeLabel } from '@renderer/lib/selectors';
import { useProfile } from '@renderer/state/useProfile';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import styles from './PlayerInfo.module.css';

/**
 * Headshots are fetched straight from TMDB, never cached.
 *
 * Deliberately unlike posters, backdrops and stills, which are downloaded at
 * enrichment so the library renders with the network off. A cast list is read
 * once in a while mid-film, and caching thirty faces for every one of 86 films
 * would cost more disk than every poster in the app combined — for images most
 * of which are never looked at. The trade is that this panel is the one part of
 * the UI that needs a connection, so every row degrades to initials.
 *
 * `img-src` already allows this host: the re-match dialog streams its candidate
 * posters the same way.
 */
const PROFILE_SIZE = 'w185';

interface PlayerInfoProps {
  item: LibraryItem;
  onClose: () => void;
}

/** Initials, for a face that has no picture or could not be reached. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function CastCard({ person }: { person: CastMember }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const src = person.profilePath === null ? null : `${TMDB_IMAGE_BASE}/${PROFILE_SIZE}${person.profilePath}`;
  const character = person.character.trim();

  return (
    <li className={styles.castCard}>
      {src !== null && !failed ? (
        <img
          className={styles.face}
          src={src}
          alt=""
          loading="lazy"
          /* Offline, or a face TMDB no longer serves. Falling back rather than
             leaving a broken-image frame in the middle of the list. */
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.face} data-placeholder="true">
          {initials(person.name)}
        </span>
      )}

      {/*
        The character leads. Mid-film the question is "who is that on screen",
        and the answer is the part, not the performer — the actor's own name is
        what you work back to.
      */}
      <span className={styles.castText}>
        <span className={styles.character}>{character === '' ? person.name : character}</span>
        {character !== '' && <span className={styles.actor}>{person.name}</span>}
      </span>
    </li>
  );
}

/**
 * The film's details, over the video.
 *
 * A cousin of the library sidebar rather than a reuse of it: that one sits on a
 * backdrop and carries five tabs, and neither makes sense on top of a playing
 * film. Here the surface is glass so the picture stays readable behind it, the
 * poster sits high rather than centred to leave room for the cast, and CAST is
 * the only section — the rest is browsing, not watching.
 */
export function PlayerInfo({ item, onClose }: PlayerInfoProps): React.JSX.Element {
  // Read here rather than threaded through the player: the only thing it is
  // wanted for is the profile's poster pick.
  const profileState = useProfile((s) => s.state);
  const poster = posterFor(item, profileState);
  const meta = item.metadata;
  const director = meta?.crew.find((c) => c.job === 'Director')?.name ?? null;

  return (
    <motion.aside
      className={styles.panel}
      aria-label={`About ${displayTitle(item)}`}
      /* Marks the panel for the player's close-on-interaction handler: a click
         in here is reading, not interacting with the film. */
      data-info-panel="true"
      /*
       * Slides in from the edge it is anchored to. Short and shallow — it sits
       * over a moving picture, so anything longer reads as lag rather than as
       * motion. The easing matches the player's own enter transition.
       *
       * motion owns the transform. There is deliberately no CSS transition on
       * transform in the stylesheet: the two fight and the slide stutters.
       */
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.head}>
        <IconButton icon="close" label="Close details" onClick={onClose} className={styles.close} />
      </div>

      {/* Centred and high, mirroring the library sidebar so the two read as
          the same panel in two places. */}
      <div className={styles.posterBlock}>
        {poster ? (
          <img className={styles.poster} src={toMovieUrl(poster)} alt="" />
        ) : (
          <div className={styles.poster} data-placeholder="true">
            <Icon name="image" size={22} />
          </div>
        )}
      </div>

      <div className={styles.headline}>
        <h2 className={styles.title}>
          {displayTitle(item)}
          <span className={styles.year}>{displayYear(item) ?? ''}</span>
        </h2>
        <div className={styles.metaLine}>
          {[
            director && `Directed by ${director}`,
            runtimeLabel(meta?.runtimeMin ?? null),
            meta?.rating ? `★ ${meta.rating.toFixed(1)}` : null
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </div>

        {meta?.tagline && <p className={styles.tagline}>{meta.tagline}</p>}
        {meta?.overview && <p className={styles.overview}>{meta.overview}</p>}
      </div>

      <div className={styles.tab}>CAST</div>

      {meta && meta.cast.length > 0 ? (
        <ul className={styles.cast}>
          {meta.cast.map((person) => (
            <CastCard key={`${person.name}-${person.order}`} person={person} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No cast recorded for this title.</p>
      )}
    </motion.aside>
  );
}
