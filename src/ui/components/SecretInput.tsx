import { useId, useState } from 'react';

/** A field for a password or a recovery key.
 *
 * Deliberately not `type="password"`: that is what makes a password manager offer to save the
 * master password of a local vault, and a manager that stores it beside the data it protects is
 * not a help. The characters are hidden with `-webkit-text-security` and a fallback font stack,
 * autofill is refused, and there is a button to show them — which is the case a manager's own
 * reveal would have covered. */
export function SecretInput({
  label, value, onChange, autoFocus, hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return <label className="secret-field" htmlFor={id}>
    {label}
    <span className="secret-row">
      <input id={id} type="text" className={shown ? '' : 'masked'} value={value} autoFocus={autoFocus}
        aria-label={label} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        data-lpignore="true" data-1p-ignore="true" data-form-type="other"
        onChange={e => onChange(e.target.value)} />
      <button type="button" className="text-button" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Dölj' : 'Visa'}</button>
    </span>
    {hint && <small>{hint}</small>}
  </label>;
}
