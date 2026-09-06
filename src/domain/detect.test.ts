import { describe, expect, it } from 'vitest';
import { detectLanguage, languageForFile } from './detect';

describe('languageForFile', () => {
  it('reads the extension where there is one', () => {
    expect(languageForFile('Create-ADUsers.ps1')).toBe('powershell');
    expect(languageForFile('deploy.YML')).toBe('yaml');
    expect(languageForFile('notes')).toBeUndefined();
  });
});

describe('detectLanguage', () => {
  it.each([
    ['#!/bin/bash\necho hi\n', 'shell'],
    ['#!/usr/bin/env python3\nprint("hi")\n', 'python'],
    ['{"a": 1, "b": "two"}', 'json'],
    ['<?xml version="1.0"?><root/>', 'xml'],
    ['$user = "x"\nWrite-Output $user\n', 'powershell'],
    ['def main():\n    print("hi")\n', 'python'],
    ['interface User { name: string }\n', 'typescript'],
    ['const a = 1;\nfunction b() {}\n', 'javascript'],
    ['---\nname: deploy\non: push\n', 'yaml'],
  ])('recognises %s', (code, expected) => {
    expect(detectLanguage(code)).toBe(expected);
  });

  it('says nothing rather than guessing wrong', () => {
    // The language decides how values are escaped, so a wrong answer is worse than none.
    expect(detectLanguage('')).toBeUndefined();
    expect(detectLanguage('hello world')).toBeUndefined();
    expect(detectLanguage('42')).toBeUndefined();
  });

  it('does not call broken JSON JSON', () => {
    expect(detectLanguage('{"a": 1,}')).not.toBe('json');
  });
});
