import { describe, expect, it } from 'vitest';
import { sanitize } from './Sanitize';
import { binding } from '../../test/fixtures/factories';

const host = binding({ id: 'h', name: 'HOST', category: 'infrastructure', aiReplacement: 'server.example.test', values: { __default__: 'sql01.corp.local' } });
const password = binding({ id: 'p', name: 'ADMIN_PASSWORD', category: 'secret', aiReplacement: '<PASSWORD>', values: { __default__: 'SuperSecret123!', work: 'WorkSecret!' } });

describe('sanitize', () => {
  it('replaces every known value in every profile, counts them, and leaves nothing standing', () => {
    const result = sanitize('sql01.corp.local failed: pwd SuperSecret123!, then WorkSecret! and SuperSecret123! again', [host, password], []);
    expect(result.text).toBe('server.example.test failed: pwd <PASSWORD>, then <PASSWORD> and <PASSWORD> again');
    expect(result.replaced).toBe(4);
    expect(result.remaining).toBe(0);
  });

  it('applies the blocklist with the entry replacement, or the binding AI value when one exists', () => {
    const entry = { id: 'e', term: 'mittforetag.se', replacement: 'example.com', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
    expect(sanitize('mail@mittforetag.se', [], [entry]).text).toBe('mail@example.com');
    const bound = binding({ id: 'b', name: 'MITTFORETAG_SE', category: 'configuration', aiReplacement: 'firma.example.test', values: { __default__: 'mittforetag.se' } });
    expect(sanitize('https://mittforetag.se/api', [bound], [entry]).text).toBe('https://firma.example.test/api');
  });

  it('leaves text the vault knows nothing about alone', () => {
    const result = sanitize('Access denied for svc_adsync', [host, password], []);
    expect(result.text).toBe('Access denied for svc_adsync');
    expect(result.replaced).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('reports a known value that is still there rather than claiming it is gone', () => {
    // A binding whose AI value contains its own real value cannot be sanitised by substitution.
    const odd = binding({ id: 'o', name: 'ODD', category: 'configuration', aiReplacement: 'x', values: { __default__: 'x' } });
    expect(sanitize('x marks the spot', [odd], []).remaining).toBe(1);
  });
});
