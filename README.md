# AI Code Vault

Statisk React/TypeScript-app för GitHub Pages. Kod lagras som mallar med `{{BINDING_NAME}}`. Local-vyn renderar privata värden; AI-vyn renderar ofarliga exempel. Ingen kod körs och ingen AI-tjänst anropas.

## Status

**Verktyget är avsett att användas med dina riktiga värden.** Startsidan är en direkt kodarbetsyta: första inklistringen skapar ett namnlöst projekt och ett lokalt utkast automatiskt. Utkast sparas med debounce och revisionskontroll och fyller aldrig versionshistoriken.

Ett projekt kan ha flera filer. Versioner har etiketter, går att jämföra, förhandsgranska skrivskyddat och radera. Bindings kan byta namn i alla mallar på en gång, raderas med värdet återskrivet i filen, ha ett värde per profil, och nås samlat på `#/bindings` — vilket är enda stället en global binding går att komma åt. Kod som kommer tillbaka från en AI kan klistras in och matchas mot dina värden igen, i tre nivåer där den tredje alltid är ett förslag.

En heuristisk scanner letar efter värden som liknar hemligheter och varnar per träff. Den blockerar aldrig: en falsk positiv som inte går att kvittera är hur ett verktyg blir kringgått. Reglerna går att stänga av och komplettera med egna sökord.

Arton språk har var sitt escaping-regelverk. Kontexter som inte kan hanteras säkert vägras med besked om vad man ska göra i stället, i stället för att gissas.

Valvet går att exportera i två former och återställa, appen begär beständig lagring så att webbläsaren inte vräker det, urklippet kan rensas automatiskt efter Copy Local, och kopieringsdialogen redovisar hur stor andel av kodens strängvärden som faktiskt är skyddade. Ljust och mörkt tema, introduktion vid första besöket, ångra-remsa efter radering och en textarea i stället för Monaco på smal skärm.

**Inte levererat ännu:** datasets, sökvägsregler (`ProjectPathConfig` skrivs men läses aldrig) och diskintegration.

## Start

Kräver Node.js 24+ och pnpm. Beroenden låses i `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm preview --port 4173
```

Använd produktionsförhandsvisningen för säkerhetskontroller. Utvecklingsserverns HMR använder WebSocket och blockeras av den avsiktligt strikta CSP:n; sänk inte produktionspolicyn för att få HMR att fungera.

1. Klistra in kod, dra in en fil, eller välj den ofarliga exempelkoden. Språket gissas vid inklistring och följer filändelsen när du drar in en fil.
2. Byt språk i väljaren om gissningen blev fel — det är språket som avgör hur värden escapas.
3. Markera ett värde och tryck **Ctrl+B** (eller högerklick → Skapa binding). Ange exempelvis `ADMIN_USERNAME`, ditt riktiga värde och `example.user` som AI-värde.
4. Spara en version. Växla mellan **Mall**, **Local**, **AI** och kopiera rätt vy.
5. Redigera endast mallen. Varje sparning skapar en ny version; återgång skapar också en ny version.

`Ctrl+Enter` = Copy for AI. `Ctrl+Shift+Enter` = Copy Local. `Ctrl+P` öppnar Mina projekt. `Ctrl+S` sparar en version. `?` visar hela listan. De tidigare `Ctrl+Shift+C` och `Ctrl+K` togs av utvecklarverktygen respektive Firefox sökfält.

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

Verktyget är byggt för att minska oavsiktlig delning av privata värden, bevara dem när kod uppdateras samt stödja delbar export och återställning. Allt tre finns.

Det skyddar **inte** mot skadlig kod, keyloggers, annan användare på samma OS-konto, webbläsartillägg som kan läsa DOM/IndexedDB, diskforensik, manuellt skickade hemligheter eller en komprometterad GitHub Pages-app/supply chain.

**Urklippshistorik och molnsynkat urklipp ligger utanför appens kontroll.** Copy Local lägger riktiga värden i Windows/macOS/Linux-urklippet. Automatisk rensning efter en valbar tid finns i inställningarna, men den når bara själva urklippet, inte historiken.

**IndexedDB lagrar privata värden i klartext**, enligt specifikationen. Inget huvudlösenord. Rensad webbläsardata, annan profil eller annat origin kan göra valvet oåtkomligt — exportera en backup regelbundet. Exportfilerna innehåller också klartext; den privata varianten utelämnar projektkoden men inte värdena.

**Origin är viktigt:** `http://localhost:5173`, `http://127.0.0.1:4173` och `https://timpan8.github.io` har separata valv. Välj ett primärt origin. Repo-sökvägar på samma `user.github.io` delar däremot origin; separata databasnamn är bara namnisolering, ingen säkerhetsgräns mellan appar. Aktuellt origin visas i inställningarna. Ingen synk mellan datorer.

Appen redovisar vad den faktiskt kontrollerat och säger aldrig att säkerhet är garanterad. Före AI-kopiering blockeras saknade värden, osäkra renderingskontexter och exakta kända privata värden, och dialogen visar hur många av kodens strängvärden som är kopplade till bindings. Är inget kopplat sägs det rakt ut i stället för att beskedet låter godkännande. En heuristisk scanner letar dessutom efter värden som liknar hemligheter och varnar per träff, men heuristik hårdblockerar aldrig: falska positiva som inte går att kvittera leder till att verktyget kringgås. Okända och transformerade värden kan fortfarande förekomma. Escaping är konservativ textbearbetning och ersätter inte en fullständig språkparser.

**Blocklistan är en lista du själv fyller i, inte ett skydd som hittar termer åt dig.** Termer du lägger till byts mot en platshållare när text klistras in eller en fil öppnas — ordagrant, skiftlägesokänsligt och vid ordgräns. Den ser inte stavfel, förkortningar, sammansättningar eller en term som skrivs isär, och den rör inte text som redan ligger i arbetsytan när termen läggs till. Ersättningen visas och går att ångra i ett steg.

## Verifiering

`pnpm lint`, `pnpm test` och `pnpm test:e2e` körs i CI vid varje pull request. `pnpm test` kör Vitest, fake-indexeddb och fast-check; `pnpm test:e2e` kör Playwright mot produktionsbygget, eftersom flera fel bara syns med den riktiga editorn. Domänlogik saknar DOM-beroenden. Storage-kontraktet kan köras mot framtida providers med samma tester. Tester använder endast syntetiska värden.

`pnpm build` kontrollerar TypeScript strict, bygger alla lokala Monaco-resurser och granskar JavaScript-bundlen för nätverksanrop utanför service workern. CSP har `connect-src 'none'`. Kontrollerna är begränsade och är inte ett bevis på frånvaro av alla möjliga läckagevägar.

Arkitektur och tolkningar finns i [DECISIONS.md](DECISIONS.md). Tekniska referenser: [Vite production build](https://vite.dev/guide/build), [Monaco API](https://microsoft.github.io/monaco-editor/typedoc/index.html), [Dexie](https://dexie.org/docs/).
