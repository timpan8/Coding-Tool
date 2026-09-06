import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { binding } from '../../test/fixtures/factories';
import { auditForCopy, auditSelection } from './audit';
import { render } from './index';

const ai = { mode: 'ai' as const, language: 'powershell' as const, projectId: 'project', versionId: 'version', profileId: null };
const bindings = [binding()];

/** Report U19. The slice is taken from the whole rendered file, never rendered on its own: escaping
 * reads the surrounding source, so a fragment beginning inside a string literal would be lexed
 * wrongly. These tests are about the mapping from template offsets onto rendered offsets, which is
 * where a wrong answer would be silent. */
describe('auditSelection', () => {
  const template = 'Write-Host "start"\n$p = "{{ADMIN_PASSWORD}}"\nWrite-Host "end"\n';

  it('returns exactly the rendered text of the selected range', () => {
    const from = template.indexOf('$p'), to = template.indexOf('\nWrite-Host "end"');
    const slice = auditSelection(template, bindings, ai, { start: from, end: to });
    expect(slice.text).toBe('$p = "<PASSWORD>"');
    expect(slice.used).toEqual(['ADMIN_PASSWORD']);
    expect(slice.canCopy).toBe(true);
  });

  it('reports substitution ranges relative to the slice, not the file', () => {
    const from = template.indexOf('$p'), to = template.indexOf('\nWrite-Host "end"');
    const slice = auditSelection(template, bindings, ai, { start: from, end: to });
    const [only] = slice.substitutions;
    expect(slice.text.slice(only.start, only.end)).toBe('<PASSWORD>');
  });

  it('does not block on a problem that lies outside the selection', () => {
    const withHole = `${template}$q = "{{NO_SUCH_BINDING}}"\n`;
    expect(auditForCopy(withHole, bindings, ai).canCopy).toBe(false);
    const slice = auditSelection(withHole, bindings, ai, { start: 0, end: template.indexOf('\n') });
    expect(slice.canCopy).toBe(true);
    expect(slice.text).toBe('Write-Host "start"');
  });

  it('blocks when a private value stands in the selection itself', () => {
    const leaky = 'Write-Host "clean"\n$p = "SuperSecret123!"\n';
    const slice = auditSelection(leaky, bindings, ai, { start: leaky.indexOf('$p'), end: leaky.length });
    expect(slice.canCopy).toBe(false);
    expect(slice.leaks[0].bindingName).toBe('ADMIN_PASSWORD');
    // The same value outside the selection is not this copy's problem.
    expect(auditSelection(leaky, bindings, ai, { start: 0, end: 18 }).canCopy).toBe(true);
  });

  it('snaps an offset that falls inside a placeholder to its edge', () => {
    const inside = template.indexOf('{{ADMIN_PASSWORD}}') + 4;
    const slice = auditSelection(template, bindings, ai, { start: inside, end: template.length });
    // Never half a substituted value: the whole replacement is in or it is out.
    expect(slice.text.startsWith('<PASSWORD>')).toBe(true);
    expect(slice.text).not.toContain('SSWORD}}');
  });

  it('leaves an unresolved placeholder in place and blocks on it', () => {
    const t = '$q = "{{NO_SUCH_BINDING}}"';
    const slice = auditSelection(t, bindings, ai, { start: 0, end: t.length });
    expect(slice.text).toBe(t);
    expect(slice.canCopy).toBe(false);
  });

  it('agrees with a whole-file audit when the selection is the whole file', () => {
    const whole = auditForCopy(template, bindings, ai);
    const slice = auditSelection(template, bindings, ai, { start: 0, end: template.length });
    expect(slice.text).toBe(whole.text);
    expect(slice.canCopy).toBe(whole.canCopy);
  });

  /** The mapping is arithmetic over ranges, which is exactly the kind of code that is right for the
   * cases someone thought of and wrong for the rest. */
  it('never cuts a substituted value in half, for any range', () => {
    fc.assert(
      fc.property(fc.nat(template.length), fc.nat(template.length), (a, b) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        const slice = auditSelection(template, bindings, ai, { start, end });
        const rendered = render(template, bindings, ai).text;
        // Whatever the range, the slice is a contiguous piece of the rendered file...
        expect(rendered).toContain(slice.text);
        // ...and never contains a fragment of the placeholder syntax left over from a partial cut.
        for (const piece of ['{{ADMIN', 'SSWORD}}']) expect(slice.text).not.toContain(piece);
      }),
      { numRuns: 300 },
    );
  });
});
