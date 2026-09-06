import type { Category, ScannerRule } from '../../types/models';

export interface CompiledRule {
  id: string;
  name: string;
  severity: ScannerRule['severity'];
  category: Category;
  explanation: string;
  suggestedAiReplacement?: string;
  /** Either a compiled expression or one of the checks that cannot be written as one. */
  match: RegExp | ((text: string) => { start: number; end: number }[]);
  invalid?: string;
}

/** Shannon entropy per character. A generated key looks nothing like a word, and this is the only
 * signal that catches a secret whose surrounding code says nothing about what it is. */
export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let total = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    total -= p * Math.log2(p);
  }
  return total;
}

const TOKEN = /[A-Za-z0-9+/=_\-.~]{16,}/g;

/** Flags long, high-entropy runs. Deliberately conservative: real words and paths score low, and a
 * false positive here costs a dismissal while a false negative costs a leaked key. */
function highEntropy(text: string) {
  const hits: { start: number; end: number }[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const value = match[0];
    // Long hex and base64 both land above 3.2; English prose and dotted paths sit well below.
    if (entropy(value) >= 3.6 && /\d/.test(value) && /[A-Za-z]/.test(value)) {
      hits.push({ start: match.index, end: match.index + value.length });
    }
  }
  return hits;
}

/** Patterns of the form `builtin:name` resolve to code rather than to an expression, for the
 * checks that cannot be written as one. */
const builtIns: Record<string, CompiledRule['match']> = { 'builtin:entropy': highEntropy };

const rule = (
  id: string,
  name: string,
  pattern: string,
  severity: ScannerRule['severity'],
  category: Category,
  explanation: string,
  suggestedAiReplacement?: string,
): ScannerRule => ({ id, name, pattern, flags: 'g', severity, category, explanation, suggestedAiReplacement, enabled: true, builtIn: true });

/** Seeded lazily and merged with stored overrides by id, so a rule the user disabled stays
 * disabled and new built-ins appear without a migration. */
export const builtInRules: ScannerRule[] = [
  rule('builtin:entropy', 'Slumpmässig sträng', 'builtin:entropy', 'high', 'secret',
    'Lång sträng med hög entropi. Ser ut som en nyckel eller ett genererat lösenord.', '<SECRET>'),
  rule('secret-assignment', 'Tilldelning till hemlighet',
    String.raw`(?:password|passwd|pwd|secret|token|apikey|api_key|client_secret|credential|connectionstring)\s*[:=]\s*["']([^"'\n]{3,})["']`,
    'critical', 'secret', 'Ett värde tilldelas ett namn som antyder en hemlighet.', '<PASSWORD>'),
  rule('aws-key', 'AWS-nyckel-ID', String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`, 'critical', 'secret',
    'Ser ut som ett AWS Access Key ID.', '<AWS_ACCESS_KEY_ID>'),
  rule('github-token', 'GitHub-token', String.raw`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b`,
    'critical', 'secret', 'Ser ut som en GitHub-token.', '<GITHUB_TOKEN>'),
  rule('jwt', 'JWT', String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`, 'high', 'secret',
    'Ser ut som en JSON Web Token.', '<JWT>'),
  rule('pem', 'Privat nyckel', String.raw`-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----`, 'critical', 'secret',
    'En privat nyckel i PEM-format.', '<PRIVATE_KEY>'),
  rule('basic-auth-url', 'Inloggning i URL', String.raw`\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@`, 'critical', 'secret',
    'Användarnamn och lösenord ligger i en URL.', '<CONNECTION_URL>'),
  rule('private-ip', 'Privat IP-adress',
    String.raw`\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b`,
    'medium', 'infrastructure', 'En adress i ett privat nät avslöjar hur nätverket ser ut.', '10.0.0.1'),
  rule('internal-host', 'Internt värdnamn', String.raw`\b[a-z0-9][a-z0-9-]*\.(?:local|corp|internal|intranet|lan|home)\b`,
    'medium', 'infrastructure', 'Ett internt värdnamn avslöjar hur miljön är uppbyggd.', 'server.example.test'),
  rule('unc-path', 'UNC-sökväg', String.raw`\\\\[A-Za-z0-9._-]+\\[^\s"'<>|]+`, 'medium', 'environment',
    'En UNC-sökväg pekar ut en riktig server och utdelning.', String.raw`\\server.example.test\share`),
  rule('windows-path', 'Windows-sökväg', String.raw`\b[A-Za-z]:\\(?:[^\s"'<>|:*?]+\\?)+`, 'low', 'environment',
    'En absolut sökväg kan avslöja användarnamn eller mappstruktur.', String.raw`C:\Temp\Example`),
  rule('email', 'E-postadress', String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`, 'low', 'identity',
    'En riktig e-postadress är en personuppgift.', 'example.user@example.test'),
  rule('personnummer', 'Personnummer', String.raw`\b(?:19|20)?\d{6}[-+]?\d{4}\b`, 'high', 'identity',
    'Ser ut som ett personnummer.', '19700101-0000'),
  // The AI value keeps the shape rather than the meaning: code that parses a GUID still parses one,
  // and a reader can see at a glance what the placeholder stands for. The nil GUID would look like
  // an unset value and invite exactly the wrong assumption.
  rule('guid', 'GUID', String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`,
    'low', 'configuration', 'Ett GUID pekar ofta ut en katalog, en prenumeration eller en resurs.',
    '00000000-1111-2222-3333-444444444444'),
];

/** Only the vetted built-ins may be regular expressions.
 *
 * The first version of this took a user-supplied expression and refused the shapes known to
 * backtrack. A test then compiled `(a|a)+b` — a form that filter did not catch — and the scan took
 * 138 seconds. Blocking catastrophic backtracking with a pattern blacklist is a losing game:
 * JavaScript cannot interrupt a running regular expression, so a miss is a frozen page, in an app
 * whose whole claim is that nothing here runs away with your machine.
 *
 * A user's own rule is therefore a literal term, matched case-insensitively and escaped before it
 * is compiled. That cannot backtrack at all. It covers what the feature is actually for — "flag our
 * company domain", "flag this server name" — and if expressions are ever offered they belong in a
 * worker that can be terminated, not behind a filter. */
const builtInIds = new Set(builtInRules.map((r) => r.id));
const escapeLiteral = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export function compileRules(rules: ScannerRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const stored of rules) {
    if (!stored.enabled) continue;
    const base = {
      id: stored.id,
      name: stored.name,
      severity: stored.severity,
      category: stored.category,
      explanation: stored.explanation,
      suggestedAiReplacement: stored.suggestedAiReplacement,
    };
    // Membership of the built-in set decides this, not the stored builtIn flag, which an imported
    // record could claim for itself.
    if (builtInIds.has(stored.id)) {
      const code = builtIns[stored.pattern];
      if (code) {
        compiled.push({ ...base, match: code });
        continue;
      }
      try {
        compiled.push({ ...base, match: new RegExp(stored.pattern, stored.flags.includes('g') ? stored.flags : `${stored.flags}g`) });
      } catch (error) {
        compiled.push({ ...base, match: /(?!)/g, invalid: error instanceof Error ? error.message : 'Ogiltigt uttryck.' });
      }
      continue;
    }
    const term = stored.pattern.trim();
    if (!term) {
      compiled.push({ ...base, match: /(?!)/g, invalid: 'Sökordet är tomt.' });
      continue;
    }
    if (term.length > 200) {
      compiled.push({ ...base, match: /(?!)/g, invalid: 'Sökordet är för långt.' });
      continue;
    }
    compiled.push({ ...base, match: new RegExp(escapeLiteral(term), 'gi') });
  }
  return compiled;
}

/** Merges stored rules over the built-ins by id, so disabling one sticks and new built-ins appear. */
export function mergeRules(stored: ScannerRule[]): ScannerRule[] {
  const overrides = new Map(stored.map((r) => [r.id, r]));
  const merged = builtInRules.map((r) => overrides.get(r.id) ?? r);
  for (const rule of stored) if (!rule.builtIn) merged.push(rule);
  return merged;
}
