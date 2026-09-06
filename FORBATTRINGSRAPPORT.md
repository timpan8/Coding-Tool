# Förbättringsrapport — AI Code Vault

**Datum:** 2026-09-05 · **Granskad commit:** `1b3c8bd` · **Omfattning:** hela repot (`src/`, `scripts/`, konfiguration)
**Fokus:** funktioner och användarvänlighet. Kodhälsa och säkerhet tas upp där de direkt påverkar vad användaren kan göra.

Rapporten är skriven för att kunna lämnas till en AI som ska förbättra verktyget. Varje punkt har ett ID, en plats i koden,
en motivering och ett konkret förslag. Sist finns en prioriterad åtgärdslista och en lista över invarianter som **inte** får brytas.

---

## 1. Hur granskningen gjordes

| Steg                                                                 | Resultat                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                     | OK                                                            |
| `pnpm test`                                                          | 27 tester i 4 filer, alla gröna, 2,96 s                       |
| `pnpm build`                                                         | OK. `tsc -b`, Vite, service worker, nätverkskontroll passerar |
| Manuell körning i Chromium mot `pnpm preview` (1440×900 och 390×844) | Se avsnitt 3–5                                                |

Alla observationer nedan är verifierade antingen i koden (fil och rad anges) eller genom faktisk körning i webbläsaren.
Beteenden som bara är verifierade genom körning är markerade **[körd]**.

**Kort helhetsbild:** grunden är ovanligt välbyggd för sin storlek — 1 279 rader källkod, en ren domänmodell utan DOM-beroenden,
riktig transaktions- och revisionshantering i lagret, konservativ escaping med blockering i stället för gissning, och tester som
faktiskt testar rätt saker (property-baserat läckagetest, kontraktstest för lagringslagret). Problemet är inte kvaliteten på det
som finns, utan att **det byggda skalet inte täcker verktygets huvudlöfte**, och att UI:t saknar återkoppling på de ställen där
användaren behöver den mest.

---

## 2. Den kritiska luckan

### K1 — Verktyget säger "Inga kända problem hittades" om kod som innehåller ett riktigt lösenord

**[körd]** Reproducerbart på under en minut i en ren webbläsarprofil:

1. Klistra in:
   ```powershell
   $username = "example.user"
   $password = "Hunter2!"
   $conn = "Server=sql01.corp.local;Pwd=Hunter2!"
   ```
2. Klicka **Copy for AI** utan att skapa någon binding.
3. Dialogen visar: **"Inga kända problem hittades"** och "0 ersatta förekomster".
4. Efter bekräftelse hamnar hela texten oförändrad i urklipp — lösenord, server och anslutningssträng.

Orsak: `render()` i `src/domain/render/index.ts:35-39` letar bara efter värden som redan är _kända_ bindings. Kod utan bindings
har per definition inga kända värden, alltså inga problem. Logiken är korrekt; formuleringen och avsaknaden av en scanner gör
den missvisande.

Detta är inte bara "M2 saknas". Det är verktygets enda syfte: hindra att privata värden följer med till en AI-tjänst. I nuläget
kan verktyget **öka** risken, eftersom det ger ett grönt besked i det vanligaste flödet (klistra in → kopiera). En användare som
litar på beskedet är sämre skyddad än en som inte har verktyget alls.

**Åtgärd, i två steg:**

**Steg 1 (litet, kan göras direkt).** Ändra beskedet så att det speglar vad som faktiskt kontrollerats.

- Utan bindings i mallen: rubriken ska vara neutral eller varnande, aldrig "Inga kända problem hittades".
  Exempel: _"0 värden är skyddade. Ingen automatisk granskning har körts på den här koden."_
- Visa alltid räknaren "N av M strängliteraler är kopplade till bindings" så användaren ser sin egen täckningsgrad.
- Byt knapptexten från "Jag har granskat · kopiera för AI" till något som kräver ett aktivt val när täckningen är 0.

**Steg 2 (M2-scannern, se F1).** Regelbaserad detektering av misstänkta värden innan AI-kopiering tillåts.

**Acceptanskriterium för steg 1:** reproduktionen ovan får inte visa en positiv formulering. Ett nytt test i
`src/ui/App.test.tsx` som klistrar in kod utan bindings och kontrollerar dialogtexten.

---

## 3. Funktioner som saknas

### 3.1 Säkerhet och förtroende — det som gör verktyget värt att använda

**F1 · Scanner för misstänkta värden (M2).** Ingen heuristisk detektering finns. `ScannerRule` är fullt modellerad i
`src/types/models.ts:43-46`, `listScannerRules()`/`saveScannerRule()` finns i lagret — men inga regler skapas någonsin och inget
UI finns. Detta är den enskilt viktigaste saknade funktionen.

Minsta användbara version:

- 15–25 inbyggda regler: höga entropivärden, `password|pwd|secret|token|apikey|api_key|client_secret|connectionstring`,
  privata IP-intervall och interna domäner, UNC-sökvägar (`\\server\share`), Windows-sökvägar, e-postadresser,
  AWS/Azure/GitHub-nyckelformat, JWT, PEM-block, personnummer.
- Träffar visas som en lista bredvid koden med rad, utdrag och en knapp **"Skapa binding"** som förifyller dialogen.
- Varje träff kan avfärdas per projekt ("det här är ett exempelvärde") och avfärdandet sparas.
- Sammanfattningen i AI-kopieringsdialogen bygger på scannerresultatet, inte bara på kända bindings.
- Regelredigering i inställningarna: aktivera/avaktivera, egna reguljära uttryck, testruta.

`DECISIONS.md` slår fast att förslag alltid är förslag och aldrig automatisk matchning. Behåll det: scannern föreslår, användaren
bestämmer.

**F2 · Ingen backup, ingen export, ingen återställning (M3).** `exportAll()` finns i `IndexedDbProvider` men anropas bara
internt för att räkna användningar. `importAll()` kastar alltid (`src/storage/IndexedDbProvider.ts:109-112`). Det finns inget
sätt att få ut sitt valv ur webbläsaren.

Konsekvens: README rekommenderar därför att bara använda testvärden — vilket i praktiken betyder att verktyget inte kan användas
till det det är byggt för. Kombinerat med F3 nedan är detta en väntande dataförlust.

Minsta användbara version:

- **Exportera valv** i inställningarna: laddar ned en JSON-fil. Två varianter enligt `DECISIONS.md` §14.2:
  _Full Workspace Backup_ (allt) och _Private Configuration Backup_ (bindings, profiler, inställningar — ingen projektkod).
- **Importera** med schemavalidering (`zod` finns redan som beroende men används inte i koden), förhandsgranskning
  ("12 projekt, 40 bindings, 3 konflikter") och explicit val per konflikt.
- Frivillig lösenordskryptering av exportfilen (Web Crypto, AES-GCM + PBKDF2). Filändelsen `.acv.enc` är redan reserverad i
  `.gitignore`, så detta var uppenbart planerat.
- Påminnelse i UI när det gått mer än N dagar sedan senaste export.

**[körd]** Nedladdning är verifierad mot produktionsbygget: en `<a download>` med en Blob-URL laddar ned filen utan att
utlösa någon CSP-överträdelse. Nuvarande policy behöver alltså inte ändras för F2 eller F11.

**F3 · Lagringen är vräkbar och ingen varnar om det.** **[körd]** `navigator.storage.persisted()` returnerar `false`. Ingen
`navigator.storage.persist()` anropas någonstans i koden. Webbläsaren får alltså slänga hela valvet vid diskbrist, och
användaren har ingen backup (F2).

Åtgärd, litet arbete och stor effekt:

- Anropa `navigator.storage.persist()` efter första sparningen och visa resultatet.
- Visa i inställningarna: _"Beständig lagring: ja/nej"_ och `navigator.storage.estimate()` som "X MB av Y MB".
  I testmiljön var kvoten 810 MB, vilket är värt att visa.
- Om beständighet nekas: tydlig varning kopplad till exportfunktionen.

**F4 · Ingen automatisk urklippsrensning.** `Settings.clipboardAutoClearSeconds` finns i modellen, sätts till `0` i
`src/storage/IndexedDbProvider.ts:97` och läses aldrig. Efter **Copy Local** ligger riktiga lösenord kvar i urklipp tills något
annat kopieras. Implementera: skriv över urklipp efter N sekunder, med en synlig nedräkning och möjlighet att avbryta.
Var ärlig i texten om att urklippshistorik ändå kan ha fångat värdet — det står redan korrekt i `Security.tsx`.

**F5 · Ingen återmatchning vid retur från AI (M2).** Hela poängen med mallar är att kunna klistra tillbaka AI:ns ändrade kod och
få tillbaka sina egna värden. Det går inte i dag. `Settings.roundTripMarkers` finns men används aldrig, och `IngestReport` i
`src/types/models.ts:18` är modellerad men skrivs aldrig. Utan detta bryts arbetscykeln vid steg tre och användaren måste
handredigera tillbaka sina värden.

**F6 · Inget AI-promptblock.** `Settings.includeAiPromptBlock` är oanvänd. En kort, redigerbar rubrik ovanför den kopierade
koden ("Nedan är kod där privata värden är utbytta mot platshållare. Behåll platshållarna oförändrade.") höjer träffsäkerheten
i AI-svaret markant och gör F5 mycket lättare att implementera.

### 3.2 Projekt och filer

**F7 · Ett projekt = en fil, trots att modellen stödjer flera.** `Project.files` är en array, men UI:t använder uteslutande
`files[0]`: `App.tsx:174`, `WorkspaceController.ts:126-127`. Ett verkligt PowerShell- eller Terraform-projekt är sällan en fil.
Oanvända CSS-klasser `.file-panel` och `.file-current` i `src/ui/styles.css` visar att en filpanel varit påtänkt.
Lägg till filflikar, ny fil, byt namn, ta bort, ändra ordning. Datamodellen och `ProjectDraft.templates` (nyckel = fil-id) klarar
det redan utan ändringar.

**F8 · Projekt kan inte raderas från UI:t.** `deleteProject()` är implementerad med korrekt kaskad i
`src/storage/IndexedDbProvider.ts:26-35` och testad i kontraktstestet — men den exponeras aldrig. Valvet kan bara växa.
Lägg till radering på projektkortet och i projektpanelen, med bekräftelse som visar vad som försvinner (versioner, bindings).

**F9 · Metadata är oredigerbar och sökning söker i tomma fält.** `description`, `notes`, `tags` och `status` finns i modellen,
sätts en gång vid skapandet och kan aldrig ändras. `projectMatches()` i `src/ui/components/ProjectBrowser.tsx:4-6` söker i
`project.tags` — ett fält användaren omöjligt kan fylla i. Sökfältets platshållartext lovar "Sök namn, tagg eller filnamn…"
men två av tre dimensioner är alltid tomma.
Lägg till en projektpanel med namn, beskrivning, taggar och status. Status finns redan som ett meningsfullt värdeset
(`stable | testing | experimental | broken | archived`) och passar utmärkt som färgat filter i projektlistan.

**F10 · Ingen sortering, filtrering eller information på projektkorten.** **[körd]** Kortet visar namn, filnamn, språk och
datum. Det säger inget om antal bindings, antal versioner, om värden saknas eller när projektet senast kopierades.
Lägg till sortering (namn, ändrad, skapad), filter på språk och status, och en varningsmarkör på kort med bindings utan värde.

**F11 · Ingen import av filer, ingen nedladdning.** Man kan bara klistra in text och bara kopiera till urklipp.
Lägg till dra-och-släpp av en `.ps1`/`.py`/`.tf`-fil in i editorn samt "Ladda ned Local"/"Ladda ned AI" som fil.

**F12 · Filändelsen följer inte språkbytet.** `WorkspaceController.ts:91` uppdaterar `language` på filen men behåller `name`.
Ett projekt som skapas som PowerShell och byts till Python heter fortfarande `script.ps1`. Byt ändelse när namnet fortfarande är
det autogenererade, låt det vara om användaren döpt om filen.

**F13 · För få språk för målgruppen.** *(Delvis åtgärdat: `dotenv`, `hcl` och `sql` tillagda med egna
escaping-regler och tester. `dockerfile`, `ini`/`toml`, `csharp`, `go` och `java` återstår — var och en
kräver samma arbete, och C#-verbatimsträngar och Go:s råsträngar med backticks måste blockeras, inte
gissas.)* `LanguageId` har nio värden. För ett verktyg om hemligheter i kod saknas
`.env`/dotenv, SQL, Dockerfile, Terraform/HCL, INI/TOML, C#, Go och Java. `.env` och Terraform är de mest uppenbara —
det är där hemligheter faktiskt bor. Varje nytt språk kräver dock en egen escaping-regel i `escape.ts`; lägg inte till ett språk
utan att också lägga till dess escaping och test, annars faller det tillbaka på den odefinierade sista raden i
`escapeValue()` (`escape.ts:79-80`).

### 3.3 Bindings

**F14 · Bindings kan bara skapas genom att markera text i editorn.** *(Åtgärdat: "Ny binding"-knapp
utan markering, och `#/bindings` som egen route med sökning, filter på räckvidd och användning över
hela valvet.)* Det finns ingen "Ny binding"-knapp. Vill man förbereda ett
globalt värde innan koden finns går det inte. Lägg till en knapp i bindingpanelen och en global bindinghanterare
(egen route) där alla bindings kan sökas, redigeras och rensas — inklusive globala som inte hör till något öppet projekt.

**F15 · Namnet låses för alltid.** `BindingDialog.tsx:20` sätter `disabled={existing}` med motiveringen att mallarnas
referenser ska bevaras. Rätt instinkt, fel lösning: implementera byt-namn som en operation som uppdaterar alla mallar i alla
versioner och utkast i en transaktion, med förhandsvisning av hur många förekomster som berörs.

**F16 · Ingen "ta bort binding och skriv tillbaka värdet".** `removeBinding()` (`App.tsx:130-137`) tar bort bindingen och
lämnar kvar `{{NAMN}}` som ett trasigt platshållarvärde som blockerar all kopiering. Lägg till två separata val:
_"Ta bort och återställ det privata värdet i mallen"_ respektive _"Ta bort och lämna platshållaren"_.

**F17 · Övergivna bindings städas aldrig.** **[körd]** En binding med noll förekomster ligger kvar i listan och fortsätter
blockera AI-kopiering om dess värde råkar dyka upp någon annanstans i koden. Visa "0 förekomster" som en varning med ett
förslag att ta bort, inte som neutral text.

**F18 · Profiler finns inte, men UI:t antyder att de gör det.** `Binding.values` är en `Record<profileId, string>` och
`resolveValue()` implementerar reservlogiken korrekt — men `BindingDialog` skriver bara `__default__` (rad 24) och
`activeProfileId` är alltid `null`. Ändå visar toppfältet en fast etikett **"Profil: Standard"** (`App.tsx:167`) som ser ut som
en kontroll men inte är det. Antingen: implementera profiler (skapa, byta, per-profil-värden i bindingdialogen), eller ta bort
etiketten. Att visa en funktion som inte finns är värre än att sakna den.

**F19 · Namn- och kategoriförslagen är svaga och osäkra.** **[körd]** För `$p = "Hunter2!"` föreslog `suggestBinding()`
(`src/domain/bindings/index.ts:25-32`) namnet `P_VALUE`, kategorin `identity` och därmed AI-värdet `example.user` — för ett
lösenord. Det AI-värdet är vad som faktiskt delas, så en felaktig kategori har verkliga följder.
Förbättra: väg in själva värdets utseende (entropi, tecken, längd, format) och inte bara variabelnamnet; återanvänd
scannerreglerna från F1; låt kategorin `secret` vara standard vid osäkerhet i stället för `identity`.

**F20 · Markeringen expanderas inte till hela strängliteralen.** **[körd]** Dubbelklick på `Hunter2!` markerar `Hunter2` och
lämnar `!` utanför, så resultatet blir `"{{PASSWORD}}!"` med halva lösenordet kvar i mallen. Detta är den farligaste sortens
tyst fel. Lägg till: när markeringen ligger inuti en strängliteral, föreslå hela literalen och visa en förhandsvisning
_före → efter_ i bindingdialogen. Varna om texten precis utanför markeringen ser ut att höra till värdet.

**F21 · Ingen komplettering av platshållare i editorn.** Att skriva `{{` borde föreslå befintliga bindingnamn.
Monaco har `registerCompletionItemProvider` inbyggd; `quickSuggestions` är i dag avstängt i `CodeEditor.tsx:46`.

### 3.4 Versioner

**F22 · Versioner går inte att skilja åt.** **[körd]** `App.tsx:175` anropar `controller.saveVersion()` helt utan argument, så
`label` blir tom och listan visar "Sparad version" för varje post, med bara datum utan klockslag. Två versioner sparade samma
dag är omöjliga att skilja på.
Åtgärd: fråga efter en etikett vid sparning (förifylld med ett förslag), visa klockslag, visa antal ändrade rader mot
föregående version.

**F23 · Ingen diff.** Det går inte att se vad som skiljer två versioner. Monaco har `createDiffEditor` inbyggd — modulen finns
redan i beroendet. Detta är en liten insats med stor effekt på förtroendet för versionshistoriken.

**F24 · Ingen förhandsgranskning av en version.** Enda sättet att se en gammal version är `useVersion()`
(`App.tsx:138-141`), som **ersätter det pågående utkastet**. Bekräftelsedialogen varnar korrekt, men beteendet är fel:
lägg till skrivskyddad förhandsgranskning som separat läge, och gör återställning till ett andra, medvetet steg därifrån.

**F25 · Versioner kan inte raderas eller kommenteras.** `deleteVersion()` finns i lagret (med korrekt skydd mot att radera
aktuell version) men saknar UI. `Version.notes`, `Version.status` och `Version.branchName` är helt oanvända.

### 3.5 Inställningar

**F26 · Sju av tolv inställningar existerar bara i typen.** **[körd]** Sidan innehåller ett enda redigerbart fält: enhetsnamn.
Oanvända: `globalRootPath`, `aiRootPath`, `defaultSubfolders`, `activeProfileId`, `roundTripMarkers`, `includeAiPromptBlock`,
`clipboardAutoClearSeconds`. Även `maskSecretsInUi` är oanvänd — maskeringen styrs i stället av lokalt komponenttillstånd
(`showSecrets` i `App.tsx:36`) som nollställs vid varje vybyte, så användarens val glöms bort direkt.

**F27 · Ingen "rensa valvet".** `clearAll()` finns och är testad men saknar UI. En användare som vill lämna en delad dator har
inget sätt att städa upp annat än webbläsarens egna inställningar.

**F28 · Ingen genvägsöversikt.** Ctrl+B, Ctrl+K, Ctrl+Shift+C och Ctrl+Alt+C finns bara dokumenterade i README och delvis i en
hjälptext. Lägg till en genvägsdialog (`?` eller Ctrl+/) och en rad i inställningarna.
Notera samtidigt att **Ctrl+K krockar med sökfältet i Firefox** och **Ctrl+Shift+C med utvecklarverktygen i Chrome och Firefox**.
Överväg att byta, eller åtminstone dokumentera krockarna.

---

## 4. Användbarhet — konkreta problem i det som redan finns

**U1 · En avstängd knapp utan förklaring.** **[körd]** Om läckagekontrollen slår till (ett känt privat värde finns någon
annanstans i koden) blir **Copy for AI** avstängd. I Mall-vyn syns ingen förklaring alls, eftersom problempanelen i
`App.tsx:187` bara visar `local.issues` när man inte står i AI-vyn — och läckagekontrollen körs bara i AI-läge
(`src/domain/render/index.ts:35`). Användaren möter en grå knapp utan orsak och utan väg framåt.
Åtgärd: visa alltid båda vyernas problem i panelen, med etikett om vilken vy de gäller; sätt `title`/`aria-describedby` på
avstängda knappar; eller ersätt avstängningen med en klickbar knapp som öppnar problemlistan.

**U2 · Problem går inte att navigera till.** `RenderIssue` bär ett teckenindex `start`, men panelen visar bara namn och
meddelande. För `kind: 'leak'` är `start` dessutom alltid `0`, så positionen är okänd även internt.
Åtgärd: räkna om `start` till rad och kolumn, gör varje problem klickbart så editorn hoppar dit, och låt läckagekontrollen
rapportera var träffen finns.

**U3 · Man kan inte klicka i en platshållare.** **[körd]** `onMouseDown` i `CodeEditor.tsx:64-70` öppnar redigeringsdialogen så
fort man klickar någonstans inuti `{{NAMN}}`. Det gör det omöjligt att placera markören där för att redigera manuellt, och en
felklick mitt i skrivandet slänger upp en modal.
Åtgärd: flytta öppningen till dubbelklick, Ctrl+klick eller ett litet klickbart chip vid sidan av; alternativt visa en
hovringsruta med värdena och låt redigering ske via bindingpanelen.

**U4 · Fokus hamnar på stängknappen i dialoger.** **[körd]** `BindingDialog` sätter `autoFocus` på namnfältet
(`BindingDialog.tsx:20`), men `Modal` anropar `showModal()` i en effekt efter renderingen (`Modal.tsx:4`), vilket flyttar fokus
till första fokuserbara elementet — `×`. Enter stänger då dialogen i stället för att spara.
Åtgärd: fokusera målfältet explicit efter `showModal()`, och lägg till Enter = spara i formuläret.

**U5 · Fyra `window.confirm()` mitt i ett annars genomarbetat UI.** `App.tsx:134`, `App.tsx:139`, `BindingDialog.tsx:14`,
`BindingDialog.tsx:27`. De två i bindingdialogen läggs dessutom _ovanpå_ en `<dialog>`, vilket ser trasigt ut. Native
`confirm()` går inte att formge, kan blockeras av webbläsaren och saknar möjlighet till "fråga inte igen".
Åtgärd: använd den befintliga `Modal`-komponenten för alla bekräftelser.

**U6 · Alla fel blir en modal.** *(Åtgärdat.)* `App.tsx:205` visar varje fel som en heltäckande dialog med rubriken "Åtgärden behöver
uppmärksamhet". För återvinnbara fel (urklipp nekat, projektlistan kunde inte läsas) är det för tungt.
Åtgärd: skilj på blockerande fel (modal) och information (den befintliga `inline-notice`-remsan).

**U7 · Klick försvinner tyst.** *(Åtgärdat. Den tysta returen för Ctrl+B låg dessutom i editorn, inte i `App.tsx` — Monaco rapporterade aldrig en tom markering, så appen hade ingenting att svara på.)* `run()` (`App.tsx:43-49`) returnerar utan återkoppling om något redan pågår.
`copy()` (rad 147) och `createBinding()` (rad 101) gör detsamma. I Local-vyn gör Ctrl+B ingenting alls, utan förklaring.
Åtgärd: ge alltid ett svar — inaktiverat läge med förklaring, eller ett kort meddelande ("Byt till Mall-vyn för att skapa en
binding").

**U8 · Navigering blockeras tyst under sparning.** *(Åtgärdat.)* `navigate()` (`App.tsx:54-55`) återställer hashen utan att säga något om en
skrivning pågår. Användaren klickar på en länk och ingenting händer.

**U9 · Hela gränssnittet fryser vid varje åtgärd.** *(Åtgärdat: `inert` sitter nu på redigeringsytan, och `aria-busy` på `<main>`.)* `<main inert={busy}>` (`App.tsx:171`) stänger av all interaktion i
huvudytan under varje `run()`-anrop. Det är rätt tänkt men för brett — sätt `inert` på det som faktiskt påverkas, eller visa en
tydlig upptagen-indikation så att frysningen blir begriplig.

**U10 · Sökfältet delas mellan två vyer.** *(Åtgärdat.)* Samma `query`-tillstånd (`App.tsx:33`) används både i snabbpanelen och på
"Alla projekt". Skriver man i den ena ändras den andra. Håll dem åtskilda.

**U11 · Inget visar vad som faktiskt byttes ut.** `RenderResult.secretRanges` beräknas i `render()` men används enbart för att
avgöra om en bekräftelsedialog behövs (`App.tsx:150`). Varken Local- eller AI-vyn markerar vilka delar av texten som är
substituerade.
Åtgärd: markera de utbytta intervallen med Monaco-dekorationer i båda projektionerna. Det gör skillnaden mellan vyerna
omedelbart begriplig och är förmodligen den enskilt billigaste UX-förbättringen i hela listan.

**U12 · Tomt läge hjälper bara PowerShell-användare.** Knappen "Prova med exempelkod" (`App.tsx:186`) visas bara när språket är
`powershell`, och exempelkoden är hårdkodad som PowerShell (`App.tsx:16`). Lägg till ett exempel per språk, eller gör knappen
språkoberoende.

**U13 · Inget introduktionsflöde.** Modellen mall/Local/AI är verktygets kärnidé och förklaras bara i tre banderolltexter.
En engångsgenomgång på tre steg vid första besöket skulle löna sig.

**U14 · Ingen automatisk språkigenkänning.** Standard är alltid `powershell`. Enkel heuristik vid inklistring
(`#!`-rad, `$var =`, `def `, `{`-JSON, `---`-YAML) räcker långt, med språkväljaren kvar som korrigering.

**U15 · Mobil är obrukbar i praktiken.** **[körd, 390×844]** Rutnätet kollapsar korrekt vid 750 px, men: navigationen bryter
rad så att "+ Ny kod" delas över två rader; tomtextens instruktion lyder "Ctrl+V" på en enhet utan Ctrl-tangent; Monaco har
inga touchvänliga markeringshandtag; och bindingpanelen hamnar under en editor med fast höjd, alltså långt under vikningen.
Åtgärd: byt till `<textarea>` under en brytpunkt, gör bindingpanelen till en flik eller ett utfällbart ark, och anpassa
tomtexten efter inmatningsmetod.

**U16 · Inget mörkt läge.** Ingen `prefers-color-scheme` finns i någon av CSS-filerna, och Monaco-temat `vault`
(`CodeEditor.tsx:23`) är hårdkodat till `base: 'vs'` med vit bakgrund. För ett kodverktyg är detta en av de mest efterfrågade
funktionerna. Färgerna ligger redan som CSS-variabler i `:root`, så arbetet är i huvudsak att definiera en andra uppsättning
och registrera ett mörkt Monaco-tema.

**U17 · Ingen ångerfunktion för destruktiva åtgärder.** Radera binding, ersätt utkast med en version och radera projekt (när det
kommer) är alla oåterkalleliga. Ett "Ångra"-meddelande som ligger kvar i 10 sekunder är billigare att bygga än ytterligare en
bekräftelsedialog och trevligare att använda.

**U18 · Editorn saknar vanliga reglage.** Radbrytning, teckenstorlek, minikarta och radnummer är hårdkodade
(`CodeEditor.tsx:42-47`).

> **Rättelse (verifierat i webbläsare).** Rapporten påstod först att Ctrl+H inte gör någonting eftersom
> bara `findController` importeras. Det stämmer inte: `findController.js` registrerar även
> `StartFindReplaceAction`, och Ctrl+H öppnar mycket riktigt sökrutan med ersättningsfältet utfällt.
> Bristen var att ingenting pekade på att funktionen fanns. Åtgärdat genom att kortkommandolistan
> nu har ett eget avsnitt för editorns egna kommandon.

**U18b · Editorn åt upp platshållaren man just skapat.** _(Hittades under genomförandet, inte vid den
första granskningen.)_ När en binding sparades bad appen editorn att visa den nya platshållaren, men
begäran låg kvar, och samma effekt kör om när texten ändras. Varje tangenttryckning därefter
markerade om platshållaren, så nästa tecken skrev över den. Att skriva en rad efter att ha skapat en
binding förstörde filen — `$p = "{{P_VALUE}}"` blev `$p = "q = "plain value here"`. Verifierat i
webbläsaren, både före och efter fixen. Begäran är nu ett engångskommando: editorn rapporterar när
den visat platshållaren och appen släpper begäran då.

**U19 · Ingen delvis kopiering.** Man kan inte markera ett stycke och kopiera bara det i sanerad form. Det är ett vanligt behov
när man frågar en AI om en enskild funktion.

**U20 · Gränssnittet finns bara på svenska.** All text är hårdkodad. Det är ett rimligt val för en enanvändarapp, men om
verktyget någon gång ska delas är strängextraktion mycket billigare att göra nu, vid 1 279 rader, än senare.

---

## 5. Tillgänglighet

**T1 · Flikarna saknar kopplade paneler.** `role="tab"` och `aria-selected` finns (`App.tsx:177`) men det saknas
`role="tablist"`-kopplade `aria-controls` och en `role="tabpanel"` runt editorn. Skärmläsare får ingen relation mellan flik
och innehåll.

**T2 · Upprepade knappnamn.** Varje bindingkort har en knapp som bara heter "Redigera" (`App.tsx:185`). Raderaknappen har
korrekt `aria-label` med bindingnamn — gör samma sak för redigeringsknappen.

**T3 · Bekräftelser via `window.confirm`.** Se U5. Native dialoger fungerar men bryter fokusordningen i förhållande till den
`<dialog>` som redan är öppen.

**T4 · Kontrast bör mätas.** `--muted: #627488` mot bakgrunden `#f3f6f9` ligger nära WCAG AA-gränsen för brödtext, och används
på flera ställen för liten text (`.editor-footer`, `.binding-actions small`, kortens datum). Mät och justera vid behov.

**T5 · Ingen hoppa-till-innehåll-länk** och ingen synlig fokusmarkering inuti Monaco utöver webbläsarens standard.

**T6 · Inga automatiska tillgänglighetstester.** `@testing-library` finns redan; `axe-core` skulle kunna köras mot de tre
huvudvyerna i samma testsvit.

---

## 6. Prestanda

**P1 · Allt räknas om vid varje tangenttryckning.** Det finns inte en enda `useMemo` eller `useCallback` i hela `src/ui/`.
Vid varje rendering av `App` körs `render()` **två gånger** över hela mallen (`App.tsx:91-92`), plus `usage()` och en
filtrering och sortering av alla bindings (rad 94-96).

**P2 · Läckagekontrollen är O(bindings × värden × textlängd).** `src/domain/render/index.ts:36-38` gör
`output.includes(value)` för varje värde i varje binding i **hela valvet**, vid varje rendering. Med hundra bindings och en fil
på några tusen rader blir det kännbart medan man skriver.
Åtgärd: kör den bara vid AI-kopiering och vid vybyte, inte vid varje tangenttryckning — eller flytta den till en web worker med
debounce. Överväg Aho–Corasick eller en enkel förfiltrering på minsta värdelängd.

**P3 · Kontextanalysen är kvadratisk.** `contextAt()` (`escape.ts:8`) läser källan från position 0 för varje platshållare.
En fil med många platshållare får O(n·m). En enda genomläsning som bygger ett kontextindex löser det.

**P4 · Alla bindings i valvet laddas alltid.** `App.tsx` anropar `storage.listBindings()` utan filter (rad 64, 72, 120, 135),
trots att `BindingFilter` finns och är implementerad. Det ger både P2-kostnaden och en funktionell bieffekt: ett värde i ett helt
annat projekts binding kan blockera kopiering i det öppna projektet, med ett meddelande som inte förklarar varifrån träffen kom.
(Att blockera över projektgränser kan vara önskvärt — men då bör det vara ett medvetet, dokumenterat val och meddelandet bör
säga vilket projekt värdet kommer från.)

**P5 · `removeBinding()` läser hela valvet.** `App.tsx:132` anropar `storage.exportAll()` bara för att räkna hur många
versioner som använder en binding. Kostnaden växer med hela valvets storlek. Använd `Version.bindingUsage`, som redan
beräknas och sparas vid varje `saveVersion()`.

**P6 · Startpaketet är 3,07 MB (805 kB gzip).** Monaco laddas ivrigt tillsammans med samtliga nio språkdefinitioner
(`CodeEditor.tsx:2-13`). Bygget varnar själv för detta. På GitHub Pages över en långsam uppkoppling är det märkbart.
Åtgärd: `React.lazy` runt `CodeEditor`, dynamisk import av språkdefinitionen först när språket väljs, och en enkel
`<textarea>`-fallback som visas tills editorn laddats. Det förbättrar dessutom U15.

---

## 7. Kodhälsa (kort — påverkar hastigheten på allt ovan)

- **K-a · `App.tsx` gör för mycket.** 207 rader, men 24 `useState`, routing, genvägar, kopiering, bindinghantering, service
  worker-registrering och fyra hela vyer i samma komponent. Rader på 400–900 tecken gör diffar svårlästa. Bryt ut routing,
  kopieringsflödet och de tre dokumentsidorna innan nya funktioner läggs till.
- **K-b · Ingen linter och ingen formatering.** Inget ESLint, inget Prettier, ingen CI-konfiguration i repot. Med en AI som ska
  arbeta vidare i koden är detta det billigaste sättet att hålla stilen enhetlig. Notera att den extremt täta stilen (flera
  satser per rad, kommaseparerade deklarationer) är medveten och konsekvent — välj formateringsregler som respekterar den, eller
  fatta ett uttryckligt beslut om att byta stil.
- **K-c · `zod` är ett beroende men används inte.** Avsett för importvalidering i M3 (F2). Antingen använd det eller ta bort det.
- **K-d · Död CSS.** `.rail`, `.rail-label`, `.rail-bottom`, `.file-panel`, `.file-current`, `.breadcrumb`, `.empty-vault`,
  `.editor-empty`, `.project-links`, `.flow`, `.dashboard-note`, `.panel-note`, `.local-dot`, `.dot-separator`, `.nav-active`,
  `.empty-symbol` finns i CSS men i ingen komponent. De är spår av en tidigare layout och gör det svårt att veta
  vad som är aktuellt.
- **K-e · Testluckor.** Bra täckning på domänen och lagringslagret. Otestat: routing och hash-navigering, versionshistorik och
  `useVersion`, projektpanelen, inställningssidan, genvägar, service worker-uppdateringsflödet, `BindingDialog`s validering i UI,
  samt `contextAt` för `shell`, `yaml` och `json` (bara PowerShell och JavaScript testas i dag). Det finns inget
  webbläsartest — Monaco mockas bort i det enda UI-testet, vilket är precis varför U3 och U4 aldrig upptäckts.
  Ett litet Playwright-test som kör de tre flöden som beskrivs i K1, U1 och U3 skulle ha fångat samtliga.
- **K-f · Escaping-luckor.** `contextAt` hanterar inte shell here-docs (`<<EOF`), reguljära uttryck i JavaScript, YAML:s
  blockskalärer (`|` och `>`), eller XML-kommentarer och CDATA (`xml` returnerar direkt på rad 9). Sista raden i `escapeValue`
  (rad 79-80) är en generisk reservregel som accepterar värden utan citattecken om de matchar ett snävt teckenmönster — den
  träffar bland annat `shell` utan citattecken, vilket är riskabelt.

---

## 8. Prioriterad åtgärdslista

Ordningen är vald efter _risk för användaren_ först, sedan _nytta per arbetsinsats_.

### P0 — Gör innan något annat

| ID  | Åtgärd                                                                           | Ungefärlig insats |
| --- | -------------------------------------------------------------------------------- | ----------------- |
| K1  | Ta bort det falska "Inga kända problem hittades" och visa faktisk skyddstäckning | Timmar            |
| F3  | `navigator.storage.persist()` + lagringsstatus i inställningarna                 | Timmar            |
| F2  | Export av valvet till JSON (import kan komma senare)                             | 1–2 dagar         |
| U1  | Förklara varför en kopieringsknapp är avstängd                                   | Timmar            |
| U3  | Klick i platshållare ska inte öppna modal                                        | Timmar            |

Efter P0 kan verktyget användas med riktiga värden utan att vara vilseledande eller riskera tyst dataförlust. Det är tröskeln
för att README ska kunna sluta rekommendera testvärden.

### P1 — Gör verktyget faktiskt användbart

| ID        | Åtgärd                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| F1        | Scanner med inbyggda regler, träfflista och "Skapa binding"-genväg              |
| F2        | Import med validering, förhandsgranskning och konflikthantering                 |
| U11       | Markera utbytta intervall i Local- och AI-vyerna                                |
| F22 + F23 | Etiketter vid versionssparning, klockslag i listan, diff mellan versioner       |
| F8 + F9   | Radera projekt; redigerbar metadata (namn, beskrivning, taggar, status)         |
| F19 + F20 | Bättre namn- och kategoriförslag; expandera markering till hela strängliteralen |
| U4 + U5   | Fokushantering i dialoger; ersätt `window.confirm` med `Modal`                  |
| F28       | Genvägsöversikt, och lös krockarna med Ctrl+K och Ctrl+Shift+C                  |

### P2 — Höjer verktyget från användbart till bra

| ID              | Åtgärd                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| F5 + F6         | Återmatchning vid retur från AI; AI-promptblock                                                |
| F7              | Flera filer per projekt                                                                        |
| F18             | Profiler, eller ta bort den falska profiletiketten                                             |
| U16             | Mörkt läge                                                                                     |
| P1–P6           | Memoisering, flytta läckagekontrollen ur skrivvägen, filtrerade bindings, koddelning av Monaco |
| F4              | Automatisk urklippsrensning                                                                    |
| F14 + F15 + F16 | Global bindinghanterare, namnbyte, ta bort med återställning                                   |
| U15             | Riktig mobilanpassning                                                                         |
| K-b + K-e       | Linter, formatering, CI och ett Playwright-test över huvudflödena                              |

---

## 9. Invarianter som inte får brytas

En AI som arbetar vidare i koden bör behandla följande som skyddade. De är genomtänkta beslut, inte tillfälligheter, och flera
av dem är dokumenterade i `DECISIONS.md`.

1. **Ingen nätverkstrafik.** `connect-src 'none'` i `index.html:5` och `scripts/check-network.mjs` som del av `pnpm build`.
   Nya beroenden får inte introducera `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` eller `sendBeacon`. Ingen extern
   font, inget CDN, ingen analys.
2. **Ingen kod körs någonsin.** Inga `eval`, ingen `new Function`, ingen körning av användarens kod för att validera den.
3. **Konservativ escaping.** Kontexter som inte kan hanteras säkert ska **blockeras**, inte gissas
   (`escape.ts:48-54`). Rendering ska aldrig substituera rekursivt.
4. **AI-vyn får aldrig innehålla ett privat värde.** Läckagekontrollen (`render/index.ts:35-39`) och det property-baserade
   testet i `render.test.ts:57-65` ska bestå. Om kontrollen flyttas för prestandans skull (P2) måste den fortfarande köras
   _före varje kopiering_.
5. **Felmeddelanden och problemobjekt får aldrig innehålla privata värden.** Verifieras av `render.test.ts:52-56`.
6. **Utkast skapar aldrig versionshistorik automatiskt.** `DECISIONS.md`, sektionen "Kod först och utkast".
7. **Revisionskontroll av utkast.** Föråldrade skrivningar ska avvisas (`DraftConflictError`), aldrig skriva över.
8. **Användarens text går aldrig förlorad vid ett lagringsfel.** Verifieras av `WorkspaceController.test.ts:55-64`.
9. **Copy Local med hemligheter kräver alltid ett andra, uttryckligt val.**
10. **Endast `dist/` publiceras till `gh-pages`.** Aldrig användardata, aldrig backupfiler.

---

## 10. Vad som redan fungerar bra

Detta står här för att en AI som ska förbättra verktyget inte ska bygga bort det som är bäst i det.

- **Domänlagret är rent och testbart.** `render()`, `escapeValue()` och `resolveBinding()` saknar DOM-beroenden och testas med
  property-baserade tester, inte bara exempel.
- **Escapingen är genomtänkt.** Den spårar kommentarer, escapade citattecken, PowerShell here-strings samt Pythons raw-, f- och
  trippelsträngar, och blockerar hellre än gissar. `contextAt` läser alltid originalkällan, aldrig den substituerade texten —
  det är rätt och lätt att råka bryta.
- **Lagringslagret är transaktionellt och har ett provideroberoende kontraktstest** som en framtida adapter kan köras mot utan
  ändringar.
- **`WorkspaceController` är korrekt skriven.** Serialiserade skrivningar, monoton revisionsräknare, väntande ändringar som töms
  efter en pågående skrivning, och tillstånd som överlever ett misslyckat anrop.
- **"Kod först"-flödet är rätt produktbeslut.** Att första inklistringen skapar projektet, i stället för ett formulär före
  arbetet, tar bort det största hindret för att komma igång.
- **Säkerhetstexterna är ärliga.** `Security.tsx` listar vad verktyget _inte_ skyddar mot, och formuleringen är
  "Inga kända problem hittades" snarare än ett garantipåstående. Bevara den tonen — det enda som behöver ändras är att beskedet
  faktiskt måste stämma (K1).
- **Byggkedjan verifierar sig själv.** Nätverksgranskningen och CSP-kontrollen som del av `pnpm build`, med en tydlig
  brasklapp om att det är en begränsad kontroll och inte ett bevis.
