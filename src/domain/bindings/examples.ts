import type { Binding, Category } from '../../types/models';
import { defaults } from './index';

/** What a value looks like, as far as the AI value has to look the same way.
 *
 * The AI copy is code an AI is asked to reason about, so the stand-in has to parse where the real
 * value parsed: an address where there was an address, a GUID where there was a GUID. Every shape
 * lands in a reserved namespace (RFC 2606 names, RFC 5737 addresses, an obviously fake GUID), so a
 * stand-in can never be mistaken for something real. */
export type Shape = 'email' | 'netbios-user' | 'ip' | 'guid' | 'unc' | 'windows-path' | 'unix-path' | 'fqdn' | 'host' | 'plain';

export function shapeOf(value: string, category: Category): Shape {
  const v = value.trim();
  if (/^[^\s@\\]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (/^[A-Za-z0-9._-]+\\[^\\\s]+$/.test(v) && !/^[A-Za-z]:/.test(v)) return 'netbios-user';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) return 'ip';
  if (/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(v)) return 'guid';
  if (/^\\\\[^\\\s]+\\/.test(v)) return 'unc';
  if (/^[A-Za-z]:[\\/]/.test(v)) return 'windows-path';
  if (/^\/[^\s]*$/.test(v) && v.length > 1) return 'unix-path';
  if (category === 'infrastructure' && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(v)) return 'fqdn';
  if (category === 'infrastructure' && /^[A-Za-z0-9-]{2,}$/.test(v)) return 'host';
  return 'plain';
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
/** The first of a series keeps the category's plain default, so a value bound by hand today reads
 * the same as one bound yesterday; the second onwards is numbered. */
const numbered = (first: string, later: (n: number) => string, n: number) => (n === 1 ? first : later(n));

/** The n:th stand-in for a value of this shape. */
export function exampleFor(category: Category, value: string, n: number): string {
  switch (shapeOf(value, category)) {
    case 'email':
      return numbered('anna.exempel@example.com', (k) => `anna.exempel${k}@example.com`, n);
    case 'netbios-user':
      return `EXAMPLE\\svc-example${pad(n, 2)}`;
    case 'ip':
      return n <= 245 ? `192.0.2.${9 + n}` : `198.51.100.${(n - 245) % 250}`;
    case 'guid':
      return `11111111-2222-4333-8444-${pad(n, 12)}`;
    case 'unc':
      return `\\\\SRV-EXAMPLE${pad(n, 2)}\\share`;
    case 'windows-path':
      return numbered(defaults.environment, (k) => `${defaults.environment}${k}`, n);
    case 'unix-path':
      return `/opt/example/project${pad(n, 2)}`;
    case 'fqdn':
      return numbered('server.example.test', (k) => `server${k}.example.test`, n);
    case 'host':
      return `SRV-EXAMPLE${pad(n, 2)}`;
    case 'plain':
      switch (category) {
        case 'secret':
          return numbered('<PASSWORD>', (k) => `<PASSWORD_${k}>`, n);
        case 'identity':
          return numbered('example.user', (k) => `example.user${k}`, n);
        case 'infrastructure':
          return numbered('server.example.test', (k) => `server${k}.example.test`, n);
        case 'environment':
          return numbered(defaults.environment, (k) => `${defaults.environment}${k}`, n);
        case 'testdata':
          return numbered('example.test', (k) => `example${k}.test`, n);
        case 'configuration':
          return numbered('EXAMPLE_VALUE', (k) => `EXAMPLE_VALUE_${k}`, n);
      }
  }
}

/** True when a value is recognisably one of the tool's own stand-ins, so the scanner does not
 * report the example it put there itself: the reserved names and addresses above, a `<NAME>`
 * placeholder, and the two Swedish and English words the stand-ins are built from. */
export function isExampleValue(value: string): boolean {
  const v = value.trim();
  return /^<[A-Z_]+(?:_\d+)?>$/.test(v)
    || /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/.test(v)
    || /^\{?11111111-2222-4333-8444-\d{12}\}?$/i.test(v)
    // The word on its own or with a series number, never inside another token: AWS's documented
    // sample key ends in EXAMPLE and is still a key-shaped string worth pointing at.
    || /(?:^|[^a-z0-9])(?:example|exempel)\d*(?:[^a-z0-9]|$)/i.test(v);
}

/** The AI values already in use, compared without case: two bindings whose AI values differ only
 * in case would still be one value to the round trip. */
export function takenAiValues(bindings: Iterable<Pick<Binding, 'aiReplacement'>>): Set<string> {
  const taken = new Set<string>();
  for (const b of bindings) if (b.aiReplacement) taken.add(b.aiReplacement.toLowerCase());
  return taken;
}

/** An AI value nothing else in the vault uses.
 *
 * Two bindings with the same AI value look the same in the AI copy, and when the code comes back
 * the round trip's second tier cannot tell which placeholder a value belongs to. `preferred` is
 * what a scanner rule proposed and is kept when it is free; a `<NAME>` placeholder that is taken
 * gets a number inside the brackets, anything else falls back to the value's own shape. */
export function uniqueExample(preferred: string | undefined, category: Category, value: string, taken: ReadonlySet<string>): string {
  const free = (candidate: string) => !taken.has(candidate.toLowerCase());
  // A rule's suggestion is a guess at the shape; the value itself is the shape. A parameter rule
  // proposes a short host, but for `dc01.corp.local` the stand-in has to be a full name too.
  const shape = shapeOf(value, category);
  if (preferred && shape !== 'plain' && shapeOf(preferred, category) !== shape) preferred = undefined;
  if (preferred && free(preferred)) return preferred;
  const placeholder = preferred && /^<([A-Z_]+)>$/.exec(preferred);
  if (placeholder) {
    for (let n = 2; n < 10_000; n++) {
      const candidate = `<${placeholder[1]}_${n}>`;
      if (free(candidate)) return candidate;
    }
  }
  for (let n = 1; n < 10_000; n++) {
    const candidate = exampleFor(category, value, n);
    if (free(candidate)) return candidate;
  }
  return preferred ?? exampleFor(category, value, 1);
}

/** Another binding that already uses this binding's AI value, if any. A warning, not a refusal:
 * the user may have a reason, and the dialog says what it costs. */
export function sharedAiValue(binding: Pick<Binding, 'id' | 'aiReplacement'>, others: Pick<Binding, 'id' | 'name' | 'aiReplacement'>[]): string | undefined {
  const value = binding.aiReplacement.toLowerCase();
  if (!value) return undefined;
  return others.find((b) => b.id !== binding.id && b.aiReplacement.toLowerCase() === value)?.name;
}
