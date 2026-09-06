import type { LanguageId } from '../types/models';

const byExtension: Record<string, LanguageId> = {
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', json: 'json', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', txt: 'plaintext',
};

export function languageForFile(name: string): LanguageId | undefined {
  return byExtension[name.split('.').pop()?.toLowerCase() ?? ''];
}

/** Guesses from the code itself, for pasted text that arrives without a filename.
 *
 * Deliberately only answers when a marker is unambiguous. The language decides how values are
 * escaped, so a wrong guess is worse than no guess, and the picker is right there either way. */
export function detectLanguage(code: string): LanguageId | undefined {
  const text = code.trim();
  if (!text) return undefined;

  if (/^#!.*\b(bash|sh|zsh)\b/m.test(text)) return 'shell';
  if (/^#!.*\bpython/m.test(text)) return 'python';

  if (/^\s*[[{]/.test(text) && /"\s*:/.test(text)) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      /* Looks like JSON but is not; fall through rather than mislabel it. */
    }
  }
  if (/^\s*<\?xml|^\s*<[a-zA-Z][\w:-]*(\s[^>]*)?>/.test(text)) return 'xml';

  // PowerShell: sigil variables together with a cmdlet or a typed cast.
  if (/\$[A-Za-z_]\w*\s*=/.test(text) && /\b(Write-|Get-|Set-|New-|Import-Module|param\s*\()/.test(text)) return 'powershell';
  if (/^\s*(def |import |from \w+ import |print\()/m.test(text)) return 'python';
  if (/\b(interface|type)\s+\w+\s*[={]|:\s*(string|number|boolean)\b/.test(text)) return 'typescript';
  if (/^\s*(const|let|var|function|=>|export|import)\b/m.test(text) && /[;{]/.test(text)) return 'javascript';
  if (/^\s*---\s*$/m.test(text) || /^[A-Za-z_][\w-]*:\s*\S/m.test(text)) return 'yaml';
  if (/^\s*(export\s+)?[A-Z_]+=/m.test(text) && /\$\{?\w/.test(text)) return 'shell';
  if (/\$[A-Za-z_]\w*\s*=/.test(text)) return 'powershell';

  return undefined;
}
