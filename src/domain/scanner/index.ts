import type { Category, ScannerRule } from '../../types/models';
import { placeholderRegex } from '../render';
import { compileRules, type CompiledRule } from './rules';

export * from './rules';

export interface Finding {
  ruleId: string;
  ruleName: string;
  severity: ScannerRule['severity'];
  category: Category;
  explanation: string;
  start: number;
  end: number;
  line: number;
  /** Never the raw match: this is shown in a list and, as a fingerprint, persisted. Invariant 5
   * applies to stored data as much as to error messages. */
  maskedExcerpt: string;
  suggestedAiReplacement?: string;
  /** Stable across edits to the rest of the file, so dismissing a finding sticks. Derived from the
   * value, never containing it. */
  fingerprint: string;
}

export interface ScanOptions {
  /** Ranges already protected by a placeholder, so a value the user has bound is not re-reported. */
  skipRanges?: { start: number; end: number }[];
  maxMatchesPerRule?: number;
}

/** 512 kB. A file larger than this is not what this tool is for, and scanning it would block the
 * page for long enough to feel broken. */
const MAX_INPUT = 512 * 1024;
const DEFAULT_MAX_MATCHES = 200;

export function maskExcerpt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length);
  const body = Math.min(trimmed.length - 4, 12);
  return `${trimmed.slice(0, 2)}${'•'.repeat(body)}${trimmed.slice(-2)}`;
}

/** FNV-1a. Not a security hash — it only has to be stable and short, and it must not be reversible
 * into the value, which is why the value itself is never stored alongside it. */
export function fingerprint(ruleId: string, value: string): string {
  let hash = 0x811c9dc5;
  const input = `${ruleId}:${value.trim().toLowerCase()}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function placeholderRanges(text: string): { start: number; end: number }[] {
  return [...text.matchAll(placeholderRegex())].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

const overlaps = (a: { start: number; end: number }, ranges: { start: number; end: number }[]) =>
  ranges.some((r) => a.start < r.end && r.start < a.end);

/** Advisory only. Nothing here blocks a copy: a heuristic that blocks trains people to dismiss
 * everything, and then a false negative feels like a guarantee — which is the failure this whole
 * effort exists to fix, reintroduced one layer up. DECISIONS.md §8.1: a suggestion, never a match. */
export function scan(text: string, rules: ScannerRule[] | CompiledRule[], options: ScanOptions = {}): Finding[] {
  if (text.length > MAX_INPUT) return [];
  const compiled = (rules as ScannerRule[])[0] && 'pattern' in (rules as ScannerRule[])[0] ? compileRules(rules as ScannerRule[]) : (rules as CompiledRule[]);
  const skip = options.skipRanges ?? placeholderRanges(text);
  const cap = options.maxMatchesPerRule ?? DEFAULT_MAX_MATCHES;
  const findings: Finding[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  for (const rule of compiled) {
    if (rule.invalid) continue;
    const raw: { start: number; end: number }[] = [];
    if (typeof rule.match === 'function') {
      raw.push(...rule.match(text).slice(0, cap));
    } else {
      const expression = new RegExp(rule.match.source, rule.match.flags);
      expression.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(text)) !== null) {
        // A zero-length match with the global flag never advances, so lastIndex must be nudged.
        if (match[0].length === 0) {
          expression.lastIndex++;
          continue;
        }
        // Prefer the capture group when the rule uses one, so `password = "x"` reports x, not the
        // whole assignment.
        const captured = match[1];
        const start = captured ? match.index + match[0].indexOf(captured) : match.index;
        raw.push({ start, end: start + (captured ?? match[0]).length });
        if (raw.length >= cap) break;
      }
    }
    for (const range of raw) {
      if (overlaps(range, skip)) continue;
      const value = text.slice(range.start, range.end);
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        category: rule.category,
        explanation: rule.explanation,
        start: range.start,
        end: range.end,
        line: lineOf(range.start),
        maskedExcerpt: maskExcerpt(value),
        suggestedAiReplacement: rule.suggestedAiReplacement,
        fingerprint: fingerprint(rule.id, value),
      });
    }
  }

  // One finding per span: the most severe rule that matched it wins, so a password caught by both
  // the assignment rule and the entropy rule is reported once.
  //
  // Except against the entropy rule, which is the fallback for values nothing can name. A rule that
  // names the value wins even when it is milder, because the name is the useful part: a GUID
  // reported as "random string" gets `<SECRET>` for an AI value instead of a GUID, and a JWT was
  // called a random string too. Nothing here blocks a copy, so severity is advice, not a gate.
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const fallback = (finding: Finding) => finding.ruleId === 'builtin:entropy';
  const best = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.start}:${finding.end}`;
    const existing = best.get(key);
    const wins = !existing || (fallback(existing) && !fallback(finding))
      || (fallback(existing) === fallback(finding) && order[finding.severity] < order[existing.severity]);
    if (wins) best.set(key, finding);
  }
  return [...best.values()].sort((a, b) => a.start - b.start);
}
