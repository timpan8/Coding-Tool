import { describe, expect, it } from 'vitest';
import { directoryPart, looksLikeFile, trimToDirectory } from './paths';

describe('directoryPart', () => {
  it('keeps the file name out of the binding', () => {
    expect(directoryPart('C:\\Scripts\\AdSync\\run.log')).toBe('C:\\Scripts\\AdSync');
    expect(directoryPart('\\\\fs01\\payroll\\2026\\report.xlsx')).toBe('\\\\fs01\\payroll\\2026');
    expect(directoryPart('/home/anna/scripts/sync.py')).toBe('/home/anna/scripts');
  });

  it('leaves a folder alone', () => {
    expect(directoryPart('C:\\Scripts\\AdSync')).toBe('C:\\Scripts\\AdSync');
    expect(directoryPart('C:\\Scripts\\AdSync\\')).toBe('C:\\Scripts\\AdSync\\');
    expect(directoryPart('\\\\fs01\\payroll')).toBe('\\\\fs01\\payroll');
  });

  it('leaves anything that is not a path alone', () => {
    expect(directoryPart('anna.andersson@company.se')).toBe('anna.andersson@company.se');
    expect(directoryPart('Hunter2-Very-Secret!')).toBe('Hunter2-Very-Secret!');
    expect(directoryPart('sql01.corp.local')).toBe('sql01.corp.local');
  });

  it('never trims a path down to a bare root', () => {
    expect(directoryPart('C:\\run.log')).toBe('C:\\run.log');
    expect(directoryPart('/run.log')).toBe('/run.log');
  });

  it('knows a file name from a folder name', () => {
    expect(looksLikeFile('run.log')).toBe(true);
    expect(looksLikeFile('Create-ADUsers.ps1')).toBe(true);
    expect(looksLikeFile('AdSync')).toBe(false);
    expect(looksLikeFile('v1.2.3-releases')).toBe(false);
  });
});

describe('trimToDirectory', () => {
  it('returns the span of the directory within the text', () => {
    const text = '$log = "C:\\Scripts\\AdSync\\run.log"';
    const start = text.indexOf('C:'), end = text.lastIndexOf('"');
    expect(trimToDirectory(text, start, end)).toEqual({ start, end: start + 'C:\\Scripts\\AdSync'.length });
    expect(text.slice(trimToDirectory(text, start, end).end, end)).toBe('\\run.log');
  });

  it('leaves a span it has nothing to say about untouched', () => {
    const text = '$p = "Hunter2"';
    expect(trimToDirectory(text, 6, 13)).toEqual({ start: 6, end: 13 });
  });
});
