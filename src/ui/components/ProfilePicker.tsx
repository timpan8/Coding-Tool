import { useState } from 'react';
import type { Profile } from '../../types/models';
import { Modal } from './Modal';

/** The top bar showed a fixed "Profil: Standard" label that looked like a control and was not one,
 * while Binding.values was already keyed by profile and resolveValue already had the fallback.
 * Everything was in place except a way to use it. */
export function ProfilePicker({
  profiles,
  activeId,
  onSelect,
  onManage,
}: {
  profiles: Profile[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}) {
  return (
    <label className="profile-choice">
      Profil
      <select aria-label="Aktiv profil" value={activeId ?? ''} onChange={(e) => (e.target.value === '__manage__' ? onManage() : onSelect(e.target.value || null))}>
        <option value="">Standard</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
        <option value="__manage__">Hantera profiler…</option>
      </select>
    </label>
  );
}

export function ProfileManager({
  profiles,
  onCreate,
  onRename,
  onDelete,
  close,
}: {
  profiles: Profile[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (profile: Profile) => Promise<void>;
  close: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setName('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Profiler" close={close}>
      <p className="muted">
        En profil håller egna värden för samma bindings — test mot produktion, en kund mot en annan. Saknas ett värde
        för den valda profilen används standardvärdet.
      </p>
      <div className="profile-list">
        {profiles.map((profile) => (
          <div className="profile-row" key={profile.id}>
            <input
              aria-label={`Namn på ${profile.name}`}
              defaultValue={profile.name}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== profile.name) void onRename(profile.id, e.target.value.trim());
              }}
            />
            <button className="text-button danger-text" aria-label={`Ta bort ${profile.name}`} onClick={() => void onDelete(profile)}>
              ×
            </button>
          </div>
        ))}
        {!profiles.length && <p className="muted">Inga profiler ännu. Standard används för alla värden.</p>}
      </div>
      <label>
        Ny profil
        <input
          aria-label="Ny profil"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="t.ex. Produktion"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
      </label>
      <div className="dialog-actions">
        <button onClick={close}>Stäng</button>
        <button className="primary" disabled={busy || !name.trim()} onClick={() => void add()}>
          Lägg till
        </button>
      </div>
    </Modal>
  );
}
