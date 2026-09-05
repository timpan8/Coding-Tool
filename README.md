# AI Code Vault

Statisk React/TypeScript-app för GitHub Pages. Kod lagras som mallar med `{{BINDING_NAME}}`. Local-vyn renderar privata värden; AI-vyn renderar ofarliga exempel. Ingen kod körs och ingen AI-tjänst anropas.

## Status

**M1 – körbar kärnrunda.** Projekt, en fil per projekt i UI, bevarade versioner, Monaco, skapa/redigera/radera bindings, scope-resolution, profil-fallback i domänen, kontextstyrd escaping, tre tydliga vyer och kopiering. Secrets maskeras som standard och lokal kopiering med secrets kräver bekräftelse.

**Inte levererat ännu:** M2 reconciliation/scanner/markörer, M3 backup/import/merge/autosave, M4 diff/datasets/profil-UI, M5 sökvägsregler/diskintegration. Använd testvärden tills backup finns. `StorageProvider.importAll` avvisar anrop i M1; import aktiveras först tillsammans med M3:s schema och granskning.

## Start

Kräver Node.js 24+ och pnpm. Beroenden låses i `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm preview --port 4173
```

Använd produktionsförhandsvisningen för säkerhetskontroller. Utvecklingsserverns HMR använder WebSocket och blockeras av den avsiktligt strikta CSP:n; sänk inte produktionspolicyn för att få HMR att fungera.

1. Skapa projekt med PowerShell som språk.
2. Klistra in kod eller välj den ofarliga exempelkoden.
3. Markera ett värde och tryck **Ctrl+B** (eller högerklick → Skapa binding). Ange exempelvis `ADMIN_USERNAME`, ett syntetiskt privat värde och `example.user` som AI-värde.
4. Spara en version. Växla mellan **Mall**, **Local**, **AI** och kopiera rätt vy.
5. Redigera endast mallen. Varje sparning skapar en ny version; återgång skapar också en ny version.

`Ctrl+Shift+C` = Copy for AI. `Ctrl+Alt+C` = Copy Local. `Ctrl+K` fokuserar dashboardens sökfält. Övriga kortkommandon införs med sina milstolpar.

## Hosting: GitHub Pages

Endast byggda statiska appfiler publiceras. Inga serverfunktioner, CDN, externa fonter eller analytics.

- Repository: `timpan8/Coding-Tool`.
- Publicerad gren: `gh-pages`, rotmapp `/`.
- `VITE_BASE` styr Vites basväg, standard `./`. Hash-routing fungerar under repo-sökvägen utan serveromskrivningar.
- `pnpm build` skapar `dist/`, genererar en service worker med precache av app-shellet och kör nätverkskontrollen. En uppdatering aktiveras först via notisen i appen.
- Byggd appversion/commit visas i sidfoten.
- Publicera bara `dist/` till `gh-pages`. Inkludera `.nojekyll`. Lägg aldrig backupfiler eller användardata i repot.

## Hotmodell och begränsningar

Samma information finns på `#/security` i appen.

Verktyget är byggt för att minska oavsiktlig delning av privata värden, bevara dem när kod uppdateras samt stödja delbar export och återställning. De senare delarna levereras i sina milstolpar.

Det skyddar **inte** mot skadlig kod, keyloggers, annan användare på samma OS-konto, webbläsartillägg som kan läsa DOM/IndexedDB, diskforensik, manuellt skickade hemligheter eller en komprometterad GitHub Pages-app/supply chain.

**Urklippshistorik och molnsynkat urklipp ligger utanför appens kontroll.** Copy Local lägger riktiga värden i Windows/macOS/Linux-urklippet. Ingen automatisk urklippsrensning finns i M1.

**IndexedDB lagrar privata värden i klartext**, enligt specifikationen. Inget huvudlösenord. Rensad webbläsardata, annan profil eller annat origin kan göra valvet oåtkomligt. Backup finns ännu inte i M1.

**Origin är viktigt:** `http://localhost:5173`, `http://127.0.0.1:4173` och `https://timpan8.github.io` har separata valv. Välj ett primärt origin. Repo-sökvägar på samma `user.github.io` delar däremot origin; separata databasnamn är bara namnisolering, ingen säkerhetsgräns mellan appar. Aktuellt origin visas i inställningarna. Ingen synk mellan datorer.

Appen säger **”Inga kända problem hittades”**, aldrig att säkerhet är garanterad. M1 blockerar saknade värden, osäkra renderingskontexter och exakta kända privata värden vid AI-kopiering. Okända och transformerade värden kan fortfarande förekomma; full scanner införs i M2. Escaping är konservativ textbearbetning och ersätter inte en fullständig språkparser.

## Verifiering

`pnpm test` kör Vitest, fake-indexeddb och fast-check. Domänlogik saknar DOM-beroenden. Storage-kontraktet kan köras mot framtida providers med samma tester. Tester använder endast syntetiska värden.

`pnpm build` kontrollerar TypeScript strict, bygger alla lokala Monaco-resurser och granskar JavaScript-bundlen för nätverksanrop utanför service workern. CSP har `connect-src 'none'`. Kontrollerna är begränsade och är inte ett bevis på frånvaro av alla möjliga läckagevägar.

Arkitektur och tolkningar finns i [DECISIONS.md](DECISIONS.md). Tekniska referenser: [Vite production build](https://vite.dev/guide/build), [Monaco API](https://microsoft.github.io/monaco-editor/typedoc/index.html), [Dexie](https://dexie.org/docs/).
