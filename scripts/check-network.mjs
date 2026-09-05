import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const forbidden = [ /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsendBeacon\s*\(/, /\bnew\s+WebSocket\s*\(/, /\bnew\s+EventSource\s*\(/ ];
const failures = [];
let checked = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.js') && entry.name !== 'sw.js') {
      checked++;
      const code = await readFile(path, 'utf8');
      for (const pattern of forbidden) if (pattern.test(code)) failures.push(`${path}: ${pattern}`);
    }
  }
}
await walk('dist');
const html = await readFile('dist/index.html', 'utf8');
if (!html.includes("connect-src 'none'")) failures.push('CSP connect-src missing');
if (failures.length) { console.error('Network audit failed:\n' + failures.join('\n')); process.exitCode = 1; }
else console.log(`Network audit passed: ${checked} JavaScript bundles; exact CSP present. This is a bounded static check, not a security guarantee.`);
