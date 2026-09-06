import { describe, expect, it } from 'vitest';
import { binding } from '../../test/fixtures/factories';
import { suggestBinding } from './index';
import type { Binding } from '../../types/models';

/** The name a suggestion produces has to be one the user can actually save.
 *
 * suggestBinding derives the name from the variable to the left of the selection, so two lines that
 * assign to the same variable produce the same name — and the second one was rejected on save with
 * "Namnet används redan i detta scope.", an error the user did not cause and could not act on
 * without inventing a name themselves. */
const scope = { scope: 'project' as const, scopeRef: 'project' };
const taken = (...names: string[]): Binding[] => names.map((name) => binding({ name, ...scope }));

describe('suggestBinding · a suggested name is free to use', () => {
  it('suggests the plain name when nothing is taken', () => {
    expect(suggestBinding('$username = ', 'anna', [], scope).name).toBe('USERNAME');
  });

  it('counts up rather than proposing a name that is already used', () => {
    expect(suggestBinding('$username = ', 'anna', taken('USERNAME'), scope).name).toBe('USERNAME_2');
    expect(suggestBinding('$username = ', 'bo', taken('USERNAME', 'USERNAME_2'), scope).name).toBe('USERNAME_3');
  });

  it('only counts names in the scope the binding will land in', () => {
    // A global USERNAME does not block a project one — validateBinding compares scope too. It does
    // shadow it at resolve time, but that is a different problem and not this function's to solve.
    const global = [binding({ name: 'USERNAME', scope: 'global', scopeRef: null })];
    expect(suggestBinding('$username = ', 'anna', global, scope).name).toBe('USERNAME');
  });

  it('still produces a valid name when the derived one is a single character', () => {
    expect(suggestBinding('$p = ', 'Hunter2', [], scope).name).toBe('P_VALUE');
    expect(suggestBinding('$p = ', 'Hunter2', taken('P_VALUE'), scope).name).toBe('P_VALUE_2');
  });

  it('keeps every suggestion within the 64 characters validateBinding allows', () => {
    const long = 'a'.repeat(70);
    const first = suggestBinding(`$${long} = `, 'x', [], scope).name;
    expect(first.length).toBeLessThanOrEqual(64);
    const second = suggestBinding(`$${long} = `, 'x', taken(first), scope).name;
    expect(second.length).toBeLessThanOrEqual(64);
    expect(second).not.toBe(first);
  });

  it('leaves the category alone', () => {
    expect(suggestBinding('$password = ', 'x', taken('PASSWORD'), scope).category).toBe('secret');
    expect(suggestBinding('$host = ', 'x', [], scope).category).toBe('infrastructure');
  });
});
