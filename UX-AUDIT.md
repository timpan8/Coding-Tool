# UX-granskning — AI Code Vault

Granskad commit: `28e5eed` · körd mot produktionsförhandsvisningen på `http://127.0.0.1:4173`
(inte `pnpm dev` — repot dokumenterar att dev-serverns HMR blockeras av CSP:n).
**Ingen appkod är ändrad i den här granskningen.** Leveransen är det här dokumentet,
[DESIGN.md](DESIGN.md) och underlaget i `ux-audit/`.

---

## Sammanfattning

Appen är genomtänkt på de ställen där någon har suttit och tänkt: raderingsdialogen,
ångra-mekanismen, tokeniseringen av färg, `useConfirm()`, kommentarerna som förklarar *varför*.
Det som brister är sällan idéerna — det är att flera av dem inte når ända fram i det renderade
gränssnittet.

De sju allvarligaste fynden:

1. **AI-vyn påstår "SANERAD" över osanerad kod** (F-2.1). Den starkaste färgsignalen i editorn är
   ett friskintyg som inte är villkorat på att någonting faktiskt ersatts.
2. **`?` går inte att skriva i kodeditorn** (A.1). Tecknet öppnar genvägsmodalen i stället för att
   hamna i koden — Monaco 0.56 använder EditContext, så `typing`-vakten missar den.
3. **Monaco är en tangentbordsfälla** (A.2). Tab tar sig aldrig ut, den skriver in indrag.
   WCAG 2.1.2, nivå A.
4. **Startskärmens enda hjälpande knapp går inte att klicka** (F-1.1). `pointer-events: none`
   ärvs ner till "eller prova med exempelkod" — steg 1 i README:n är död yta.
5. **Versionshistoriken saknar alla sina handlingar under 1251 px** (F-D.1). Dragspelet öppnas och
   visar ingenting. Gäller varje telefon och varje surfplatta.
6. **Hela sidan scrollar i sidled vid 768 px** (F-0.1). Ett glapp mellan brytpunkterna 750 och 900.
7. **"Ofarligt här" tystar en säkerhetsvarning permanent** (F-2.7), utan bekräftelse och utan
   ångra — trots att `deleteDismissal` redan finns i lagringslagret utan en enda anropare.

Ett mönster går igen i flera av dem: **appen är byggd för desktop-Monaco, och det som händer
utanför den kombinationen är inte genomgånget.** Under 750 px byts editorn mot en textarea som tyst
tappar halva sitt kontrakt (F-D.4); under 1251 px försvinner versionshandlingarna (F-D.1); vid
768 px spiller layouten ut (F-0.1); och fem responsiva regler är döda av specificitetsskäl (F-D.2).

Prioriteringen följer användarpåverkan, inte hur lätt något är att fixa. Sex av de sju ovan är
S-insatser.

---

## Metod

**Fas 0** — läste README, `package.json`, routingen i `src/ui/App.tsx` och samtliga komponenter
under `src/ui/`.

**Fas 1** — det finns ingen Playwright-MCP eller Chrome-DevTools-MCP i den här sessionen. Däremot
ligger `@playwright/test` 1.56.1 som devDependency och Chromium finns installerat, så jag har drivit
en riktig webbläsare via egna skript i stället. **111 skärmdumpar** i `ux-audit/screens/`, namngivna
`<vy>--<bredd>.png` för 390, 768 och 1440 px, i ljust och mörkt tema. Utöver de lyckade
tillstånden: tomt valv, tomt sökresultat, laddning, långa strängar, 12 projekt, 9 versioner,
5 fynd, samtliga dialoger.

**Fas 2** — fyra parallella granskningar (IA/navigation, visuell hierarki, interaktion/tillstånd,
tillgänglighet). Varje fynd nedan är verifierat mot fil och rad, och de mekaniska påståendena är
mätta i den körande appen, inte uppskattade.

**Fas 3** — död yta spårad mekaniskt: varje interaktivt element klickat och jämfört före/efter,
plus `knip`, `ts-prune`, korsreferens av CSS-klasser mot JSX och av `StorageProvider`-metoder mot
anropare.

**Vad jag inte kunde testa:** ingen riktig skärmläsare (NVDA/VoiceOver) fanns tillgänglig — de
tillgänglighetsfynd som rör uppläsning är härledda ur DOM och ARIA, inte hörda. Ingen riktig
pekskärm; träffytor är uppmätta i px, inte testade med tumme. Ingen inloggning eller extern data
krävs av appen, så inget innehåll var oåtkomligt.

---

## Fynd per vy

Läsanvisning: **P0** = användaren fattar fel beslut eller tappar data · **P1** = uppgiften går inte
att slutföra, eller blir väsentligt svårare · **P2** = friktion, inkonsekvens, brus.
Insats: **S** ≈ under en halvdag · **M** ≈ en till tre dagar · **L** ≈ mer än så.

---

### 0. Tvärs över appen — topbar, navigation, responsivitet

#### F-0.1 · P0 · Hela dokumentet scrollar i sidled vid 768 px · **S**
`src/ui/styles.css:328` (`.topbar` saknar `flex-wrap`), brytpunkter på `src/ui/code-first.css:262`
och `:817` (750 px) samt `src/ui/styles.css:1124` (650 px).

Uppmätt på **varje** route: `document.scrollWidth` = **1122 px** i en 768 px-viewport.
`.profile-choice`, `.theme-choice` och `.save-state` sträcker sig till x=1122. Topbaren wrappar
först vid 750 px, så i spannet **751–~1000 px** kan den inte brytas och spiller ut ur viewporten.
768 px är iPad i porträtt.

Konsekvens: profilväljaren, temaväljaren och sparstatusen — appens enda kvitto på att utkastet
ligger säkert — ligger utanför skärmen tills användaren scrollar horisontellt, på alla sidor.

Skärm: `07-workspace-with-code--768.png` (notera "Pro…" avklippt till höger, och att "＋ Ny kod"
bryts till tre rader).

> **Förslag:** flytta `flex-wrap: wrap` från 750 px-frågan upp till `.topbar` som grundregel
> (`styles.css:328`), och ge `.top-navigation` `min-width: 0`. Då bryter baren när den behöver
> i stället för vid en gissad pixelgräns.

#### F-0.2 · P1 · Varumärkestexten skjuts 64 px åt höger mellan 751 och 900 px · **S**
`src/ui/styles.css:1082-1087`.

```css
.brand > span:last-child,
.rail-label,
.project-links,
.main-shell {
  margin-left: 64px;
}
```

Regeln ser ut som en `display: none`-grupp som tappat sin avsikt när den gamla sidoraden togs bort:
`.rail-label` och `.project-links` **finns inte längre i någon JSX** (se Död yta, F-D.6), och
`.main-shell` neutraliseras av `.code-first .main-shell { margin-left: 0 }` (`code-first.css:1-4`,
högre specificitet). Kvar blir en enda verkan: ordmärket "AI Code Vault" får 64 px vänstermarginal
och lossnar från sin ikon. Under 750 px döljs texten helt (`code-first.css:818`), så felet syns bara
i spannet däremellan.

Skärm: `07-workspace-with-code--768.png` — glappet mellan `</>` och ordmärket.

> **Förslag:** dela upp regeln. `.main-shell { margin-left: 64px }` för sig; ta bort
> `.brand > span:last-child`, `.rail-label` och `.project-links` ur selektorlistan.

#### F-0.3 · P1 · Vid 390 px är "Säkerhet" och "Inställningar" utanför skärmen utan att något visar det · **S**
`src/ui/code-first.css:823-826` (`.top-navigation { overflow-x: auto }`).

Uppmätt: nav-elementets `scrollWidth` 487 px mot `clientWidth` 358 px. "Säkerhet" (`right: 408`)
och "Inställningar" (`right: 503`) har båda `clippedByViewport: true`. Raden går att scrolla i
sidled men har varken toningskant, pil eller annan affordans — den ser ut som en komplett meny med
fyra val.

Skärm: `07-workspace-with-code--390.png` (raden slutar mitt i "Säke…").

> **Förslag:** behåll scrollen men lägg en toningsmask som visar att det finns mer:
> `.top-navigation { mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent) }`,
> och ta bort den när `scrollLeft` nått slutet. Alternativt, tillsammans med F-0.6, korta ner navet
> så det ryms.

#### F-0.4 · P1 · Ingen markering av aktuell sida — inte i navet, inte i fliktiteln · **S**
`src/ui/App.tsx:532` (nav-knapparna), `index.html:16` (titeln).

`grep -rn "aria-current" src/` ger en enda träff, och den sitter på filflikarna
(`src/ui/components/FileTabs.tsx:46`). Mätningen bekräftar: `aria-current` är `["script.ps1"]` på
**alla fem** routes. Nav-knapparna får varken klass eller ARIA-tillstånd, och `document.title` är
konstant `"AI Code Vault"` (ingen `document.title`-tilldelning finns i `src/`). Navraden är
pixelidentisk på `03-security--1440.png`, `04-settings--1440.png` och `25-bindings-list--1440.png`.

Följd: att klicka på den sida man redan står på är en tyst nullhandling — verifierat i
no-op-sonderingen (`NO-CHANGE` för "Bindings" på `#/bindings` och "Inställningar" på `#/settings`).

> **Förslag:** sätt `aria-current="page"` plus en `.current`-klass på den nav-knapp vars route
> matchar `route`, och skriv `document.title` i en effekt: `Alla projekt · AI Code Vault`,
> `<projektnamn> · AI Code Vault`.

#### F-0.5 · P1 · "Alla projekt" finns inte i navigationen — enda vägen dit går genom en modal · **S**
`src/ui/App.tsx:613` (enda `navigate('#/projects')` i hela UI:t), `src/ui/App.tsx:532` (navet).

`#/projects` är den enda platsen med sortering, språkfilter, statusfilter och versions-/
bindingsräknare per projekt (`App.tsx:598-603`). Lådan som är den enda vägen dit visar bara namn och
datum (`components/ProjectBrowser.tsx:18-20`). Sidan delar skal och eyebrow med `#/bindings` — den
är byggd som en fullvärdig destination — men bara "Bindings" finns i navet. Även feltexten pekar
mot lådan i stället för sidan (`src/ui/text.ts:51`).

> **Förslag:** låt nav-knappen "Mina projekt" navigera till `#/projects` och behåll Ctrl+P som
> snabbväxlaren till lådan.

#### F-0.6 · P2 · Navet blandar fyra sorters saker och prioriterar fusklappen framför riktiga sidor · **S**
`src/ui/App.tsx:532`.

De sex knapparna är: en **åtgärd** som skapar nytt projekt (`#/`), en **överläggsöppnare**
(Mina projekt), en **hjälpmodal** (Genvägar) och tre **routes** (Bindings, Säkerhet, Inställningar) —
utan visuell skillnad eller gruppering. Vid 390 px ryms "Genvägar" medan två riktiga sidor hamnar
utanför (F-0.3), och genvägsmodalen innehåller enbart tangentbordskommandon, som inte går att
använda på pekskärm (`29-shortcuts-modal--390.png`).

> **Förslag:** dela navet i routes till vänster och verktyg till höger (＋ Ny kod, Ctrl+P-sök,
> ?-hjälp som ikonknappar). Dölj hjälpknappen under 700 px.

#### F-0.7 · P2 · Kortkommandofunktionen har fyra olika namn · **S**
`src/ui/text.ts:24` ("Genvägar"), `:25` (aria-label "Visa kortkommandon"), `:166` (modaltitel
"Kortkommandon"), `src/ui/shortcuts.ts:19` ("Visa genvägar").

Användaren klickar "Genvägar" och möts av rubriken "Kortkommandon"
(`29-shortcuts-modal--390.png`). Eftersom `aria-label` ersätter knapptexten helt ingår det synliga
namnet inte i det tillgängliga namnet — röststyrning på "Genvägar" fungerar inte (WCAG 2.5.3
*Label in Name*).

> **Förslag:** ett ord på alla fyra ställen — "Kortkommandon" — och ta bort `aria-label` så den
> synliga texten blir det tillgängliga namnet.

#### F-0.8 · P2 · Svenska och engelska blandas inom samma kontrollgrupp · **S**
`src/ui/text.ts:251-257`, `:203`, `:288`, `:219`/`:230` mot `:299`.

Vyväxlaren heter "Mall" / "Local" / "AI"; åtgärderna bredvid heter "Klistra in från AI ↙",
"Copy Local", "Copy for AI ↗" och "Kopiera markering ↗". Samma fält kallas **Räckvidd** på
bindingsidan (`text.ts:219`) och **Scope** i bindingdialogen (`text.ts:299`) — se
`25-bindings-list--1440.png` mot `22-binding-dialog--1440.png`.

> **Förslag:** "Mall" / "Lokal" / "AI"; "Kopiera lokalt" / "Kopiera för AI ↗"; byt `text.ts:299`
> till "Räckvidd". Se även FRÅGA Q-1 om ordet "bindings".

#### F-0.9 · P2 · Notisremsan renderas överst i dokumentet och hamnar utanför bild · **S**
`src/ui/App.tsx:535` (`.persistence-error`), `:536` (`.clipboard-countdown`), `:537`
(`.inline-notice`).

Alla tre ligger som vanliga flödeselement i `.main-shell`, före `<main>`. Uppmätt vid 390 px: klick
på "Ofarligt här" vid `scrollY: 1238` gav notisen på `top: -1117` (`inViewport: false`);
`Ctrl+Shift+Enter` vid `scrollY: 560` gav avslaget på `top: -439`. Notisen självstänger aldrig
(kvar efter 12 s), så en gammal notis kan förväxlas med svaret på nästa handling.

Allvarligast: `.clipboard-countdown` innehåller **Avbryt**-knappen som är enda sättet att stoppa
urklippsrensningen — och den kan ligga helt utanför skärmen.

> **Förslag:** `position: sticky; top: 0; z-index: 45` på alla tre, eller flytta dem till samma
> fixerade plats längst ner som `.undo-bar` redan använder (`styles.css:717-733`). Låt `info`
> självstänga efter ~6 s; behåll `warn` tills den stängs.

#### F-0.10 · P1 · Kallstart på en okänd route ger en helt tom sida · **M**
`src/ui/App.tsx:108` (route sätts direkt från `location.hash`), `:169` (validering som bara körs i
`navigate()`), `:181`.

Verifierat: kallstart på `#/nonsens` ger `mainText: ""`, `visibleSections: 0` och 790 px tom yta —
inget fel, ingen omdirigering, och URL:en står kvar så att en omladdning återskapar samma läge.
Skärm: `33-unknown-route-cold--1440.png`.

Kallstart på ett raderat projekt-id är värre: felmodalen "Projektet finns inte längre" öppnas
**ovanpå** förstagångsguiden och blockerar dess knappar, med det döda id:t kvar i adressfältet.

> **Förslag:** kör samma validering vid kallstart som vid `hashchange`. Okänd route →
> `setLocation('#/projects', true)` med en notisremsa. Vid raderat projekt →
> `setLocation('#/', true)` **innan** felet visas, och visa inte felmodalen medan `intro` är öppen.

#### F-0.11 · P1 · Det finns ingen väg tillbaka till pågående projekt från Bindings, Säkerhet eller Inställningar · **M**
`src/ui/App.tsx:547` och `:599` (de enda två ställen som renderar "Tillbaka till pågående projekt").

Från `#/settings` finns **noll** vägar tillbaka till det öppna projektet i `<main>` — verifierat
genom att räkna alla synliga knappar och länkar. Och navets mest framträdande knapp, "＋ Ny kod",
gör tvärtom: `navigate('#/')` anropar `controller.newCode()` när man kommer från en annan route
(`App.tsx:167-168`), alltså stängs projektet. Detsamma gäller logotypen (`App.tsx:531`), som går
genom samma väg — den mest universella "hem"-affordansen som finns tömmer arbetsytan.

Ingen data går förlorad (`newCode()` gör `flush()` först), men kontexten gör det.

> **Förslag:** när `currentId` finns, låt logotypen gå till `#/project/${currentId}` och navets
> första knapp bära projektets namn, med "＋ Ny kod" som en separat, mindre framträdande knapp.

#### F-0.12 · P2 · Två snabba tryck på bakåtknappen sväljs · **M**
`src/ui/App.tsx:158-162`.

`navigate()` avbryter tidigt när en skrivning pågår, återställer URL:en och varnar. Eftersom
`hashchange`-hanteraren (`App.tsx:183`) går genom samma `navigate`, drabbar det även webbläsarens
bakåtknapp: två snabba tryck landar ett steg för kort. Meddelandet (`text.ts:40`) beskriver appens
tillstånd, inte användarens nästa handling.

> **Förslag:** köa den avvisade routen i en ref och kör den när `run()` släpper `busyRef`. Om det
> bedöms för invecklat: skriv om texten till "Sparar just nu. Tryck bakåt en gång till om ett
> ögonblick."

#### F-0.13 · P1 · `busy` är helt osynligt — arbetsytan blir `inert` utan att något förändras · **S**
`src/ui/App.tsx:144-150` (`run()`), `:543-544` (`aria-busy={busy}` / `inert={busy}`).

Det finns ingen CSS-regel någonstans som reagerar på `[inert]` eller `aria-busy`. Verifierat genom
att sätta `inert` manuellt på `.workspace` och jämföra `opacity`, `filter`, `cursor`, `color`,
`backgroundColor`, `borderColor` och `pointerEvents` på **alla 24 kontroller** inuti ytan: **noll
skillnader**. Under varje skrivning (skapa binding, öppna projekt, lägga till fil, radera, byta
profil) slutar editorn och panelerna reagera medan de ser helt normala ut.

> **Förslag:** `.workspace[inert] { opacity: .55; cursor: progress; transition: opacity .12s }`,
> plus byt `.save-state`-texten till `⟳ Arbetar…` (elementet har redan `role="status"`,
> `App.tsx:534`).

---

### 1. `#/` — Arbetsytan, tomt läge

#### F-1.1 · P0 · Startskärmens enda hjälpande knapp går inte att klicka · **S**
`src/ui/code-first.css:127-136` (`.paste-prompt { position: absolute; pointer-events: none }`),
knappen renderas inuti den på `src/ui/App.tsx:570`.

Mekaniskt verifierat, tre oberoende sätt:
- knappens beräknade `pointer-events` är `none` (ärvd),
- `document.elementFromPoint()` mitt på knappen returnerar Monacos `.view-lines`,
- ett Playwright-klick timeoutar, och även ett **framtvingat** klick lämnar editorn tom
  (`textlängd = 0` före och efter).

README:ns steg 1 lyder *"Klistra in kod, dra in en fil, eller välj den ofarliga exempelkoden."* —
det tredje alternativet är inte implementerat i praktiken. Knappen ärver dessutom `text-align:
center` i ett 260 px brett grid-spår och hamnar ~55 px till höger om raderna ovanför, så den läses
som en bildtext snarare än en knapp.

Skärm: `02-workspace-empty--1440.png`, `30-sample-button-blocked--1440.png`.

> **Förslag:**
> ```css
> .paste-prompt button {
>   pointer-events: auto; justify-self: start; text-align: left;
>   margin-top: 10px; padding: 8px 13px;
>   border: 1px solid var(--accent-border); border-radius: 6px;
>   color: var(--accent-text); background: var(--accent-surface);
> }
> ```

#### F-1.2 · P1 · Fem av fjorton knappar är inaktiverade på den allra första skärmen · **M**
`src/ui/App.tsx:547` (Spara version), `components/EditorToolbar.tsx:41` (Klistra in från AI),
`:45` (Copy Local), `:47` (Copy for AI), `components/BindingPanel.tsx:32` (＋ Ny).

Uppmätt i tomt läge: 14 knappar i `<main>`, varav **5 inaktiverade** — *Spara version, Klistra in
från AI ↙, Copy Local, Copy for AI ↗, ＋ Ny*. Av de 9 aktiva är tre vyflikar som visar tomhet, två
textstorleksknappar, en radbrytningsknapp, en filflik och en "lägg till fil". Den enda som faktiskt
hjälper någon i gång är den som inte går att klicka (F-1.1).

Med andra ord: på startskärmen finns ingen fungerande väg framåt utom att gissa att man ska skriva
i editorn. Ingen av de fem inaktiverade knapparna förklarar vad som saknas.

Skärm: `02-workspace-empty--1440.png`, `02b-workspace-empty-full--390.png`.

> **Förslag:** dölj `.copy-actions` och "Spara version" helt tills det finns text, i stället för att
> visa dem grå. Ersätt ytan med en enda tydlig uppmaning och den (fungerande) exempelknappen.
> Behåll språkväljaren.

#### F-1.3 · P2 · Inget laddningstillstånd — inklistringsprompten visas ovanpå en Monaco som inte är redo · **M**
`src/ui/App.tsx:228` (`saveStatus`), `:534` (`.save-state`), `:570` (`.paste-prompt`).

Uppmätt tidslinje efter sidladdning: vid **t=213 ms** finns `.editor-body` och texten "Klistra in
din kod här" medan `.monaco-editor` fortfarande saknas; Monaco dyker upp vid **t=526 ms**. Antal
skelett-, spinner- eller `role="progressbar"`-element vid varje mätpunkt: **0**. Enda signalen är
"Öppnar lokalt valv…" i 0,75 rem dämpad text uppe till höger.

> **Förslag:** rendera ett skelett (3–4 grå rader) i `.editor-body` medan `phase === 'loading'` i
> stället för `.paste-prompt`, och håll kopieringsknapparna inaktiverade. Ge `.save-state`
> `aria-live="polite"` och minst 0,8 rem i `--text`.

---

### 2. `#/project/:id` — Arbetsytan med öppet projekt

#### F-2.1 · P0 · "AI — SANERAD" i solid accentgrön ovanför osanerad kod · **S**
`src/ui/text.ts:72` (`bannerAi: '◇ AI — SANERAD'`), `src/ui/styles.css:608-611`
(`.mode-ai .view-banner { background: var(--accent); color: var(--accent-fg) }`).

Färgsystemet betyder annars grönt = säkert och tegelrött = farligt (`.mode-local` använder
`--danger-strong`, `styles.css:603-607`). Men banderollen är **inte villkorad på att någonting
faktiskt ersatts**. Med noll bindings är AI-projektionen byte-identisk med mallen, och den grönaste
ytan i hela editorn står då direkt ovanför `$adminPassword = "Hunter2-Very-Secret!"` och
`$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"`.

Skärm: **`09-view-ai--1440.png`** — det tydligaste enskilda beviset i hela granskningen.

Kopieringsdialogen säger visserligen ifrån efteråt (`CopyDialog.tsx:24-26`), men vyn som ska
kontrolleras visuellt har redan gett godkänt.

> **Förslag:** villkora banderollen på `ai.used.length`:
> `> 0` → `--accent` och texten `◇ AI — SANERAD · {n} värden ersatta`;
> `=== 0` → `background: var(--warn-surface); color: var(--warn-text)` och texten
> `◇ AI — INGET ERSATT ÄNNU`.

#### F-2.2 · P0 · Vyn har ingen primär handling, och den enda fyllda knappen är fel handling · **M**
`src/ui/App.tsx:547` (`.heading-actions`), `src/ui/components/EditorToolbar.tsx:47`,
`src/ui/styles.css:579-582` (`.copy-actions button`).

Uppmätta värden i den körande appen vid 1440 px:

| Kontroll | Storlek | Vikt | Yta |
|---|---|---|---|
| `Spara version` (`.primary`, fylld grön) | 14 px | 600 | 121×39 |
| `Copy for AI ↗` (tonad konturknapp) | **11,2 px** | 600 | **90×31** |
| Nav-etiketterna i topbaren | 12,8 px | 600 | 81×35 |

Produktens hela existensberättigande — att få ut kod som är trygg att ge till en AI — är alltså den
**minsta** kontrollen i sin egen vy, mindre än navigationsetiketterna. Bredvid den ligger
"Radera projekt" i rött i samma kluster som primärknappen.

Skärm: `07-workspace-with-code--1440.png`.

> **Förslag:** gör `Copy for AI` till vyns enda `.primary` (0.875 rem, `padding: 8px 13px`, samma
> som `button.primary` i `styles.css:215`). Degradera `Spara version` till konturknapp. Flytta
> "Om projektet" och "Radera projekt" in i projektdialogen.

#### F-2.3 · P1 · Högerpanelens rubriknivåer är inverterade, och friskrivningen är sidans största brödtext · **S**
`src/ui/styles.css:789-792` (`.panel-title h2` — bara `h2`), `src/ui/components/FindingsPanel.tsx:51`
(renderar `<h3>`), `:54-56`, `src/ui/styles.css:799` (`.binding-panel > .muted`).

`FindingsPanel` använder `<h3>` i samma `.panel-title` och faller därför igenom till globala
`h3 { font-size: 1rem }` (`styles.css:263`). Uppmätt: "Bindings" **13,6 px**, "Misstänkta värden"
**16 px** — panel två har 18 % större rubrik än panel ett. Samma genomfall på brödtexten: `.muted`
i `.findings-panel` träffas inte av `.binding-panel > .muted` och renderas på **16 px/400**, vilket
gör friskrivningen *"Förslag, inte fynd. Ingen av dem blockerar kopiering…"* till den största
brödtexten på hela skärmen. Fyndrubrikerna beräknas dessutom till **vikt 900** (`<b>` = `bolder`
inuti `button { font-weight: 600 }`), alltså tyngre än `h1`.

Skärm: `08-findings-panel--1440.png`.

> **Förslag:** `.panel-title h2, .panel-title h3 { font-size: 0.8125rem; margin: 0 }`;
> `.binding-panel .muted, .findings-panel .muted { font-size: 0.75rem }`;
> `.finding-head b { font-weight: 600 }`.

#### F-2.4 · P1 · Fem staplade paneler utan rangordning; hälften hamnar under viewporten · **M**
`src/ui/App.tsx:588-595`, `src/ui/code-first.css:110-114` och `:144-147`.

BindingPanel → IssuePanel → FindingsPanel → VersionPanel → `.m1-note` staplas i en 270 px-kolumn med
`max-height: calc(100vh - 245px); overflow: auto` och inget scrolltecken. Rubriknivåerna är
inkonsekventa: `<h2>` (`BindingPanel.tsx:30`), `<h3>` (`IssuePanel.tsx:44`), `<h3>`
(`FindingsPanel.tsx:51`), `<summary>` utan rubrik (`VersionPanel.tsx:43`). Med fem fynd på skärmen
fyller enbart "Misstänkta värden" resten av kolumnen, och "Sparade versioner" ligger utanför utan
att något antyder det. Vid 390 px börjar "Misstänkta värden" först runt y≈1000 av 2145 px.

> **Förslag:** gör kolumnen till ett dragspel av `<details>` med räknaren i `<summary>` — samma
> mönster som `.version-history` redan använder (`code-first.css:148-160`). Bindings öppen som
> standard, övriga hopfällda. Ge alla paneler samma rubriknivå.

#### F-2.5 · P1 · "Ersätt mallen" skriver över hela utkastet utan bekräftelse och utan ångra · **S**
`src/ui/App.tsx:651-654`, `src/ui/components/IngestDialog.tsx:74-76`.

Verifierat: editorn gick från deploy-skriptet till helt annan kod på ett klick; ingen `UndoBar`
visades. `offerUndo` används på exakt tre ställen — radera version (`App.tsx:244`), radera projekt
(`:267`), radera binding (`:422`) — och inte här. Eftersom `controller.changeText` triggar autospar
500 ms senare (`WorkspaceController.ts:71`) är originaltexten borta om ingen version råkade vara
sparad. Knappen är dessutom aktiv så snart textrutan innehåller något, även när noll bindings
matchade.

> **Förslag:** fånga `template` före `changeText(next)` och anropa
> `offerUndo({ label: 'Mallen är ersatt.', restore: () => controller.changeText(before) })` — exakt
> samma mönster som de tre raderingarna. Vid `applied === 0`, byt etikett till
> "Ersätt ändå (0 värden återställda)".

#### F-2.6 · P1 · Radera fil kastar osparad text utan ångra, och bekräftelsen lovar en väg tillbaka som ofta inte finns · **M**
`src/ui/App.tsx:556-563`, texten i `src/ui/text.ts:137`.

Verifierat: ny fil, text skriven, autospar inväntat, flik stängd → ingen UndoBar, ingen notis.
Bekräftelsen påstår *"Sparade versioner behåller sin kopia, så den går att få tillbaka därifrån."*
— men det fanns aldrig någon sparad version. Påståendet är falskt i precis det fall där det spelar
roll. Filradering är den enda destruktiva handlingen i arbetsytan utan `offerUndo`.

> **Förslag:** fånga `{file, text: session.texts[id]}` före `controller.removeFile(id)` och lägg
> till `offerUndo`. Visa raden om sparade versioner bara när filen faktiskt finns i en version.

#### F-2.7 · P1 · "Ofarligt här" är permanent, obekräftat och utan väg tillbaka i UI:t · **M**
`src/ui/App.tsx:288-295`, `src/ui/components/FindingsPanel.tsx:71-73`.

Ett klick på en **68×21 px** knapp skriver en `ScanDismissal` till IndexedDB. Fyndet försvinner ur
panelen *och ur kopieringsdialogen* (`App.tsx:220` filtrerar på `dismissed`) för alltid i det
projektet. Ingen bekräftelse, ingen ångra, och notisen som bekräftar det kan ligga utanför bild
(F-0.9).

`deleteDismissal` **finns** i lagret (`src/storage/StorageProvider.ts:47`,
`src/storage/IndexedDbProvider.ts:174`) men anropas inte från en enda rad i `src/` — se F-D.5.

> **Förslag:** koppla in den befintliga ångra-mekanismen:
> `offerUndo({ label: \`${finding.ruleName} avfärdad.\`, restore: () => storage.deleteDismissal(...) })`.
> Lägg dessutom `<details>Avfärdade i det här projektet (N)</details>` längst ner i FindingsPanel
> med "Ta tillbaka" per rad.

#### F-2.8 · P2 · På smal skärm försvinner både substitutionsmarkeringar och bindingnavigering · **M**
`src/ui/editor/Editor.tsx:12` och `:29` (under 750 px används `PlainEditor`),
`src/ui/editor/PlainEditor.tsx:11`.

`PlainEditor` tar emot **10 av `EditorProps`20 fält**. Den ignorerar `substitutions`, `focusName`,
`onFocused`, `onPlaceholder`, `describePlaceholder`, `placeholderNames`, `language`, `theme`,
`documentKey` och `active`.

Uppmätt konsekvens, samma projekt och samma binding:

| | 390 px (textarea) | 1440 px (Monaco) |
|---|---|---|
| Markeringar i AI-vyn | **0** | 1 |
| Klick på bindingnamn i panelen | markering oförändrad `[138,138]`, inget händer | hoppar till platsen |

Alltså: på telefon kan man inte se vilka värden som ersatts — själva kvittot på att verktyget gjort
sitt jobb — och bindingnamnet i panelen är en no-op utöver att byta läge.

Textarea-valet i sig är väl motiverat i koden (`Editor.tsx:27-28`) och bör behållas. Det som saknas
är ersättningarna för det Monaco gav.

> **Förslag:** rendera substitutionerna som en läsbar lista under editorn när `PlainEditor` är
> aktiv ("4 värden ersatta: DB_HOST rad 3, API_KEY rad 5 …"), och låt `focusName` mappa till
> `focusLine` så att klick på ett bindingnamn åtminstone scrollar till rätt rad.

#### F-2.9 · P2 · `.m1-note` — texten är produktionstext, inramningen är utvecklaranteckning · **S**
`src/ui/App.tsx:595`, `src/ui/text.ts:168-169`, `src/ui/styles.css:877-887`.

Innehållet är riktig produktionstext (den ligger i `text.ts` bland de andra svenska strängarna och
speglar Säkerhetssidans "skyddar inte mot"-lista). Men inramningen är läckt utvecklarkontext:
klassnamnet är en milstolpsmarkör ("M1"), rubriken "Vad som ännu inte finns" är en
roadmap-formulering, och blocket är permanent möbel längst ner i högerkolumnen — även i tomt läge,
där det är ett av bara tre synliga block.

Skärm: `02-workspace-empty--1440.png`.

> **Förslag:** flytta innehållet till `#/security` där de andra begränsningarna redan står, eller
> behåll det i panelen som hopfällt `<details><summary>Begränsningar</summary>`. Döp om klassen
> till `.panel-limits`.

---

### 3. `#/projects` — Alla projekt

#### F-3.1 · P1 · En tredjedel av korthöjden bär noll information · **M**
`src/ui/components/ProjectsPage.tsx:140-141`, `:156`, `:160`, `src/ui/styles.css:442-448`,
`:466-469`.

Uppmätt på ett 245 px högt kort: `.code-glyph` (konstanten `{ }`, identisk på alla kort) och
`.language-pill` upptar y=23–60, medan **projektnamnet — det enda som skiljer korten åt — börjar
först på y=82**. Under namnet: "1 fil", "0 versioner", "0 bindings", statustaggen "Experiment",
tidsstämpel och "Öppna →" — sex fält till, varav fem är identiska på samtliga kort. Accentfärgen
förekommer tre gånger per kort, alltså **36 accentmarkeringar** på en sida vars enda riktiga
primärknapp är "＋ Ny kod".

Skärm: `20-projects-many--1440.png` — tolv kort som bara går att skilja åt på namnet, och namnet är
inte det som drar blicken.

> **Förslag:** ta bort `.code-glyph` och per-kort-"Öppna →" (hela kortet är redan en `<button>`,
> `ProjectsPage.tsx:138`); flytta språket in i metaraden; ersätt "0 versioner 0 bindings" med
> "Inga versioner än" när båda är noll; rendera statustaggen bara när statusen inte är standard.

#### F-3.2 · P2 · Filterraden visas innan det finns något att filtrera, och tomt resultat saknar väg vidare · **S**
`src/ui/App.tsx:600` (`<ProjectFilters>` renderas villkorslöst), `:602`,
`src/ui/code-first.css:208-212`.

Med noll projekt visar sidan ett fullbrett sökfält, tre `<select>` och "0 projekt" ovanför en enda
grå mening (`05-projects-empty--1440.png`). Vid noll träffar saknas dessutom ett sätt att komma
tillbaka — ingen "Rensa sökning" bredvid "Inga projekt matchar sökningen"
(`28-projects-no-match--1440.png`).

> **Förslag:** rendera `ProjectFilters` bara när `projects.length > 6`. Ge `.empty-project-list` en
> rubrik, en mening och **en** knapp: "＋ Ny kod" när valvet är tomt, "Rensa sökning" vid no-match.

#### F-3.3 · P2 · Sökningen i projektlådan kastas bort på vägen till "Alla projekt" · **S**
`src/ui/App.tsx:110` (två oberoende söktillstånd), `:600` och `:613`.

Verifierat: sökte "MITT" i lådan (1 träff), klickade "Visa alla projekt →", och sidans sökfält var
tomt. Användaren har just sagt vad hon letar efter och får börja om.

> **Förslag:** `overview={() => { setQuery(drawerQuery); void navigate('#/projects'); }}`.

---

### 4. `#/bindings`

#### F-4.1 · P2 · Redigera och radera har samma visuella vikt i tabellen · **S**
`src/ui/components/BindingsPage.tsx` (åtgärdskolumnen), `src/ui/styles.css:853` (`.text-button`).

"Redigera DB_HOST" och "Radera DB_HOST" renderas som två likadana textknappar bredvid varandra,
skilda bara av färgen på den senare (`25-bindings-list--1440.png`). Raderingen är visserligen
skyddad av `useConfirm()` (`App.tsx:405`), men i listan finns ingen skillnad i vikt mellan en
oskyldig och en destruktiv handling.

> **Förslag:** flytta radera till slutet av raden med ett tydligt avstånd, eller bakom en
> `<details>`-meny per rad. Behåll bekräftelsen.

*(För övrigt är den här vyn den mest välfungerande i appen: riktig tabell med `<th>`, förklarande
ledtext, och kolumnen "Används i" som svarar på den fråga sidan finns för.)*

---

### 5. `#/settings`

#### F-5.1 · P1 · "Spara inställningar" sparar bara ett av sju fält · **S**
`src/ui/components/SettingsPage.tsx:87`, etiketten i `src/ui/text.ts:209`.

Knappen heter **"Spara inställningar"** men anropar `save({ deviceName })` — enbart enhetsnamnet.
Allt annat på sidan sparar direkt när det ändras: kryssrutan (`SettingsPage.tsx:63-64`),
textrutan (`:69-70`, på `onBlur`) och urklippsväljaren (`:75-76`).

Följden är omvänd mot vad etiketten lovar: den som ändrar urklippstiden och *inte* trycker Spara är
räddad, medan den som skriver ett enhetsnamn och navigerar bort tappar det.

> **Förslag:** byt etiketten till "Spara enhetsnamn" och flytta knappen intill fältet — eller låt
> fältet spara på `onBlur` som textrutan bredvid och ta bort knappen helt.

#### F-5.2 · P2 · Tre fyllda knappar och tre gula varningsrutor på samma sida · **M**
`src/ui/components/SettingsPage.tsx:87`, `src/ui/components/BackupPanel.tsx:121` och `:169`.

Uppmätt: två `.primary` ("Spara inställningar", "Exportera hela valvet") och en `.danger`
("Rensa hela valvet") samtidigt synliga, plus tre varningsblock. Gult tre gånger på samma sida
slutar betyda "titta här".

Besläktat: `label { font-weight: 600 }` (`styles.css:238-243`) och `small` utan viktåterställning
gör att varje hjälptext inuti en `<label>` renderas **fetare** än fältetiketten den förklarar.

Skärm: `04b-settings-full--1440.png`.

> **Förslag:** `label small { display: block; margin-top: 4px; font-weight: 400; color:
> var(--text-muted) }`. Högst en `.primary` per sektion — gör båda exportknapparna till
> konturknappar och behåll `.danger` på Rensa.

#### F-5.3 · P1 · Import kan skriva över poster utan bekräftelse, bakom en knapp som säger "Slå ihop" · **M**
`src/ui/components/BackupPanel.tsx:194-198` (valet), `:71-74` (tillämpningen), `:203-205` (knappen).

Verifierat: en exportfil redigerades så att samma projekt-id fick nytt namn och nyare tidsstämpel.
Planen visade "0 nya, 2 krockar, 0 redan identiska" med alternativen *duplicate / keep / replace*.
Med **replace** valt och knappen **"Slå ihop med valvet"** tryckt: ingen extra bekräftelse, resultat
"0 tillagda · **2 ersatta** · 0 som kopior · 0 orörda", ingen UndoBar. Två poster överskrivna
oåterkalleligt med ett klick, under en knapp som lovar sammanslagning.

Jämför "Rensa hela valvet" på samma sida, som kräver att man skriver `RENSA`
(`BackupPanel.tsx:84-101`).

> **Förslag:** när `resolution === 'replace'` och det finns krockar, kör `apply()` genom
> `confirm({ danger: true, typeToConfirm: 'ERSÄTT' })` och räkna upp vad som skrivs över. Låt
> knappetiketten följa valet: "Ersätt N poster med filens version".

---

### 6. `#/security`

#### F-6.1 · P1 · Dokumentet har toppnivåplats, kontrollerna är begravda · **M**
`src/ui/pages/Security.tsx` (12 rader ren brödtext, noll kontroller och noll länkar),
`src/ui/App.tsx:607-610`.

`#/security` har samma nav-vikt som "Inställningar" men innehåller inget att göra. Samtidigt ligger
alla faktiska säkerhetsåtgärder på `#/settings`: granskningsreglerna
(`components/RulesPanel.tsx:53`), backup/export (`components/BackupPanel.tsx:120`), återställ
(`:133`) och "Rensa hela valvet" (`:164`). Säkerhetssidan säger till och med *"Exportera valvet från
inställningarna"* (`Security.tsx:10`) utan att länka dit.

> **Förslag:** flytta "Granskningsregler" och "Backup / Återställ / Rensa" till `#/security` under
> egna rubriker, så sidan blir "Säkerhet och data" med både förklaring och reglage. Låt
> `#/settings` behålla enhetsnamn, AI-instruktion, urklippsrensning och tema.

---

### 7. Dialoger och överlägg

#### F-7.1 · P1 · Granskningsdialogen öppnas redan nedscrollad förbi sin egen varning · **S**
`src/ui/components/Modal.tsx:10-12`, `src/ui/components/CopyDialog.tsx:79-82`,
`src/ui/styles.css:967-968`.

`Modal` fokuserar första `[autofocus]`, annars första `input, select, textarea`. I CopyDialog är det
bekräftelsekryssrutan **längst ner** — och fokuseringen scrollar `<dialog>`, som har
`max-height: 90vh; overflow: auto`.

Uppmätt vid 390 px med fyra fynd: `scrollTop: 269`, och rubriken **"4 misstänkta värden hittades"**
låg på `top: -120`, alltså utscrollad ur dialogen innan användaren sett den. Det första man ser är
kryssrutan "Jag har tittat på de N misstänkta värdena" — inte värdena.

> **Förslag:** i `Modal`, autofokusera bara element som uttryckligen är märkta `[autofocus]`
> (SaveVersionDialog, BindingDialog och ConfirmDialog har redan det) och sätt `dialog.scrollTop = 0`
> efter `showModal()`. Gör bekräftelserutan och `.dialog-actions` `position: sticky; bottom: 0`.

#### F-7.2 · P1 · Enter i kopieringsdialogen stänger den tyst — omöjligt att skilja från lyckad kopiering · **S**
`src/ui/components/Modal.tsx:10` och `:15`.

När AI-dialogen saknar bekräftelseruta (inga critical/high-fynd, `CopyDialog.tsx:70`) finns inget
`input` alls, så fokus hamnar på `×` i dialoghuvudet och Enter stänger dialogen. Verifierat: efter
Enter är `dialogStillOpen: 0`, `notice: null`, `clipboard: ""` — ingenting kopierades och ingenting
sades. Eftersom en *lyckad* kopiering bara ger notisremsan (som kan ligga utanför bild, F-0.9) ser
utfallen likadana ut. Med critical-fynd gör Enter i stället ingenting alls — beteendet är alltså
också inkonsekvent.

> **Förslag:** sätt `autoFocus` på "Avbryt" i CopyDialog och lägg `×` sist i tabbordningen. Visa
> alltid en notis när dialogen stängs utan kopiering.

#### F-7.3 · P1 · Rubriken räknar två, listan visar fem · **S**
`src/ui/components/CopyDialog.tsx:9-17` (rubriken använder `serious.length`), `:27-36` (listan
renderar alla `findings`), `:81` (kryssrutan använder `seriousFindings`).

I `10-copy-dialog-ai--1440.png` står **"2 misstänkta värden hittades"** ovanför en lista med **fem**
rader, och kryssrutan under säger "Jag har tittat på de **2** misstänkta värdena". Rubriken räknar
bara critical + high; listan visar allt. I det ögonblick användaren ska avgöra om koden är säker att
dela motsäger dialogen sig själv.

> **Förslag:** låt rubriken räkna samma mängd som listan visar, och ange allvarlighetsgraden
> separat: "5 misstänkta värden hittades, varav 2 allvarliga".

#### F-7.4 · P2 · Två orubricerade punktlistor — den ena maskad, den andra i klartext · **S**
`src/ui/components/CopyDialog.tsx:27-36` och `:37-44`.

Första listan visar `sq••••••••••••om` och `sk••••••••••••dc`. Andra listan visar samma sorts värden
**i klartext**: `Hunter2-Very-Secret!`, `sk-live-4eC39HqLyjWDarjtT1zdp7dc`. Det finns ingen rubrik
mellan dem som förklarar vad som skiljer dem åt.

Att visa exakt vad som kommer att skickas är rimligt. Att i samma dialog maskera samma värde tre
rader ovanför är det inte — maskningen ser då ut som en säkerhetsåtgärd som inte hålls.

Skärm: `10-copy-dialog-ai--1440.png`.

> **Förslag:** ge listorna var sin `<h3>`: "Misstänkta värden som mönstren hittade" respektive
> "Strängar utan binding — de skickas som de står". Använd samma maskningspolicy i båda, med en
> "Visa"-knapp.

#### F-7.5 · P2 · BindingDialog validerar först vid submit, och felet står kvar när det är åtgärdat · **M**
`src/ui/components/BindingDialog.tsx:19-25` (`submit`), `:28` (namnfältet), `:44` (felraden), `:45`
(knappen, `disabled={busy}` — aldrig på grund av valideringsfel).

Namnfältet har varken `required`, `pattern`, `aria-invalid` eller `aria-describedby`. Vid submit med
ogiltigt namn visas felet, men fokus stannar på knappen och fältet markeras inte — och **när det
giltiga namnet väl fyllts i står felmeddelandet kvar** tills man klickar Spara igen. Dubblettnamn
(`src/domain/bindings/index.ts:14`) ger ingen återkoppling alls medan man skriver.

Se `35-long-strings--1440.png`: felraden "Namn måste vara 2–64 tecken…" står i rött medan
"Spara binding" ser fullt aktiv ut, och felet ligger ~560 px under fältet det gäller.

> **Förslag:** kör `validateBinding` i en `useMemo` på `value`; rensa `error` i `setValue`; sätt
> `aria-invalid` + `aria-describedby` på namnfältet; visa dubblettvarningen inline direkt; fokusera
> första ogiltiga fält vid submit.

#### F-7.6 · P2 · Radera profil saknar ångra och utlöses av ett omärkt `×` · **S**
`src/ui/App.tsx:662-668`, `src/ui/components/ProfilePicker.tsx:80`.

Raderingen bekräftas ("N bindings har ett eget värde för den här profilen. De värdena raderas") men
har inget `typeToConfirm` och ingen `offerUndo` — till skillnad från projekt, version och binding.
Värdena kan ha varit de enda lagrade lösenorden för en miljö. Utlösaren är ett ensamt `×`, samma
tecken som betyder "stäng" i dialoghuvudet och i notisremsan.

> **Förslag:** fånga profilen och alla `binding.values[profile.id]` före `deleteProfile` och lägg
> till `offerUndo`. Byt `×` mot en textknapp "Ta bort" med `danger-text`.

#### F-7.7 · P2 · Profilhanteraren göms som ett alternativ inuti en `<select>` · **S**
`src/ui/components/ProfilePicker.tsx:23`.

```js
onChange={e => e.target.value === '__manage__' ? onManage() : onSelect(e.target.value || null)}
```

Ett `<option>` som är en handling snarare än ett värde. Att välja det öppnar en modal och lämnar
select-elementet i ett läge som inte motsvarar något valt värde. Skärmläsare annonserar det som ett
alternativ bland profilerna.

> **Förslag:** flytta "Hantera profiler…" till en egen liten knapp bredvid väljaren.

#### F-7.8 · P2 · Kortkommandon utlöses medan markören står i ett textfält, och Ctrl+S är en tyst nullhandling · **S**
`src/ui/App.tsx:518-526` — `typing` beräknas på rad 520 men används bara på rad 521 (`help`).

`projects`, `copyAi`, `copyLocal` och `save` kör `e.preventDefault()` villkorslöst. Verifierat: med
markören i enhetsnamnfältet på Inställningar gav `Ctrl+Enter` notisen "Öppna en fil först…" och
`Ctrl+P` öppnade projektlådan medan webbläsarens utskriftsdialog blockerades. `Ctrl+S` på tom
arbetsyta utan projekt ger **ingenting alls** — `preventDefault()` körs på rad 525 *före*
`if (project && template.trim())`, så webbläsarens spara-dialog blockeras och ingen ersättning ges.

Besläktat: i `ConfirmDialog` gör Enter i RADERA-fältet ingenting (`ConfirmDialog.tsx:51-58`), trots
att versionsetikett, profilnamn och projektnamn alla submittar på Enter.

> **Förslag:** flytta `typing`-vakten till alla fem, men undanta Monaco (vars inmatningsyta är en
> `<textarea>`): `!target.closest('.monaco-editor')`. När `save` inte kan köras, anropa `warn()` i
> stället för att svälja tangenten. Lägg Enter→bekräfta i ConfirmDialogs `typeToConfirm`-fält när
> `ready`.

#### F-7.9 · P2 · Projektlådan klistrar sig mot vänsterkanten · **S**
`src/ui/code-first.css:214-224` (`right: 24px`).

Lådan renderas uppmätt på `x=0` — webbläsarens `dialog { left: 0 }` vinner när bredd och `margin: 0`
är satta, så `right: 24px` får ingen verkan. Lådan tappar därmed kopplingen till knappen som öppnade
den uppe till höger. Skärm: `12-project-drawer--1440.png`.

> **Förslag:** lägg till `left: auto` i `.project-drawer`.

---

## Tillgänglighet (WCAG 2.1 / 2.2 AA)

### A.0 Axe-utfall — redovisat separat från den manuella analysen

`@axe-core/playwright` med taggarna `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`,
`.monaco-editor` exkluderad (samma uppsättning som `e2e/accessibility.spec.ts`). **26 skannade
tillstånd:** alla sex routes, vyflikarna Mall/Local/AI, samtliga dialoger, projektlådan och
inställningarna med alla `<details>` öppna — i **både ljust och mörkt tema**, på 1440 och 390 px.

**Överträdelser: 1 regel, 1 nod.**

| Regel | Impact | Var | Detalj |
|---|---|---|---|
| `color-contrast` | serious | **mörkt tema**, `#/settings` | `button.danger` ("Rensa hela valvet"): `#04140f` på `#c05a3c` = **4,28:1**, 14 px normal vikt. Krav 4,5:1. |

Noll överträdelser av `aria-*`, `button-name`, `label`, `link-name`, `landmark-*`, `heading-order`,
`region`, `html-has-lang`, `duplicate-id`, `tabindex`, `aria-dialog-name`.

**Incomplete (7–9 noder per arbetsytetillstånd):** samtliga har samma orsak — axe kan inte avgöra
bakgrundsfärgen eftersom Monacos overlay-lager ligger ovanpå. Manuellt uppmätta med
`getComputedStyle` + alfakomposition ligger de på 4,5–6,2:1 i ljust och 5,6–7,5:1 i mörkt.
**Inga verkliga fel.**

Att den befintliga sviten i `e2e/accessibility.spec.ts` går grön är alltså korrekt — men den kör
bara i ljust tema, på en desktopviewport, och testar sex sidor i vila. **Allt nedan utom A.10 ligger
utanför vad axe mäter.** Det starkaste enskilda tillskottet vore att köra den befintliga sviten även
i mörkt tema och vid 390 px.

### A.1 · P0 · `?` öppnar genvägsmodalen mitt i koden, och tecknet försvinner · **S**
`src/ui/App.tsx:520` (`typing` testar bara `/^(INPUT|TEXTAREA)$/`), `:521`,
`src/ui/shortcuts.ts:19` och `:48`.

Monaco 0.56 använder **EditContext**, inte en `<textarea>` — fokus ligger på
`div.native-edit-context`. `typing`-vakten blir därför alltid `false` i kodeditorn.

Verifierat av mig direkt i den körande appen:

```
fokus i editorn: DIV.native-edit-context
efter att ha skrivit "?": { dialogOpen: 1, dialogLabel: "Kortkommandon", code: "$x = 1" }
```

Tecknet nådde alltså **aldrig** koden. `?` är vanligt i PowerShell (`?:`), regex, query-strängar och
ternärer. På 390 px, där `PlainEditor` (en riktig `<textarea>`) används, fungerar det korrekt — felet
gäller alla desktopanvändare.

Två fel i ett: en trasig inmatning i en kodeditor, och en **enteckensgenväg registrerad globalt på
`window` utan möjlighet att stänga av eller koppla om — WCAG 2.1.4 Character Key Shortcuts (nivå A)**.
För skärmläsaranvändare är det värre: NVDA/JAWS i fokusläge skickar vidare `?`, som då rycker fokus
till en modal.

> **Förslag:** utöka vakten till redigerbara ytor, inte bara taggnamn:
> ```ts
> const el = e.target instanceof HTMLElement ? e.target : null;
> const typing = !!el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable
>   || !!el.closest('.monaco-editor, [role="textbox"], .plain-editor'));
> ```
> Ta helst bort `'?'` ur `shortcuts.ts:19` helt och behåll `Ctrl+/`. Enteckensgenvägen ger inget som
> `Ctrl+/` inte redan ger, och SC 2.1.4 kräver annars en av/på-inställning.

### A.2 · P0 · Monaco är en tangentbordsfälla — Tab tar sig aldrig ut och skriver in indrag · **S**
`src/ui/editor/CodeEditor.tsx:80-85` (`monaco.editor.create(...)`, ingen `tabFocusMode`).

Verifierat av mig: klick i koden, sedan tre Tab i rad.

```
fokus före 3×Tab: native-edit-context
efter:            { el: "native-edit-context", code: "$x = 1          " }
```

Fokus lämnar aldrig editorn, och varje Tab skjuter in indrag. En tangentbordsanvändare som tabbar in
kommer inte ut igen utan att känna till Monacos odokumenterade `Ctrl+M`. **WCAG 2.1.2 No Keyboard
Trap (nivå A)** — den enda överträdelsen på nivå A som är helt blockerande.

Det är delvis Monacos beteende, men appen kan styra det: `tabFocusMode` är en skrivbar option i den
installerade versionen (`node_modules/monaco-editor/monaco.d.ts:4273`). `PlainEditor` (≤750 px och
Suspense-fallback) har ingen fälla — Tab går vidare korrekt.

> **Förslag:** sätt `tabFocusMode: true` i `create()`-optionerna på `CodeEditor.tsx:80`. Vill man
> behålla Tab som indrag: lägg i stället till en Escape-hanterare som flyttar fokus vidare, och
> lista både `Esc` och `Ctrl+M` i `editorShortcuts` (`src/ui/shortcuts.ts:26-31`) — i dag nämns
> ingen av dem, så utvägen är osynlig.

### A.3 · P1 · Fokus återförs aldrig när en dialog stängs · **S**
`src/ui/components/Modal.tsx:5-13`, samma mönster i `src/ui/components/ProjectBrowser.tsx:13`.

`Modal` öppnar med `showModal()` men anropar aldrig `close()` — React avmonterar `<dialog>` i
stället. Webbläsarens automatiska fokusåterställning hänger på `close()`, så fokus hamnar på
`<body>`.

| Dialog | Fokus före | Fokus efter Escape |
|---|---|---|
| Kortkommandon | `button "Visa kortkommandon"` | `body` |
| Projektlådan | `button "Mina projekt"` | `body` |
| Copy for AI | `button.ai-copy` | `body` |

Den som stänger kopieringsdialogen måste tabba genom 32 stopp för att komma tillbaka till knappen
hen tryckte på. **WCAG 2.4.3 Focus Order.**

Relaterat: `<main id="huvudinnehall">` (`src/ui/App.tsx:543`) saknar `tabIndex={-1}`. Hopplänken
fungerar i Chrome tack vare "sequential focus navigation starting point", men i Firefox och Safari
flyttas fokus inte alls.

> **Förslag:** spara `document.activeElement` före `showModal()` och återställ i effektens cleanup:
> ```ts
> return () => { dialog?.close(); opener?.focus?.(); };
> ```
> Samma tillägg i `ProjectBrowser`. Lägg `tabIndex={-1}` på `<main>`.

### A.4 · P1 · `inert` under busy kastar bort fokus och lämnar det på `<body>` · **S**
`src/ui/App.tsx:544` (`inert={busy}`), `busy` sätts i `run()` på `:145-149`. Se även F-0.13.

Uppmätt: fokusera `＋` (Lägg till fil) och tryck Enter.

```
före:            button "Lägg till fil"
t+120 ms:        body           inert=true,  aria-busy=true
efter skrivning: body           inert=false, aria-busy=false
```

`inert` tar bort fokus från fokuserade ättlingar direkt, och ingenting lägger tillbaka det. Det
gäller varje `run()`-inpackad åtgärd i arbetsytan. **WCAG 2.4.3.**

`inert` är rätt verktyg — kommentaren på `App.tsx:539-542` visar att det medvetet smalnades av från
`<main>` till `.workspace`. Det som saknas är bara att parkera och lämna tillbaka fokus.

> **Förslag:** spara `document.activeElement` före `setBusy(true)` och gör `saved?.focus()` i
> `finally`, via `requestAnimationFrame` så att `inert` hunnit tas bort.

### A.5 · P1 · Fokusmarkeringen saknas helt i editorn på mobil, och når inte 3:1 i ljust tema · **S**
`src/ui/code-first.css:813-815` (`.plain-editor:focus { outline: 0 }`), `src/ui/styles.css:208-213`,
`--focus-ring` på `:20` (ljust) och `:85`/`:138` (mörkt).

**Del A — ingen indikator alls.** Vid 390 px med `textarea.plain-editor` fokuserad: `outline: 0px
none`, `boxShadow: none`, `borderTopWidth: 0px`. Noll synlig fokusmarkering på appens huvudsakliga
redigeringsyta på mobil — och `PlainEditor` är också Suspense-fallback på desktop medan Monaco
laddas. **WCAG 2.4.7 Focus Visible.**

**Del B — för låg kontrast på ringen.**

| Tema | Ring mot | Uppmätt | Krav |
|---|---|---|---|
| Ljust | `--bg #f3f6f9` | **2,08:1** | 3:1 |
| Ljust | `--surface #ffffff` (topbar, kort, dialoger) | **2,26:1** | 3:1 |
| Ljust | `--surface-sunken #f0f4f7` (flikremsan) | **2,04:1** | 3:1 |
| Mörkt | `--bg #0e1a24` | 9,17:1 | ok |
| Mörkt | `--accent #1c9078` (primärknapp) | **2,06:1** | 3:1 |
| Mörkt | `--danger #c05a3c` | **2,29:1** | 3:1 |

`outline-offset: 2px` gör att ringen till största delen ligger på den omgivande ytan, så ljust tema
faller på i stort sett varje kontroll. **WCAG 1.4.11 Non-text Contrast.**

> **Förslag:** ge `--focus-ring` ett mörkare värde i ljust tema, t.ex. `#0b6f92` (5,15:1 mot `--bg`,
> 5,61:1 mot `--surface`, 3,1:1 mot `--accent`). Lägg till en mellanrand så ringen får kontrast åt
> båda håll även på fyllda knappar:
> ```css
> button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
>   outline: 3px solid var(--focus-ring);
>   outline-offset: 2px;
>   box-shadow: 0 0 0 2px var(--surface);
> }
> ```
> Ta bort `outline: 0` på `code-first.css:813-815`.

### A.6 · P1 · Vald vy-flik syns knappt: 1,11:1 · **S**
`src/ui/styles.css:556-574`, markup i `src/ui/components/EditorToolbar.tsx:35-38`.

| | Ljust | Mörkt |
|---|---|---|
| Vald flik bakgrund vs ovald | `#ffffff` vs `#f0f4f7` = **1,11:1** | `#16242f` vs `#111d27` = **1,08:1** |
| Vald text vs ovald text | 1,29:1 | 1,19:1 |

Tillståndet bärs alltså av en ~1,1:1 bakgrundsskillnad och en nästan osynlig skugga. **WCAG 1.4.11**
kräver 3:1 för det som identifierar en komponents tillstånd.

Det här är appens säkerhetsmekanism: skillnaden mellan att titta på mallen, på riktiga hemligheter
(Local) och på AI-utkastet. Att inte kunna se vilken vy man är i väger tyngre här än i ett vanligt
flikgränssnitt. Banderollen under säger det i text, vilket mildrar det — men se F-2.1 om vad den
banderollen påstår.

> **Förslag:** ge den valda fliken en ram som håller 3:1, inte bara en fyllning:
> `border: 1px solid var(--text-muted)` (5,69:1 ljust, 8,34:1 mörkt), eller
> `border-bottom: 2px solid var(--accent)` (5,97:1 ljust, 4,16:1 mörkt).

### A.7 · P1 · `role="alert"` på IssuePanel läser om hela panelen vid varje tangenttryck · **S**
`src/ui/components/IssuePanel.tsx:43`.

Uppmätt med två blockerande problem i koden:

- Skriva 40 tecken på nya rader längst ned: **1 mutation** i live-regionen — rimligt.
- Skriva **en enda rad högst upp** (9 tecken): **9 mutationer**, eftersom radnumren i panelen skiftar
  per tecken (`rad 1` → `rad 2` osv.).

`role="alert"` är implicit `aria-live="assertive"` **plus `aria-atomic="true"`**, så varje mutation
avbryter skärmläsaren och läser om hela panelen. Nio gånger på nio tecken. I praktiken går det inte
att redigera kod med skärmläsare medan panelen är öppen. **WCAG 4.1.3 Status Messages.**

> **Förslag:** ta bort `role="alert"` och gör panelen till en `<section aria-labelledby>`. Låt bara
> *antalet* vara det annonserade, artigt och avgränsat:
> ```tsx
> <h3 id="issue-heading"><span role="status">{issues.length} problem hindrar kopiering</span></h3>
> ```
> Samma resonemang gäller `.clipboard-countdown` (`App.tsx:536`), som med `role="status"` skulle
> annonsera en gång per sekund om urklippsrensningen slås på — ge nedräkningen `aria-live="off"` och
> behåll bara Avbryt-knappen tillgänglig.

### A.8 · P1 · Fältens och knapparnas gränser når inte 3:1 i något tema · **M**
`src/ui/styles.css:190-194`, `:228-236`, tokens på `:17-19` / `:82-84` / `:135-137`.

| Gräns | Mot | Ljust | Mörkt |
|---|---|---|---|
| `--border-strong` (input/select) | `--surface` | **1,52:1** | **1,94:1** |
| `--border-strong` | `--bg` | **1,40:1** | **2,16:1** |
| `--border` (knapp) | `--bg` | **1,20:1** | **1,59:1** |
| `--border` (knapp) | `--surface` | **1,30:1** | **1,43:1** |
| `--accent-border` | `--surface` | **1,43:1** | **1,77:1** |

Knapparna har `background: var(--surface)` på `--bg` = 1,09:1, så ramen är i praktiken det enda som
säger var knappen slutar. Textfälten ligger på kortens `--surface` — där är ramen det *enda* som
identifierar fältet. **WCAG 1.4.11.**

> **Förslag:** höj `--border-strong` (används bara till fältgränser) till `#74869a` i ljust
> (3,36:1 mot `--surface`) och `#6b8496` i mörkt (3,30:1). Ge interaktiva knappar samma token:
> `button { border: 1px solid var(--border-strong) }`. Lämna `--border` för dekorativa avdelare.
> Utöka `src/ui/contrast.test.ts:17-38` med en `AA_LARGE`-tabell för `border-strong` mot
> `surface`/`bg`, så gränsen inte kan glida tillbaka.

### A.9 · P1 · Platshållartext är webbläsarens grå: 3,43:1 i mörkt tema · **S**
Ingen `::placeholder`-regel finns någonstans (`grep -n placeholder src/ui/*.css` → tomt). Fälten
definieras i `src/ui/styles.css:228-236`.

Chrome använder sin standardfärg `#757575` i båda teman eftersom fälten har uttrycklig
`background`/`color` men ingen `::placeholder`-regel:

| | Ljust | Mörkt |
|---|---|---|
| Sökfält, alla placeholders | `#757575` på `#ffffff` = 4,61:1 | `#757575` på `#16242f` = **3,43:1** |

Ljust ligger 0,11 över gränsen — inte fel, men utan marginal. Axe missar detta helt (den läser inte
pseudoelementets färg). **WCAG 1.4.3.**

> **Förslag:**
> ```css
> input::placeholder, textarea::placeholder {
>   color: var(--text-muted);  /* 6,18:1 ljust, 7,49:1 mörkt */
>   opacity: 1;                /* Firefox lägger annars 0.54 ovanpå */
> }
> ```
> `--text-muted` täcks redan av `contrast.test.ts:22-23`, så det låser sig självt.

### A.10 · P1 · `button.danger` i mörkt tema: 4,28:1 — den enda axe-överträdelsen · **S**
`src/ui/styles.css:223-227`, tokens `--danger: #c05a3c` (`:106`, `:159`) och `--accent-fg: #04140f`
(`:95`, `:148`).

Används av `BackupPanel.tsx:169` ("Rensa hela valvet"), `ConfirmDialog.tsx:65` (bekräftelseknappen
för **varje** destruktiv åtgärd) och `CopyDialog.tsx:88` (Copy Local). Hover-läget klarar sig
(`--danger-strong` = 5,25:1) — det är alltså bara viloläget som faller, vilket är knappens normala
tillstånd.

`src/ui/contrast.test.ts:17-38` testar `accent-fg` mot `accent` men inte mot `danger` — därav luckan.

> **Förslag:** ljusa upp `--danger` i mörkt tema till `#cd6244` (`#04140f` på den = **4,87:1**) och
> behåll `--danger-strong #d06a49` som hover. Lägg till paren i testet:
> ```ts
> ['accent-fg', 'danger', AA_TEXT],
> ['accent-fg', 'danger-strong', AA_TEXT],
> ```

### A.11 · P1 · Projektkorten: `<h3>` och `<p>` inuti `<button>`, och ett 60+ teckens namn · **M**
`src/ui/components/ProjectsPage.tsx:138` (`<button className="project-card">`) och `:143` (`<h3>`).

Tillgängligt namn på ett kort:
`"{ }powershellNamnlöst projekt1 fil0 versioner0 bindingsExperiment2026-09-06 11:13Pågående →"`.

Tre problem i samma element:
1. **Rubriknivåhopp h1 → h3** utan mellanliggande h2 (**WCAG 1.3.1**). Axes `heading-order` fångade
   det inte, eftersom rubrikerna sitter inuti knappar och därmed inte alltid exponeras som rubriker.
2. **`<button>` får bara innehålla frasinnehåll.** `<h3>`, `<p>` och `<div>` inuti är ogiltig HTML,
   och rubrikerna går inte att navigera till med H-tangenten i flera skärmläsare.
3. **Namnet är en textklump.** Den som listar knappar på en sida med 12 projekt hör hela
   metadatasträngen före projektnamnet, som ligger mitt i (**WCAG 2.4.6 / 4.1.2**).

Se F-3.1 — den visuella och den tillgänglighetsmässiga åtgärden är samma ombyggnad.

> **Förslag:** vänd på strukturen — `<article className="project-card">` med länken i rubriken:
> ```tsx
> <h2><button className="project-open" onClick={open}>{project.name}</button></h2>
> ```
> och `.project-open::after { content: ''; position: absolute; inset: 0 }` så att hela kortet
> fortfarande är klickbart (`.project-card` behöver `position: relative`, `styles.css:422`). Då blir
> namnet knappens hela tillgängliga namn och rubriknivån blir h1 → h2.

### A.12 · P1 · Routebyte är osynligt för hjälpmedel, och fokus tappas · **M**
`src/ui/App.tsx:532`, `src/ui/code-first.css:29-37`, `src/ui/App.tsx:543`. Se även F-0.4.

| Klick i huvudnavigationen | Fokus efteråt | `document.title` |
|---|---|---|
| "Bindings" (`disabled={busy}`) | **`body`** | `AI Code Vault` |
| "Inställningar" | `button "Inställningar"` | `AI Code Vault` |
| "＋ Ny kod" (`disabled={busy}`) | `div.native-edit-context` | `AI Code Vault` |

Tre följder: (a) en skärmläsaranvändare kan inte ta reda på vilken vy hen är i annat än genom att
leta upp `h1`; (b) `document.title` skiljer inte routerna åt, vilket bryter **WCAG 2.4.2 Page Titled
(nivå A)** i en SPA där hela huvudinnehållet byts; (c) knappar med `disabled={busy}` inaktiveras i
samma render som navigeringen sker, webbläsaren blurrar dem, och fokus hamnar på `body` — samma rot
som A.4.

> **Förslag:** `aria-current="page"` plus en `.active`-klass på den matchande nav-knappen
> (`.top-navigation button[aria-current="page"] { background: var(--accent-surface); color:
> var(--accent-text); font-weight: 700 }` — det paret är uppmätt till 5,94:1 ljust / 8,19:1 mörkt).
> Sätt `document.title` i den effekt som redan lyssnar på routeändringar. Ta bort `disabled={busy}`
> från nav-knapparna — `navigate()` går ändå genom `run()`-vakten (`App.tsx:145`). Flytta fokus till
> `<main>` (med `tabIndex={-1}`, se A.3) vid routebyte.

### A.13 · P2 · Fliklistans ARIA-kontrakt är halvt — piltangenterna är döda · **S**
`src/ui/components/EditorToolbar.tsx:35-38`, panelen på `src/ui/App.tsx:570`.

`role`, `aria-selected`, `aria-controls` och `id` är korrekta, och panelens `aria-labelledby` följer
den valda fliken — den delen stämmer. Men: alla tre flikarna har `tabIndex = 0` (APG föreskriver
roving tabindex), `ArrowRight` och `End` gör ingenting, och fliklistan äter tre tabbstopp i stället
för ett.

Ingen ren WCAG-överträdelse — flikarna går att nå och aktivera. Men med `role="tablist"` lovar man
skärmläsaranvändaren ett beteende ("flik 1 av 3", pilar flyttar) som inte finns, och NVDA/JAWS
annonserar just det.

> **Förslag:** antingen fullfölj kontraktet (`tabIndex={-1}` på ovalda flikar + en `onKeyDown` för
> `ArrowLeft`/`ArrowRight`/`Home`/`End`, ca 15 rader), eller släpp det och gör dem till tre knappar i
> en `role="group"`. Båda är försvarbara; det halva kontraktet är det inte.

### A.14 · P2 · Fyra mindre färg- och affordansfynd · **S**

**a) Radera-binding-knappen `×`: 3,91:1 i ljust tema.** `src/ui/styles.css:860-863`
(`.binding-actions .text-button:last-child { color: var(--danger-muted) }`), markup i
`src/ui/components/BindingPanel.tsx:73-75`. `--danger-muted #a47669` på `--surface` = **3,91:1**,
16 px normal vikt. Destruktiv kontroll under gränsen.
→ Använd `--danger-text` i stället (7,51:1 ljust, 8,16:1 mörkt); den finns redan och testas i
`contrast.test.ts:27`.

**b) Varumärkesglyfen `</>` i mörkt tema: 3,24:1.** `src/ui/code-first.css:19-22`. 16 px bold räknas
inte som stor text (kräver 18,66 px).
→ **FRÅGA Q-8:** är `</>` en logotyp? I så fall undantas den av SC 1.4.3 och kan lämnas. Ska den
läsas som text, använd `--accent-bright` i mörkt tema (8,5:1).

**c) Inaktiverade kontroller ned till 1,93:1.** `src/ui/styles.css:204-206` (`opacity: 0.45`).
Uppmätt i ljust tema: "Om projektet" 1,94:1, "Copy for AI ↗" 2,02:1, "Spara version" 2,62:1.
→ **FRÅGA Q-9:** WCAG 1.4.3 undantar uttryckligen inaktiva komponenter, så formellt är det inget
fel. Men appen inaktiverar mycket (F-1.2: fem knappar samtidigt på startskärmen), och
`EditorToolbar.tsx:28-32` bygger uttryckligen på att användaren kan **läsa** varför en knapp är av.
Vid 1,93:1 går texten inte att läsa. Om det är ett medvetet val: ignorera. Annars
`color: var(--text-faint); background: var(--surface-sunken)` för `:disabled`, som ger 4,5:1+ och
fortfarande läser som inaktiv tack vare den saknade ramen och `cursor: not-allowed`.

**d) Redigera-pennan `✎` visas bara vid hover.** `src/ui/code-first.css:72-79`
(`.project-name span { opacity: 0 }`), markup `src/ui/App.tsx:73`. Uppmätt vid vila: `#f3f6f9` på
`#f3f6f9` = **1:1**, helt osynlig. Knappen har `aria-label`, så skärmläsare klarar sig — men en
seende tangentbordsanvändare får aldrig veta att projektnamnet går att byta.
→ Lägg till `.project-name:focus-visible span { opacity: 1 }`.

### A.15 Kontrollerat och friat

- **Dolda vyer läcker inte in i tabbordningen.** `.code-first [hidden] { display: none !important }`
  (`src/ui/code-first.css:259`) gör jobbet: 37 av 71 fokuserbara element ligger i dolda vyer, alla
  har `offsetParent === null`, och ingen går att tabba till. Ingen CSS-regel överskriver det.
- **Rubrikordningen är korrekt** på `#/`, `#/bindings`, `#/settings` och `#/security` — exakt en
  `h1`, inga hopp. (Undantaget är projektkorten, A.11.)
- **Textfärgstokens klarar AA.** `--text-muted`, `--text-subtle`, `--text-faint`, `--danger-text`,
  `--accent-text`, `--warn-text` och `.eyebrow` når 4,5:1 i båda teman på de ytor de faktiskt
  renderas på (lägst: `--text-faint` på `--surface-hover` = 4,52:1). `src/ui/contrast.test.ts`
  täcker den delen bra.
- **`role="status"` på `.save-state`** avfyrade bara 4 gånger under 8 sekunders skrivande — det är
  inte spam.
- **`<dialog>`-elementens fokusfälla fungerar** via native `showModal()`. Det som saknas är bara
  återlämningen (A.3).

---

## Död yta

Spårad mekaniskt, inte visuellt: varje interaktivt element klickades och tillståndet jämfördes före
och efter; CSS-klasser korsrefererades mot JSX; `StorageProvider`-metoder mot sina anropare.
**Verktygsutfallet redovisas separat från min egen analys**, enligt uppdraget.

### D.1 Verktygsutfall

#### `knip` (kört via `pnpm dlx knip`, exit 0)

Jag har filtrerat bort mina egna granskningsskript i `ux-audit/`, som knip korrekt flaggar som
oanvända.

**Oanvända filer (1 av appens egna):**
- `scripts/publish-pages.mjs` — refereras inte från `package.json`, `.github/workflows/ci.yml`,
  `README.md` eller någon annan fil.

**Oanvända exporter (7):**
| Fil | Export |
|---|---|
| `src/domain/bindings/rewrite.ts` | `restoreValueInTemplates`, `countPlaceholder` |
| `src/domain/scanner/index.ts` | `placeholderRanges` |
| `src/domain/snapshot/schema.ts` | `projectSchema`, `versionSchema`, `draftSchema`, `bindingSchema`, `profileSchema`, `datasetSchema`, `ruleSchema`, `dismissalSchema`, `settingsSchema` |
| `src/ui/components/ConfirmDialog.tsx` | `ConfirmDialog` (används bara internt via `useConfirm`) |
| `src/ui/components/VersionPanel.tsx` | `changedLines` |
| `src/ui/contrast.ts` | `luminance`, `AA_LARGE` |
| `src/ui/text.ts` | `sv` |

**Oanvända exporterade typer (4 grupper):** `EntityKind`, `PlannedEntity`, `SnapshotHead`, `Iso`,
`ProjectPathConfig`, `BindingUsage`, `DatasetColumn`, `IssueView`.

**Dubbletter (1):** `src/ui/text.ts` exporterar både `sv` och `t` för samma objekt.

De enskilda scheman i `snapshot/schema.ts` är sannolikt avsiktliga byggstenar för det sammansatta
schemat, och `contrast.ts`-exporterna används av testerna. Det som är värt att agera på är
`scripts/publish-pages.mjs`, dubbelexporten i `text.ts` och `changedLines`.

#### `ts-prune` (kört via `pnpm dlx ts-prune -p tsconfig.json`, exit 0)

**Utfallet är inte användbart för det här repot.** Verktyget flaggar bland annat `resolveBinding`,
`resolveValue`, `suggestBinding`, `defaults` och `usage` som oanvända — samtliga importeras
demonstrativt i `src/ui/App.tsx:6-7`. ts-prune är arkiverat till förmån för knip och verkar inte
klara TypeScript 7 här. Jag redovisar det för fullständighetens skull och rekommenderar att man
förlitar sig på knip.

### D.2 Egen analys

#### F-D.1 · P0 · Versionshistorikens samtliga handlingar är `display: none` under 1251 px · **S**
`src/ui/styles.css:1059-1061`, inuti `@media (max-width: 1250px)`:

```css
.version-item .text-button { display: none; }
```

Uppmätt, samma projekt, samma dragspel öppnat:

| Bredd | Knappar i DOM | Synliga |
|---|---|---|
| 390 px | 4 | **0** |
| 768 px | 4 | **0** |
| 1000 px | 4 | **0** |
| 1250 px | 4 | **0** |
| 1251 px | 4 | 4 |
| 1440 px | 4 | 4 |

*Visa*, *Jämför med v(n)*, *Återställ*, *Återställ som ny version* och *Radera* är alltså
oåtkomliga på varje telefon och varje surfplatta. Dragspelet öppnas och visar ingenting — vilket är
sämre än om det inte gick att öppna alls. Versionshistorik blir en läslista utan handlingar precis i
det läge (`code-first.css:262-278` gör layouten enkolumnig) där det finns gott om bredd.

Skärm: `34-version-actions-open--768.png` mot `34-version-actions-open--1440.png`.

> **Förslag:** ta bort regeln. Om avsikten var att spara plats i den smala 1250 px-panelen, korta
> etiketterna i stället (`Visa` / `Jämför` / `Återställ` / `Ny version` / `Radera`) och låt dem
> radbrytas.

#### F-D.2 · P1 · Fem responsiva `.work-grid`-regler är döda av specificitetsskäl · **M**
`src/ui/styles.css:493`, `:1036-1038`, `:1050-1052`, `:1091-1093`, `:1133` — alla överskuggade av
`src/ui/code-first.css:110-114` (`.code-first .work-grid`, specificitet 0,2,0 mot 0,1,0).
`.code-first` sitter alltid på rotelementet (`App.tsx:530`).

Uppmätt `grid-template-columns` i den körande appen:

| Bredd | Beräknat värde |
|---|---|
| 390 px | `366px` (en kolumn — 750 px-regeln i `code-first.css` biter) |
| 768 px | `410px 270px` |
| 900 px | `542px 270px` |
| 1250 px | `892px 270px` |
| 1440 px | `1082px 270px` |
| 1700 px | `1162px 270px` |

Sidopanelen är alltså **exakt 270 px från 768 px hela vägen upp till 1700 px**. Vid 768 px betyder
det att panelen tar 40 % av innehållsbredden och editorn får 410 px. Trekolumnslayouten som
`@media (min-width: 1600px)` beskriver existerar inte.

> **Förslag:** flytta de responsiva `.work-grid`-reglerna till `code-first.css` (eller prefixa dem
> `.code-first`). Se även DESIGN.md §6 och §7 — det här är samma fälla som F-0.2.

#### F-D.3 · P1 · "eller prova med exempelkod" — se F-1.1
Knappen finns i DOM:en, har en handler, och kan aldrig aktiveras. Den mest bokstavliga döda ytan i
appen.

#### F-D.4 · P1 · `PlainEditor` tar emot 10 av 20 props — resten faller tyst · **M**
`src/ui/editor/props.ts:14-39` mot `src/ui/editor/PlainEditor.tsx:11`.

Ignorerade: `documentKey`, `active`, `language`, `onPlaceholder`, `describePlaceholder`,
`placeholderNames`, `focusName`, `theme`, `substitutions`, `onFocused`.

Att en textarea inte kan rendera dekorationer är väntat. Det som gör det till död yta är att
**anropssidan inte vet om det**: `App.tsx:588` renderar ett bindingnamn som en `<button>` vars enda
verkan är `setFocusName`, och under 750 px gör den ingenting. Se F-2.8 för de uppmätta
konsekvenserna.

> **Förslag:** låt `Editor` exponera vilka förmågor den aktiva implementationen har, så att
> arbetsytan kan låta bli att rendera kontroller som inte kan göra något — eller ersätta dem, som
> F-2.8 föreslår.

#### F-D.5 · P1 · `deleteDismissal` är implementerad men har noll anropare · **S**
`src/storage/StorageProvider.ts:47`, `src/storage/IndexedDbProvider.ts:174`.

Av 35 metoder i `StorageProvider` saknar fyra anropare utanför lagringslagret och testerna:

| Metod | Bedömning |
|---|---|
| `deleteDismissal` | **Verklig lucka.** Avfärdning är en levererad funktion (F-2.7); bara vägen tillbaka saknas. |
| `getVersion` | Oanvänd läshjälpare. Ofarlig. |
| `listDatasets`, `saveDataset` | Avsiktligt förarbete — README listar "datasets" under *Inte levererat ännu*. |

> **Förslag:** koppla `deleteDismissal` till ångra-mekanismen enligt F-2.7. Ta bort `getVersion`
> eller använd den.

#### F-D.6 · P2 · Fyra CSS-klasser är definierade men finns inte i någon JSX · **S**

| Klass | Definierad | Regler |
|---|---|---|
| `.profile-badge` | `src/ui/styles.css:338` | 3 |
| `.project-links` | `src/ui/styles.css:317` | 2 |
| `.rail-label` | `src/ui/styles.css:1083` | 1 |
| `.section-title` | `src/ui/styles.css:404` | 5 |

`.rail-label` och `.project-links` är rester från den borttagna sidoraden och är samtidigt orsaken
till att regeln i F-0.2 ser ut som den gör.

**Falska positiva att inte ta bort:** `.mode-ai`, `.mode-local`, `.severity-critical`,
`.severity-high`, `.severity-medium`, `.status-stable`, `.status-testing`, `.status-broken` byggs
alla med template-literaler (`` `mode-${mode}` ``, `` `severity-${finding.severity}` ``,
`` `status-${project.status}` ``) och syns därför inte i en enkel klasssökning.

#### F-D.7 · P2 · Dubbla och tysta vägar till samma handling · **S**

Enumererat ur `src/ui/App.tsx`:

| Mål | Antal ingångar | Rader |
|---|---|---|
| `#/` (som **stänger** öppet projekt) | 3 | `:531` logotypen, `:532` navet, `:599` projektsidan |
| `#/project/${currentId}` ("tillbaka") | 2 | `:547`, `:599` — men saknas på tre routes, se F-0.11 |
| `#/projects` | **1** | `:613`, inne i en modal — se F-0.5 |
| `newBinding()` | 2 | `:586`, `:605` — legitimt, olika kontexter |

Att klicka nav-knappen för den sida man redan står på är en tyst nullhandling (verifierat:
`NO-CHANGE` på `#/bindings` och `#/settings`) — se F-0.4.

#### Ej fynd — kontrollerat och friat
- **`.skip-link`** flaggades av min automatiska sondering som "NOT-CLICKABLE". Det är ett falskt
  utslag: länken ligger utanför skärmen tills den fokuseras, vilket är avsikten och redan täcks av
  ett e2e-test (`e2e/accessibility.spec.ts:63-82`). Fungerar.
- **Långa strängar** bryter ingenting: varken 250 teckens kodrad eller 67 teckens bindingnamn ger
  horisontell overflow vid 390 eller 1440 px (`35-long-strings--*.png`).
- **Versionsdragspelet** öppnas på klick, inte på hover — det är pekvänligt. Problemet är enbart
  CSS-regeln i F-D.1.

---

## FRÅGOR

Sådant jag inte kan avgöra om det är ett problem eller ett medvetet val:

- **Q-1 · Ordet "bindings".** Böjs som svenskt-engelsk hybrid på ~40 ställen ("0 bindings",
  "Radera bindingen", "Alla bindings") och är det enda icke-svenska ordet i navet. Medvetet
  domänval eller aldrig omprövat?
- **Q-2 · `.m1-note` i arbetsytan.** Är det avsiktligt att hålla begränsningarna framför näsan i
  varje session, eller en placering som blivit kvar? (Innehållet är produktionstext — se F-2.9.)
- **Q-3 · `Inter` först i font-stacken** (`styles.css:3`) medan CSP:n förbjuder externa fonter.
  Gratis förbättring för den som har den installerad, eller rest från ett bygge som laddade den?
- **Q-4 · Spärren i CopyDialog** (`CopyDialog.tsx:70`) gäller bara critical/high. Med enbart
  medel/låg-fynd **och noll bindings** visas "Inga värden är skyddade" samtidigt som
  "Kopiera oskyddad kod ändå" är direkt klickbar utan kryssruta. Avsiktligt att `bound === 0` inte
  i sig kräver en bekräftelse?
- **Q-5 · `all` förkryssad i BindingDialog** (`BindingDialog.tsx:14`) — "ersätt alla identiska
  förekomster" är standard. Rimligt vid två träffar; vid tjugo?
- **Q-6 · Maskerade utdrag visar första och sista tecknen** (`sk••••••••••••dc`). Medveten
  avvägning för igenkänning, eller mer läckage än avsett?
- **Q-7 · Skannern missar `$adminPassword = "Hunter2-Very-Secret!"`** men flaggar värdnamnet på
  raden under. Domänlogik snarare än UI, men det påverkar direkt vad panelen och dialogen påstår.
  Känd begränsning?
- **Q-8 · Är `</>` en logotyp?** (`code-first.css:19-22`, 3,24:1 i mörkt tema.) Räknas den som
  logotyp undantas den av WCAG 1.4.3 och kan lämnas som den är. Ska den läsas som text behöver den
  `--accent-bright`. Se A.14b.
- **Q-9 · Är `opacity: 0.45` på inaktiverade kontroller** (`styles.css:204-206`) ett medvetet val?
  WCAG undantar inaktiva komponenter, så formellt är det inget fel — men `EditorToolbar.tsx:28-32`
  bygger uttryckligen på att användaren ska kunna **läsa** varför en knapp är av, och vid 1,93:1
  går texten inte att läsa. Se A.14c.

---

## Vad som fungerar bra

Det här bör inte "fixas" bort i städningen:

- **Raderingsdialogen för projekt** (`24-confirm-delete-project--1440.png`) namnger projektet,
  räknar upp exakt vad som försvinner, säger vad som *inte* påverkas, kräver att man skriver
  `RADERA` och håller knappen inaktiverad tills dess. Så här bör alla destruktiva handlingar i
  appen se ut.
- **`useConfirm()`** (`ConfirmDialog.tsx:96`) med stöd för `danger`, `typeToConfirm` och ett extra
  `option`-val — särskilt "skriv tillbaka det privata värdet på de N platserna" när en binding
  raderas (`App.tsx:410-413`). Det är omtanke om ett verkligt problem.
- **Färgtokeniseringen.** 44 tokens, tre teman, ingen komponentregel som definieras om per tema, och
  ett byggsteg som bevakar det. Se DESIGN.md §1.
- **`:focus-visible` genomgående** med `outline: 3px solid var(--focus-ring); outline-offset: 2px`
  (`styles.css:208-213`).
- **Kommentarerna i koden.** Nästan varje icke-uppenbart val har en motivering som förklarar vilket
  problem det löste. Det är ovanligt och det har gjort den här granskningen mycket snabbare.
- **Bindingsidan** (`25-bindings-list--1440.png`) — riktig tabell, förklarande ledtext och kolumnen
  "Används i" som svarar på just den fråga sidan finns för.

---

## Bilagor

- `ux-audit/screens/` — 111 skärmdumpar, `<vy>--<bredd>.png`
- `ux-audit/measure.json` — overflow, träffytor, fokusordning, semantik per route och bredd
- `ux-audit/*.mjs` — granskningsskripten; kör med `node ux-audit/<skript>.mjs` från repo-roten mot
  en igång­varande `pnpm preview --port 4173`
