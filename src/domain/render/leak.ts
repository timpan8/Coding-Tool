import type { Binding } from '../../types/models';

export interface LeakHit {
  bindingName: string;
  /** Which project's binding the value belongs to, so the message can say where it came from. */
  ownerScopeRef: string | null;
  start: number;
  end: number;
}
export interface ValueIndex {
  values: { name: string; value: string; scopeRef: string | null }[];
}

/** Flattens every private value in the whole vault into one list, once.
 *
 * Reading the whole vault rather than the open project's bindings is deliberate, and is the
 * guarantee behind invariant 4: a value bound in one project must not be able to walk into an AI
 * copy made from another. Scope resolution is a separate question, handled by resolveBinding. */
export function buildValueIndex(bindings: Binding[]): ValueIndex {
  const values: ValueIndex['values'] = [];
  for (const binding of bindings) {
    for (const value of Object.values(binding.values)) {
      if (value) values.push({ name: binding.name, value, scopeRef: binding.scopeRef });
    }
  }
  return { values };
}

/** A plain scan, on purpose.
 *
 * A prefix-filtered index was written first and measured against this: with 50 bindings over 24 kB
 * of text it was twice as slow, and it only overtook a plain scan somewhere past 200 bindings.
 * String.prototype.indexOf is native; building a JavaScript index over the text to avoid it is not
 * a trade that pays at the sizes this app sees.
 *
 * The cost that mattered was never this loop — it was that the loop ran on every keystroke. It now
 * runs when a projection is rebuilt or a copy is made. If a vault ever grows large enough for this
 * to be felt while typing, the answer is Aho–Corasick over one pass, not a partial index. */
export function findLeaks(output: string, index: ValueIndex): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const entry of index.values) {
    const start = output.indexOf(entry.value);
    if (start >= 0) {
      hits.push({ bindingName: entry.name, ownerScopeRef: entry.scopeRef, start, end: start + entry.value.length });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}
