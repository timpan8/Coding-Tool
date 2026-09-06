import type { Binding, IngestReport } from '../../types/models';
import { placeholderRegex } from '../render';

export interface IngestDecision {
  bindingName: string;
  /** 1: the placeholder survived untouched. 2: the AI value stands where the placeholder was.
   * 3: something that looks like the AI value, which is a suggestion and never applied on its own. */
  tier: 1 | 2 | 3;
  start: number;
  end: number;
  accepted: boolean;
  reason: string;
}

export interface Ingest {
  /** The template as it would be, with tier 1 and 2 applied and tier 3 left alone. */
  template: string;
  decisions: IngestDecision[];
  report: IngestReport;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Turns code that came back from an AI into a template again.
 *
 * The AI was given placeholders and asked to keep them. Usually it does, and tier 1 is simply
 * noticing that. Where it substituted its own example value back in, tier 2 recognises that value
 * exactly and restores the placeholder. Tier 3 is anything that merely resembles one.
 *
 * DECISIONS.md §8.1 and §8.4: tier 3 is always a suggestion, never an automatic match. It is
 * reported and left in place, because a wrong automatic match here would silently rewrite the
 * user's code around a value that was never theirs. */
export function ingest(incoming: string, bindings: Binding[]): Ingest {
  const decisions: IngestDecision[] = [];
  let template = incoming;

  // Tier 1: placeholders the AI left alone.
  for (const match of incoming.matchAll(placeholderRegex())) {
    const known = bindings.some((b) => b.name === match[1]);
    decisions.push({
      bindingName: match[1],
      tier: 1,
      start: match.index,
      end: match.index + match[0].length,
      accepted: known,
      reason: known ? 'Platshållaren kom tillbaka orörd.' : 'Platshållaren finns kvar men saknar binding.',
    });
  }

  // Tier 2: an AI value standing exactly where a placeholder was. Longest first, so a value that
  // contains another is matched before its own substring.
  const byLength = [...bindings].filter((b) => b.aiReplacement).sort((a, b) => b.aiReplacement.length - a.aiReplacement.length);
  for (const binding of byLength) {
    const pattern = new RegExp(escapeRegex(binding.aiReplacement), 'g');
    const hits = [...template.matchAll(pattern)];
    if (!hits.length) continue;
    for (const hit of hits) {
      decisions.push({
        bindingName: binding.name,
        tier: 2,
        start: hit.index,
        end: hit.index + hit[0].length,
        accepted: true,
        reason: 'AI-värdet stod kvar och ersattes med platshållaren.',
      });
    }
    template = template.split(binding.aiReplacement).join(`{{${binding.name}}}`);
  }

  // Tier 3: a resemblance, reported and left alone.
  for (const binding of bindings) {
    if (!binding.aiReplacement) continue;
    const stem = binding.aiReplacement.replace(/[<>]/g, '').split(/[.@/\\]/)[0];
    if (stem.length < 4) continue;
    const pattern = new RegExp(`\\b${escapeRegex(stem)}[\\w.@-]*`, 'gi');
    for (const hit of template.matchAll(pattern)) {
      if (template.slice(Math.max(0, hit.index - 2), hit.index).includes('{{')) continue;
      decisions.push({
        bindingName: binding.name,
        tier: 3,
        start: hit.index,
        end: hit.index + hit[0].length,
        accepted: false,
        reason: 'Liknar AI-värdet men är inte identiskt. Granska och koppla själv om det stämmer.',
      });
    }
  }

  return { template, decisions, report: { decisions } };
}
