import { useCallback, useRef, useState } from 'react';

import { MAX_PROFILES } from '@shared/constants';
import { toMovieUrl } from '@shared/media-url';
import type { Profile } from '@shared/types';
import { useProfile } from '@renderer/state/useProfile';
import { useOnClickOutside, useOnEscape } from '@renderer/lib/useDismiss';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './TopBar.module.css';

/**
 * The chip: a chosen picture, or the accent with an initial on it.
 *
 * The image is served through `movie://` like everything else on disk, which is
 * what confines it to the avatar cache — a path anywhere else is refused by the
 * protocol handler rather than trusted because it reached the renderer.
 */
function Avatar({ profile, size }: { profile: Profile; size: number }): React.JSX.Element {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.44) };

  if (profile.avatarPath) {
    return (
      <img
        className={styles.avatar}
        style={style}
        src={toMovieUrl(profile.avatarPath)}
        alt=""
        draggable={false}
      />
    );
  }

  return (
    <span className={styles.avatar} style={{ ...style, background: profile.accent }}>
      {profile.name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Profile switcher. Up to five profiles, added inline, each row carrying edit
 * and delete controls that appear on hover.
 *
 * Editing happens in place rather than in a dialog: the row is already the
 * thing being described, and a modal for renaming one field is heavier than the
 * change deserves.
 */
export function ProfileMenu(): React.JSX.Element {
  const {
    profiles,
    activeId,
    error,
    switchTo,
    create,
    remove,
    rename,
    pickAvatar,
    clearAvatar,
    dismissError
  } = useProfile();

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
  const atLimit = profiles.length >= MAX_PROFILES;

  const reset = useCallback((): void => {
    setOpen(false);
    setAdding(false);
    setName('');
    setConfirmingId(null);
    setEditingId(null);
    dismissError();
  }, [dismissError]);

  useOnClickOutside(wrapRef, reset, open);
  useOnEscape(reset, open);

  const submitNew = async (): Promise<void> => {
    if (!name.trim()) return;
    await create(name);
    setName('');
    setAdding(false);
  };

  const submitRename = async (id: string): Promise<void> => {
    if (draftName.trim()) await rename(id, draftName);
    setEditingId(null);
  };

  return (
    <div className={styles.profileWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.profile}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {active ? (
          <Avatar profile={active} size={32} />
        ) : (
          <span className={styles.avatar} style={{ background: 'var(--accent)' }}>
            <Icon name="user" size={12} />
          </span>
        )}
        <span>{active?.name ?? 'Profile'}</span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {profiles.map((profile) => {
            if (confirmingId === profile.id) {
              return (
                <div key={profile.id} className={styles.confirm}>
                  Delete <strong>{profile.name}</strong>? Their watch history cannot be recovered.
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={styles.menuRow}
                      onClick={() => {
                        void remove(profile.id);
                        setConfirmingId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className={styles.menuRow}
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            if (editingId === profile.id) {
              return (
                <div key={profile.id} className={styles.editRow}>
                  <div className={styles.editHead}>
                    <Avatar profile={profile} size={34} />
                    <input
                      className={styles.addInput}
                      value={draftName}
                      autoFocus
                      maxLength={24}
                      aria-label={`Rename ${profile.name}`}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename(profile.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  </div>

                  <div className={styles.editActions}>
                    <button
                      type="button"
                      className={styles.editAction}
                      onClick={() => void pickAvatar(profile.id)}
                    >
                      <Icon name="image" size={13} />
                      {profile.avatarPath ? 'Change picture' : 'Add picture'}
                    </button>

                    {profile.avatarPath && (
                      <button
                        type="button"
                        className={styles.editAction}
                        onClick={() => void clearAvatar(profile.id)}
                      >
                        <Icon name="close" size={13} />
                        Remove
                      </button>
                    )}

                    <button
                      type="button"
                      className={`${styles.editAction} ${styles.editSave}`}
                      onClick={() => void submitRename(profile.id)}
                    >
                      <Icon name="check" size={13} />
                      Done
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={profile.id} className={styles.menuRow} data-active={profile.id === activeId}>
                {/*
                  The picture again, washed out behind the row. It is what makes
                  a profile recognisable at a glance when several are open, and
                  at this opacity it never competes with the name over it.
                */}
                {profile.avatarPath && (
                  <span
                    className={styles.rowTint}
                    style={{ backgroundImage: `url(${toMovieUrl(profile.avatarPath)})` }}
                    aria-hidden="true"
                  />
                )}

                <Avatar profile={profile} size={26} />

                <button
                  type="button"
                  className={styles.menuName}
                  onClick={() => {
                    void switchTo(profile.id);
                    reset();
                  }}
                >
                  {profile.name}
                </button>

                <button
                  type="button"
                  className={styles.rowAction}
                  aria-label={`Edit ${profile.name}`}
                  onClick={() => {
                    setDraftName(profile.name);
                    setEditingId(profile.id);
                  }}
                >
                  <Icon name="pencil" size={13} />
                </button>

                {/* Hidden at one profile, but the store refuses it either way —
                    an empty profiles.json orphans every watch record. */}
                {profiles.length > 1 && (
                  <button
                    type="button"
                    className={`${styles.rowAction} ${styles.delete}`}
                    aria-label={`Delete ${profile.name}`}
                    onClick={() => setConfirmingId(profile.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            );
          })}

          {error && <p className={styles.menuError}>{error}</p>}

          <div className={styles.divider} />

          {adding ? (
            <div className={styles.addRow}>
              <input
                className={styles.addInput}
                value={name}
                autoFocus
                placeholder="Profile name"
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitNew();
                  if (e.key === 'Escape') setAdding(false);
                }}
              />
              <button type="button" className={styles.menuRow} onClick={() => void submitNew()}>
                Add
              </button>
            </div>
          ) : atLimit ? (
            <div className={styles.limit}>Maximum of {MAX_PROFILES} profiles reached.</div>
          ) : (
            <button type="button" className={styles.menuRow} onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              <span className={styles.menuName}>Add profile</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
