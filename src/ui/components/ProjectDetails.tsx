import { useState } from 'react';
import type { Project } from '../../types/models';
import { Modal } from './Modal';
import { t } from '../text';

const statuses: { value: Project['status']; label: string }[] = [
  { value: 'experimental', label: 'Experiment' },
  { value: 'testing', label: 'Testas' },
  { value: 'stable', label: 'Stabil' },
  { value: 'broken', label: 'Trasig' },
  { value: 'archived', label: 'Arkiverad' },
];

/** description, tags, status and notes were set once when the project was created and could never
 * be changed, while the project search matched against tags the user had no way to add. */
export function ProjectDetails({
  project,
  save,
  close,
}: {
  project: Project;
  save: (patch: Pick<Project, 'description' | 'tags' | 'status' | 'notes'>) => Promise<void>;
  close: () => void;
}) {
  const [description, setDescription] = useState(project.description);
  const [tags, setTags] = useState(project.tags.join(', '));
  const [status, setStatus] = useState(project.status);
  const [notes, setNotes] = useState(project.notes);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await save({
        description: description.trim(),
        tags: [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))],
        status,
        notes: notes.trim(),
      });
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Om projektet" close={close}>
      <label>
        Beskrivning
        <input autoFocus aria-label="Beskrivning" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.details.descriptionHint} />
      </label>
      <label>
        Taggar
        <input aria-label="Taggar" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ad, rapport, drift" />
        <small>{t.details.tagsHint}</small>
      </label>
      <label>
        Status
        <select aria-label="Projektstatus" value={status} onChange={(e) => setStatus(e.target.value as Project['status'])}>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Anteckningar
        <textarea aria-label="Anteckningar" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button onClick={close}>Avbryt</button>
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          Spara
        </button>
      </div>
    </Modal>
  );
}
