# CodeVault

Ett webbverktyg som sitter mellan AI-chatten och ditt kodverktyg. Det är en ren klientapp: allt du lagrar krypteras i din webbläsare och ingen server ser dina värden. Du klistrar in kod från AI:n, markerar var dina riktiga värden (användarnamn, lösenord, servrar, tenant-id, sökvägar) ska sitta, och verktyget minns dem. Nästa version från AI:n klistras in, fälten återappliceras, och du kopierar ut riktig kod till editorn eller sanerad kod tillbaka till AI:n. Inget riktigt värde lämnar någonsin verktyget via "Kopiera för AI".

## Grundidén

- **En version lagras aldrig som kod med riktiga värden.** Den lagras som en mall (textsegment + fältreferenser) och en separat krypterad fälttabell. "Kod för AI" och "riktig kod" är två renderingar av samma objekt. Diff, versionsbibliotek, sök och export blir säkra genom konstruktion.
- **Verktyget äger exempelvärdena.** Stabila, realistiska till formen men i reserverade namnrymder (`example.com`, `corp.example`, `SRV-EXAMPLE01`, `192.0.2.x`, `C:\Example\Project01`). AI:n bevarar dem ordagrant, så återapplicering blir i huvudsak exakt strängmatchning, och en fejk kan aldrig förväxlas med ett riktigt värde.
- **Konservativ automatik.** Bara exakta träffar på exempelvärdet autoappliceras. Allt annat visas i en granskningsvy. "Kopiera riktigt" blockeras tills hemliga fält är lösta.
- **En oberoende läckvakt** skannar allt som lämnar "för AI" mot alla kända riktiga värden (inklusive kodade varianter) och vägrar kopiera vid träff.

## Ordlista

| Ord | Betydelse |
| --- | --- |
| Valv | Hela datamängden, krypterad med ditt master-lösenord |
| Skript | En kodfil med ett versionsbibliotek |
| Version | En oföränderlig ögonblicksbild per inklistring |
| Fält | Ett känsligt värde med två renderingar: **exempelvärde** (till AI:n) och **riktigt värde** (till editorn) |
| Markera | Peka ut var i koden ett fält sitter |
| Kopiera för AI | Sanerad rendering, alltid genom läckvakten |
| Kopiera riktigt | Riktig rendering, en enda skyddad kodväg |

## Hotmodell i korthet

Verktyget skyddar mot att riktiga värden når AI-chatten via urklipp, mot att de ligger i klartext på disk (allt i valvet krypteras; IndexedDB innehåller bara chiffertext) och mot skärmdelning (maskerat som standard). Det skyddar **inte** mot webbläsartillägg som läser sidan, mot en editor med inbyggd AI (Copilot, Cursor) som redan ser den riktiga filen, och det kan inte radera poster ur Windows urklippshistorik (Win+V) från en webbsida.

## Köra

Utveckling:

```
npm install
npm run dev        # http://127.0.0.1:5173
```

Produktion: `npm run build` ger en statisk `dist/`-mapp som kan serveras från vilken statisk host som helst (GitHub Pages, en mapp bakom en enkel webbserver, eller `npm run preview` lokalt). Appen behöver ingen backend.

```
npm run build
npm run preview     # http://127.0.0.1:4173
npm run check-deps  # alla licenser tillåtna, THIRD-PARTY-NOTICES.md skrivs
```

Tester och lint:

```
npm test
npm run lint
```

## Struktur

```
src/engine/   rena funktioner utan DOM (lexer, mall, återapplicering, läckvakt), körs i en Web Worker
src/vault/    kryptering, lagring, lås, backup, merge
src/ui/       Preact-gränssnitt
src/i18n/     UI-strängar (sv default, en fallback)
tests/        Vitest: fixtures och egenskapstester
scripts/      check-deps.mjs (licenser och THIRD-PARTY-NOTICES)
```

## Säkerhetsregler i koden

- Riktiga värden finns aldrig i editor-dokumentet, ångrahistoriken, DOM-attribut, diff-modellen eller versionshistoriken.
- Exakt en `exportReal()`-kodväg. Inga genvägar.
- `Ctrl+C`, klipp och drag i editorn ger alltid den sanerade renderingen och kör vakten.
- `index.html` bär en same-origin-CSP. Inga CDN-länkar, inga webbfonter, ingen telemetri. Appen gör inga nätverksanrop av sig själv.
- Alla inmatningsfält är `type=text` med manuell maskering och `autocomplete=off`, aldrig `type=password`.
