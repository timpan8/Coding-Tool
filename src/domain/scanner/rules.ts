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

/** Swedish personnummer with the Luhn check, so a date followed by four digits — an order number,
 * a timestamp — is not called a person. YYMMDD-XXXX or YYYYMMDD-XXXX, separator optional. */
export function looksLikePersonnummer(value: string): boolean {
  const m = /^(\d{2})?(\d{2})(\d{2})(\d{2})[-+]?(\d{4})$/.exec(value.trim());
  if (!m) return false;
  const month = Number(m[3]);
  const day = Number(m[4]);
  // Day up to 91: a coordination number adds 60 to the day of birth.
  if (month < 1 || month > 12 || day < 1 || day > 91) return false;
  const digits = (m[2] + m[3] + m[4] + m[5]).split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = digits[i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const PERSONNUMMER = /\b(?:19|20)?\d{6}[-+]?\d{4}\b/g;

function personnummerHits(text: string) {
  const hits: { start: number; end: number }[] = [];
  for (const match of text.matchAll(PERSONNUMMER)) {
    if (looksLikePersonnummer(match[0])) hits.push({ start: match.index, end: match.index + match[0].length });
  }
  return hits;
}

/** Patterns of the form `builtin:name` resolve to code rather than to an expression, for the
 * checks that cannot be written as one. */
const builtIns: Record<string, CompiledRule['match']> = { 'builtin:entropy': highEntropy, 'builtin:personnummer': personnummerHits };

const rule = (
  id: string,
  name: string,
  pattern: string,
  severity: ScannerRule['severity'],
  category: Category,
  explanation: string,
  suggestedAiReplacement?: string,
  flags = 'g',
): ScannerRule => ({ id, name, pattern, flags, severity, category, explanation, suggestedAiReplacement, enabled: true, builtIn: true });

/** A value in a PowerShell parameter: quoted or bare, never a variable — `-Server $dc` names
 * nothing the scanner can point at. */
const parameterValue = String.raw`\s+["']?((?!\$)[^"'\s,)]+)`;

/** PowerShell commands that write to the screen, a file or a log. A secret that lands in one of
 * them ends up somewhere the script's author did not think of as the place it lives. */
export const OUTPUT_COMMANDS = /\b(?:write-host|write-output|write-verbose|write-debug|write-information|write-warning|write-error|out-file|add-content|set-content|tee-object|write-log|out-string|write-eventlog|start-transcript)\b/i;
/** Commands that remove or move whatever the path points at. A wrong path here is not a typo. */
export const DESTRUCTIVE_COMMANDS = /\b(?:remove-item|clear-content|move-item|rename-item|remove-itemproperty|clear-item)\b/i;
export const OUTPUT_WARNING = 'Hemligheten står i en utskrifts- eller loggsats.';
export const DESTRUCTIVE_WARNING = 'Sökvägen används i ett kommando som tar bort eller flyttar.';

/** What the line around a finding says about it. Only PowerShell has the vocabulary for this;
 * elsewhere the list is empty rather than guessed. */
export function warningsFor(line: string, category: Category, language?: string): string[] {
  if (language !== 'powershell') return [];
  const warnings: string[] = [];
  if (category === 'secret' && OUTPUT_COMMANDS.test(line)) warnings.push(OUTPUT_WARNING);
  if (category === 'environment' && DESTRUCTIVE_COMMANDS.test(line)) warnings.push(DESTRUCTIVE_WARNING);
  return warnings;
}

/** Seeded lazily and merged with stored overrides by id, so a rule the user disabled stays
 * disabled and new built-ins appear without a migration. */
export const builtInRules: ScannerRule[] = [
  rule('builtin:entropy', 'Slumpmässig sträng', 'builtin:entropy', 'high', 'secret',
    'Lång sträng med hög entropi. Ser ut som en nyckel eller ett genererat lösenord.', '<SECRET>'),
  rule('secret-assignment', 'Tilldelning till hemlighet',
    String.raw`(?:password|passwd|pwd|secret|token|apikey|api_key|client_secret|credential|connectionstring)\s*[:=]\s*["']([^"'\n]{3,})["']`,
    'critical', 'secret', 'Ett värde tilldelas ett namn som antyder en hemlighet.', '<PASSWORD>', 'gi'),
  // The assignments and parameters below are what a PowerShell script written for one environment
  // is full of. None of them is a secret; all of them say which environment it was.
  rule('username-assignment', 'Tilldelning till användarnamn',
    String.raw`(?:user(?:name)?|login|samaccountname|upn|userprincipalname|identity|account(?:name)?)\s*[:=]\s*["']([^"'\n]{2,})["']`,
    'medium', 'identity', 'Ett värde tilldelas ett namn som antyder ett användarnamn eller konto.', 'example.user', 'gi'),
  rule('username-parameter', 'Användarnamn som parameter',
    String.raw`-(?:UserName|User|Identity|SamAccountName|UserPrincipalName|Account)${parameterValue}`,
    'medium', 'identity', 'Ett konto anges direkt som parameter till ett kommando.', 'example.user', 'gi'),
  rule('server-parameter', 'Server som parameter',
    String.raw`-(?:ComputerName|Server|DomainController|SqlServer|SmtpServer|HostName|ServerInstance|VIServer|Target)${parameterValue}`,
    'medium', 'infrastructure', 'Ett servernamn anges direkt som parameter till ett kommando.', 'SRV-EXAMPLE01', 'gi'),
  rule('connection-server', 'Server i anslutningssträng',
    String.raw`\b(?:Server|Data Source|Host)\s*=\s*([^;"'\n]{2,})`,
    'medium', 'infrastructure', 'En anslutningssträng pekar ut en riktig server.', 'server.example.test', 'gi'),
  rule('domain-parameter', 'Domän som parameter',
    String.raw`-(?:Domain|DomainName|DnsDomain|Realm)${parameterValue}`,
    'medium', 'infrastructure', 'En domän anges direkt som parameter till ett kommando.', 'corp.example', 'gi'),
  rule('tenant-id', 'Tenant-, klient- eller prenumerations-id',
    String.raw`(?:-(?:TenantId|ClientId|ApplicationId|AppId|SubscriptionId|ObjectId)\s+|(?:tenant(?:id)?|client(?:id)?|app(?:lication)?id|subscription(?:id)?)\s*[:=]\s*)["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
    'medium', 'configuration', 'Ett id som pekar ut en tenant, en app-registrering eller en prenumeration.', '11111111-2222-4333-8444-000000000001', 'gi'),
  rule('unix-path', 'Unix-sökväg',
    String.raw`(?:^|[\s"'=(])(/(?:home|etc|var|opt|srv|mnt|Users|root|tmp)/[^\s"'<>|)]+)`,
    'low', 'environment', 'En absolut sökväg kan avslöja användarnamn eller mappstruktur.', '/opt/example/project01', 'gm'),
  // Two labels before the top-level domain, so a bare `company.se` is left alone and an intranet
  // host is not. An address's domain is the email rule's business, hence the look-behind.
  rule('fqdn', 'Fullständigt värdnamn',
    String.raw`(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.){2,}(?:se|com|net|org|nu|io|cloud|dev|app))\b`,
    'low', 'infrastructure', 'Ett fullständigt värdnamn pekar ut en riktig server eller tjänst.', 'server.example.test', 'gi'),
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
  // The whole chain of labels, so `sql01.corp.local` is one value and not `sql01.corp` with a tail
  // left in the template — half a host name bound is the defect the literal widening exists for.
  rule('internal-host', 'Internt värdnamn', String.raw`\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:local|corp|internal|intranet|lan|home)\b`,
    'medium', 'infrastructure', 'Ett internt värdnamn avslöjar hur miljön är uppbyggd.', 'server.example.test'),
  rule('unc-path', 'UNC-sökväg', String.raw`\\\\[A-Za-z0-9._-]+\\[^\s"'<>|]+`, 'medium', 'environment',
    'En UNC-sökväg pekar ut en riktig server och utdelning.', String.raw`\\server.example.test\share`),
  rule('windows-path', 'Windows-sökväg', String.raw`\b[A-Za-z]:\\(?:[^\s"'<>|:*?]+\\?)+`, 'low', 'environment',
    'En absolut sökväg kan avslöja användarnamn eller mappstruktur.', String.raw`C:\Temp\Example`),
  rule('email', 'E-postadress', String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`, 'low', 'identity',
    'En riktig e-postadress är en personuppgift.', 'example.user@example.test'),
  rule('personnummer', 'Personnummer', 'builtin:personnummer', 'high', 'identity',
    'Ser ut som ett personnummer, och kontrollsiffran stämmer.', '19700101-0000'),
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
export const isBuiltInRule = (id: string) => builtInIds.has(id);
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
