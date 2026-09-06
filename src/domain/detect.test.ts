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
    ['DATABASE_URL=postgres://localhost/app\nAPI_KEY=abc123\n', 'dotenv'],
    ['resource "aws_db_instance" "main" {\n  password = "hunter2"\n}\n', 'hcl'],
    ['SELECT id, name FROM users WHERE token = \'abc\';\n', 'sql'],
    ['using System;\n\nnamespace App { }\n', 'csharp'],
    ['package main\n\nfunc main() {}\n', 'go'],
    ['package com.example;\n\nimport java.util.List;\n', 'java'],
  ])('recognises %s', (code, expected) => {
    expect(detectLanguage(code)).toBe(expected);
  });

  it('says nothing rather than guessing wrong', () => {
    // The language decides how values are escaped, so a wrong answer is worse than none.
    expect(detectLanguage('')).toBeUndefined();
    expect(detectLanguage('hello world')).toBeUndefined();
    expect(detectLanguage('42')).toBeUndefined();
  });

  it('reads a dotenv name, which has no extension in the usual sense', () => {
    for (const name of ['.env', '.env.local', '.env.production']) expect(languageForFile(name)).toBe('dotenv');
    expect(languageForFile('main.tf')).toBe('hcl');
    expect(languageForFile('seed.sql')).toBe('sql');
    expect(languageForFile('Program.cs')).toBe('csharp');
    expect(languageForFile('main.go')).toBe('go');
    expect(languageForFile('App.java')).toBe('java');
  });

  it('does not call a Java import Python', () => {
    // `import ` matched Python's marker first, so a Java file was detected as Python — and the
    // language is what decides how a value is escaped.
    expect(detectLanguage('import java.util.List;\n\nclass A {}\n')).toBe('java');
    expect(detectLanguage('import os\n\ndef main():\n    pass\n')).toBe('python');
  });

  it('does not mistake a single shell assignment for a dotenv file', () => {
    expect(detectLanguage('export PATH="$PATH:/opt/bin"\n')).toBe('shell');
    expect(detectLanguage('A=1\n')).toBeUndefined();
  });

  it('does not call broken JSON JSON', () => {
    expect(detectLanguage('{"a": 1,}')).not.toBe('json');
  });
});
