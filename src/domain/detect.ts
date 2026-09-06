import type { LanguageId } from '../types/models';

const byExtension: Record<string, LanguageId> = {
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', json: 'json', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', txt: 'plaintext',
  env: 'dotenv', tf: 'hcl', tfvars: 'hcl', hcl: 'hcl', sql: 'sql',
};

export function languageForFile(name: string): LanguageId | undefined {
  // `.env`, `.env.local` and `.env.production` are all dotenv, and none of them has an extension in
  // the usual sense — the whole name is the signal.
  if (/^\.env(\.|$)/.test(name.trim())) return 'dotenv';
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
  // Terraform blocks and SQL statements are both recognisable from a single line, and neither
  // resembles anything else in the list.
  if (/^\s*(resource|variable|provider|module|data|terraform|output)\s+("[^"]*"\s*)*\{/m.test(text)) return 'hcl';
  if (/^\s*(SELECT\s+[\s\S]*\sFROM\s|INSERT\s+INTO\s|UPDATE\s+\w+\s+SET\s|CREATE\s+(TABLE|DATABASE|USER)\s)/im.test(text)) return 'sql';
  if (/^\s*(export\s+)?[A-Z_]+=/m.test(text) && /\$\{?\w/.test(text)) return 'shell';
  // A run of KEY=value lines with no shell syntax around them is a .env file. Checked after shell,
  // which needs its own markers, and requires more than one line so a stray assignment is not enough.
  if (!/[;{}()]/.test(text) && (text.match(/^\s*(?:export\s+)?[A-Za-z_][\w.]*=/gm)?.length ?? 0) >= 2) return 'dotenv';
  if (/\$[A-Za-z_]\w*\s*=/.test(text)) return 'powershell';

  return undefined;
}
