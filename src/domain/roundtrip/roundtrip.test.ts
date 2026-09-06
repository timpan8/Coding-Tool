import { describe, expect, it } from 'vitest';
import { binding } from '../../test/fixtures/factories';
import { ingest } from './index';

const password = binding({ name: 'ADMIN_PASSWORD', aiReplacement: '<PASSWORD>' });
const host = binding({ name: 'DB_HOST', aiReplacement: 'server.example.test', values: { __default__: 'sql01.corp.local' } });

describe('ingest', () => {
  it('leaves a placeholder that came back untouched', () => {
    const result = ingest('$p = "{{ADMIN_PASSWORD}}"', [password]);
    expect(result.template).toBe('$p = "{{ADMIN_PASSWORD}}"');
    expect(result.decisions).toMatchObject([{ tier: 1, accepted: true }]);
  });

  it('notices a placeholder with no binding rather than assuming one', () => {
    expect(ingest('{{UNKNOWN_ONE}}', [password]).decisions[0]).toMatchObject({ tier: 1, accepted: false });
  });

  it('restores the placeholder where the AI value stands', () => {
    const result = ingest('$h = "server.example.test"', [host]);
    expect(result.template).toBe('$h = "{{DB_HOST}}"');
    expect(result.decisions.filter((d) => d.tier === 2)).toHaveLength(1);
  });

  it('restores every occurrence, not only the first', () => {
    const result = ingest('a = "<PASSWORD>"\nb = "<PASSWORD>"', [password]);
    expect(result.template).toBe('a = "{{ADMIN_PASSWORD}}"\nb = "{{ADMIN_PASSWORD}}"');
    expect(result.decisions.filter((d) => d.tier === 2)).toHaveLength(2);
  });

  it('matches the longer value first when one contains the other', () => {
    const short = binding({ name: 'SHORT', aiReplacement: 'example.test' });
    const long = binding({ name: 'LONG', aiReplacement: 'server.example.test' });
    expect(ingest('$h = "server.example.test"', [short, long]).template).toBe('$h = "{{LONG}}"');
  });

  it('only reports a resemblance and never applies it', () => {
    // DECISIONS.md §8.1: tier 3 is a suggestion. A wrong automatic match here would rewrite the
    // user's code around a value that was never theirs.
    const result = ingest('$h = "server.example.org"', [host]);
    expect(result.template).toBe('$h = "server.example.org"');
    const tier3 = result.decisions.filter((d) => d.tier === 3);
    expect(tier3).toHaveLength(1);
    expect(tier3[0].accepted).toBe(false);
  });

  it('never puts a private value into the template', () => {
    const result = ingest('$h = "server.example.test"\n# sql01.corp.local', [host]);
    expect(result.template).not.toContain('sql01.corp.local}}');
    expect(JSON.stringify(result.decisions)).not.toContain('sql01.corp.local');
  });

  it('handles code that came back with nothing recognisable', () => {
    const result = ingest('Write-Output "hej"', [password, host]);
    expect(result.template).toBe('Write-Output "hej"');
    expect(result.decisions).toEqual([]);
  });
});
