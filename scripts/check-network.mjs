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
for (const tag of ['preconnect', 'dns-prefetch', 'prefetch', 'preload']) {
  if (new RegExp(`rel=["']?${tag}`, 'i').test(html)) failures.push(`index.html requests ${tag}`);
}

// Stylesheets can reach the network too: a remote @import or a url() pointing off-origin.
let stylesheets = 0;
for (const entry of await readdir('dist/assets', { withFileTypes: true })) {
  if (!entry.name.endsWith('.css')) continue;
  stylesheets++;
  const css = await readFile(join('dist/assets', entry.name), 'utf8');
  for (const pattern of [/@import\s+(?:url\()?["']?https?:/i, /url\(\s*["']?(?:https?:)?\/\//i]) {
    if (pattern.test(css)) failures.push(`${entry.name}: remote reference ${pattern}`);
  }
}

// A colour may only appear where a token is defined. Anywhere else it would exist in one theme
// and not the other, which is how a dark theme silently rots.
const stray = [];
for (const file of ['src/ui/styles.css', 'src/ui/code-first.css']) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (/^\s*--[a-z-]+\s*:/.test(line)) return;
    for (const match of line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) stray.push(`${file}:${index + 1}: ${match}`);
  });
}
if (stray.length) failures.push(`Colour literals outside a token definition:\n  ${stray.join('\n  ')}`);

if (failures.length) { console.error('Static audit failed:\n' + failures.join('\n')); process.exitCode = 1; }
else console.log(`Static audit passed: ${checked} JavaScript bundles, ${stylesheets} stylesheets; exact CSP present; colours confined to token definitions. This is a bounded static check, not a security guarantee.`);
