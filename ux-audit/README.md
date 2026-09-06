# Granskningsunderlag

Belägg för [UX-AUDIT.md](../UX-AUDIT.md). **Inget här är appkod** — mappen kan tas bort utan att
appen påverkas. Ingen fil under `src/` ändrades i granskningen.

## Innehåll

| | |
|---|---|
| `screens/` | 111 skärmdumpar, namngivna `<vy>--<bredd>.png` för 390, 768 och 1440 px |
| `measure.json` | overflow, träffytor, tabbordning och semantik per route och bredd |
| `axe-results.json`, `axe-states.json` | axe-utfall för 26 tillstånd i båda teman |
| `contrast-results.json` | uppmätta kontrastvärden mot faktisk omgivande yta |
| `*.mjs` | granskningsskripten |

## Köra om något

Skripten drivs mot produktionsförhandsvisningen, inte dev-servern (repot dokumenterar att HMR
blockeras av CSP:n):

```sh
pnpm build && pnpm preview --port 4173   # i en terminal
node ux-audit/<skript>.mjs                # i en annan, från repo-roten
```

Varje ny browser-context startar med tomt IndexedDB, så de flesta skripten klistrar först in kod i
`.editor-body` för att skapa ett projekt, och stänger intro-modalen via
`dialog[open] .dialog-head button`.

## De skript som fynden i rapporten vilar på

| Skript | Vad det belägger |
|---|---|
| `shoot.mjs`, `states.mjs`, `versions.mjs`, `vshot.mjs`, `longstrings.mjs` | skärmdumparna |
| `measure.mjs` | overflow, träffytor, fokusordning, semantik |
| `overflow.mjs` | F-0.1 — vad som spiller ut vid 768 px |
| `grid.mjs` | F-D.2 — `grid-template-columns` per bredd |
| `vactions.mjs` | F-D.1 — versionshandlingarna dolda under 1251 px |
| `sample-btn.mjs` | F-1.1 — exempelknappen går inte att klicka |
| `deadsurface.mjs` | Fas 3 — varje interaktivt element klickat och jämfört före/efter |
| `emptystate.mjs` | F-1.2 — fem av fjorton knappar inaktiverade |
| `which-editor.mjs`, `mobile-binding.mjs` | F-2.8, F-D.4 — textarea kontra Monaco |
| `verify-route.mjs` | F-0.10 — tom sida vid kallstart på okänd route |
| `verify-qmark.mjs` | A.1, A.2 — `?` sväljs, Tab är en fälla |
| `axe-run.mjs`, `axe-states.mjs` | A.0 — axe över 26 tillstånd |
| `contrast-measure.mjs`, `contrast2.mjs` | A.5–A.10, A.14 — uppmätta kontrastvärden |
| `kbd2.mjs`, `inert-probe.mjs`, `focus-probe.mjs` | A.3, A.4, A.5 — fokus och tangentbord |
| `alert-probe.mjs` | A.7 — mutationer i live-regionen per tangenttryck |
| `tabs-probe.mjs` | A.6, A.13 — flikarnas tillståndskontrast och ARIA |
| `head-probe.mjs` | A.11, A.12 — rubriker, sidtitel, tillgängliga namn |

`probe.mjs`–`probe6.mjs`, `nav-*.mjs` och de övriga är arbetsskript från granskningen. De körs
med `ONLY=A,B` för enskilda avsnitt där det stöds.
