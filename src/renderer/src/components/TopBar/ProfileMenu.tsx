import { useCallback, useRef, useState } from 'react';

import { MAX_PROFILES } from '@shared/constants';
import { useProfile } from '@renderer/state/useProfile';
import { useOnClickOutside, useOnEscape } from '@renderer/lib/useDismiss';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './TopBar.module.css';

/**
 * Profile switcher. Up to five profiles, added inline, each row carrying a
 * delete control hugging the right edge. Deleting destroys watch history, so
 * it asks first.
 */
export function ProfileMenu(): React.JSX.Element {
  const { profiles, activeId, switchTo, create, remove } = useProfile();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
  const atLimit = profiles.length >= MAX_PROFILES;

  const reset = useCallback((): void => {
    setOpen(false);
    setAdding(false);
    setName('');
    setConfirmingId(null);
  }, []);

  useOnClickOutside(wrapRef, reset, open);
  useOnEscape(reset, open);

  const submitNew = async (): Promise<void> => {
    if (!name.trim()) return;
    await create(name);
    setName('');
    setAdding(false);
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
        <span className={styles.avatar} style={{ background: active?.accent ?? 'var(--accent)' }}>
          {active ? active.name.charAt(0).toUpperCase() : <Icon name="user" size={12} />}
        </span>
        <span>{active?.name ?? 'Profile'}</span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {profiles.map((profile) =>
            confirmingId === profile.id ? (
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
            ) : (
              <div key={profile.id} className={styles.menuRow} data-active={profile.id === activeId}>
                <span
                  className={styles.avatar}
                  style={{ background: profile.accent }}
                  aria-hidden="true"
                >
                  {profile.name.charAt(0).toUpperCase()}
                </span>
                <button
                  type="button"
                  className={styles.menuName}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    void switchTo(profile.id);
                    reset();
                  }}
                >
                  {profile.name}
                </button>
                {profiles.length > 1 && (
                  <button
                    type="button"
                    className={styles.delete}
                    aria-label={`Delete ${profile.name}`}
                    onClick={() => setConfirmingId(profile.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            )
          )}

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
