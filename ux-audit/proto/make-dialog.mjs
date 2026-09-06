/** Bygger återmappningsdialogens DOM ur ett scenario.
 *
 * Strukturen, klassnamnen och radformatet är avlästa ur den renderade dialogen och ur den
 * publicerade bundlen ($9 = diff-rutan, Lce = dialogen). Innehållet räknas fram här i stället för
 * att skrivas för hand, så scenariot går att variera utan att strukturen driver iväg. */

/** Radbaserad LCS, samma utfall som en vanlig diff: kind same | add | remove. */
export function diffLines(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ kind: 'remove', text: a[i], oldLine: i + 1 }); i++; }
    else { rows.push({ kind: 'add', text: b[j], newLine: j + 1 }); j++; }
  }
  while (i < n) rows.push({ kind: 'remove', text: a[i], oldLine: ++i });
  while (j < m) rows.push({ kind: 'add', text: b[j], newLine: ++j });
  return rows;
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const marker = k => (k === 'add' ? '+ ' : k === 'remove' ? '- ' : '  ');

function pre(rows, selectedLines) {
  const spans = rows.map(r => {
    const sel = selectedLines?.has(r.newLine ?? r.oldLine) ? 'diff-selected' : '';
    return `<span class="${r.kind === 'same' ? 'diff-same' : `diff-${r.kind}`} ${sel}">${marker(r.kind)}${esc(r.text)}\n</span>`;
  }).join('');
  return `<pre class="version-diff paste-diff-preview">${spans}</pre>`;
}

function row(m) {
  const locked = m.confidence === 'hög';
  return `<button class="reconciliation-row${m.selected ? ' selected' : ''}">`
    + `<span><strong>${esc(m.name)}</strong><small>rad ${m.line}, kolumn ${m.column} · ${m.occurrences} förekomst${m.occurrences === 1 ? '' : 'er'}</small></span>`
    + `<span><code>${esc(m.value)}</code><small>→ {{${esc(m.name)}}}</small></span>`
    + `<span><small>${esc(m.method)} · ${esc(m.confidence)}</small></span>`
    + `<span><input aria-label="Acceptera ${esc(m.name)}" ${locked ? 'disabled="" ' : ''}type="checkbox"${m.accepted ? ' checked=""' : ''}></span>`
    + `</button>`;
}

export function dialog({ baseNumber, baseTemplate, pasted, mappedTemplate, mappings, unresolved = 0, conflicts = 0 }) {
  const chosen = mappings.filter(m => m.accepted).length;
  const selected = new Set(mappings.filter(m => m.selected).flatMap(m => [m.line, m.line + 1]));
  return `<dialog aria-label="Ny version · baserad på v${baseNumber}" open=""><header class="dialog-head"><h2>Ny version · baserad på v${baseNumber}</h2><button aria-label="Stäng dialog">×</button></header>`
    + `<p class="quick-intro">Klistra in AI-sanerad kod. Granska varje mapping innan koden används som lokalt utkast.</p>`
    + `<textarea data-version-paste="true" aria-label="AI-kod för ny version" class="version-paste" placeholder="Klistra in den nya koden här…" spellcheck="false">${esc(pasted)}</textarea>`
    + `<div class="dialog-actions"><button>Avbryt</button><button class="primary">Analysera</button></div>`
    + `<section class="reconciliation-results"><h3>Granska återmappning</h3>`
    + `<p class="reconciliation-summary">${chosen} mappings valda · ${unresolved} omappade · ${conflicts} konflikter</p>`
    + `<div class="reconciliation-layout"><div class="reconciliation-table">`
    + `<div class="reconciliation-head"><span>Binding</span><span>Ny text → platshållare</span><span>Metod · säkerhet</span><span>Val</span></div>`
    + mappings.map(row).join('')
    + `</div><div class="reconciliation-code"><h4>Ny kod · mappingförhandsvisning</h4>`
    + pre(diffLines(pasted, mappedTemplate), selected)
    + `</div></div><div class="paste-diff-sections">`
    + `<div><h4>Rå kod mot basversion</h4>${pre(diffLines(baseTemplate, pasted))}</div>`
    + `<div><h4>Mall mot basversion</h4>${pre(diffLines(baseTemplate, mappedTemplate))}</div>`
    + `</div><div class="dialog-actions"><button class="primary">Använd kod som utkast</button></div></section></dialog>`;
}
