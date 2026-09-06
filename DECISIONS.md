# Beslut

## 2026-09-05 — Specifikation v2 styr

Den bifogade kravspecifikationen är normativ. Den första, ej levererade Python-grunden ersattes av React + Vite + TypeScript, Monaco och Dexie. Appen publiceras på GitHub Pages; ingen alternativ hosting eller server används. Privata användardata ska aldrig läsas av utvecklingsverktygen eller checkas in.

## Leveransordning

M1 byggs och verifieras före M2. Senare funktioner introduceras inte i förtid. Datamodellen och StorageProvider har utrymme för senare milstolpar från början. M1 använder explicit lokal sparning. Debounced autosave införs i M3 enligt §18; ingen automatisk diskbackup införs.

## Konservativ escaping

Ambiguösa eller ej stödda strängkontexter behåller platshållaren med blockerande renderingsfel. Raw-läge kräver uttrycklig bekräftelse. Renderer kan inte bevisa att godtycklig kod är syntaktiskt eller semantiskt korrekt och kör aldrig kod för att kontrollera detta.

## Motsägelser och säkerhetsgränser

- §8.1 och §8.4 styr över M2-sammanfattningen: T3 är alltid ett förslag, aldrig automatisk matchning.
- §14.2 styr över §19 steg 17–20: Private Configuration Backup innehåller inte projektkod. Full Workspace Backup behövs för full återställning.
- `connect-src 'none'` och statiska bundletester är begränsade kontroller, inga garantier. CSP tillåter exempelvis lokala resurser; komprometterad appkod, tillägg och operativsystemet ligger utanför skyddet.
- IndexedDB är originbundet, inte sökvägsbundet: olika GitHub Pages-repon på samma `user.github.io` delar origin. Databasnamnet separeras per app-sökväg för att undvika oavsiktliga kollisioner, men detta är inte en säkerhetsgräns mellan appar på samma origin.
- Filer publicerade på GitHub innehåller endast appkod och syntetiska tester. IndexedDB är lokal klartext enligt §3.4; webbläsarsynk/OS-backup och urklipp ligger utanför appens kontroll.

## 2026-09-06 — Kod först och utkast

Startsidan är en arbetsyta i stället för ett projektskapande formulär. Första icke-tomma texten skapar ett `Namnlöst projekt`; namn och språk kan ändras efteråt. Utkast lagras i en separat IndexedDB-tabell efter 500 ms och får aldrig skapa versionshistorik automatiskt. Utkast har monoton revisionsräknare och stale writes avvisas.

Mina projekt är en snabb sökbar dialog och Alla projekt är en separat hash-route. Projektbyte flushar utkastet före läsning; navigering stoppas om flush misslyckas. Monaco-modeller hålls per arbetsyta/vy så editorhistorik och vyposition inte blandas ihop.

## 2026-09-05 — Rapportens åtgärdslista styr leveransordningen

Milstolpeordningen M1–M5 ersätts av den prioriterade listan i `FORBATTRINGSRAPPORT.md`. Skälet är att M1 levererade
ett verktyg som i sitt vanligaste flöde påstod att koden var granskad när ingenting var kopplat, och att valvet saknade
både backup och beständig lagring. Att bygga vidare på den ordningen hade betytt att fortsätta lägga funktioner ovanpå
ett felaktigt besked.

Två ordningsregler gäller oavsett vad som byggs härnäst:

- **Export före destruktivt.** Radera projekt och Rensa valvet får inte finnas innan det går att ta en backup.
- **Färgtokens före nya komponenter.** Varje ny komponent som skrivs innan färgerna är tokeniserade bidrar med nya
  hårdkodade värden som måste migreras en andra gång. Byggkontrollen fäller numera en färgliteral utanför en
  tokendefinition.

Kända defekter läggs in i Playwright-sviten som `test.fail()` innan de åtgärdas. CI förblir grön, buggen är dokumenterad,
och den commit som rättar den tar bort markören — historiken bär då beviset att felet fanns och sedan inte fanns.

## Beslut om urklippsrensning

Rensningen skriver bara över texten appen själv lade dit, när webbläsaren tillåter att urklippet läses. Nekas läsning
rensas ändå: nedräkningen är synlig hela tiden och går att avbryta, så användaren har haft sin chans att behålla det som
kopierats, och ett kvarlämnat lösenord är det värre utfallet. Utfallet redovisas i gränssnittet i stället för att antas.

## 2026-09-06 — Beslut fattade under genomförandet

**Nya språk blockerar hellre än gissar.** `dotenv`, `hcl` och `sql` har egna escaping-regler, och varje
regel vägrar de fall där rätt svar inte går att veta ur filen: ett `$` i en dubbelciterad `.env`-sträng
(många läsare expanderar `$VAR`, vilka går inte att se), ett bakstreck i en SQL-sträng (MySQL
escapar, standarden gör det inte), en apostrof i en apostrofciterad `.env`-sträng (den kan inte
representeras). Terraforms `${…}` och `%{…}` dubblas i stället för att escapas, annars kan ett
privat värde läsa en annan variabel.

**Introduktionen räknas som sedd när den visas, inte när den stängs.** Att skriva vid stängning
kapplöper med en omladdning gjord strax efteråt, och introduktionen kom då tillbaka för någon som
just hade avfärdat den. Ett befintligt valv startar med flaggan satt: en introduktion är värd att
visa före första användningen, inte för någon som använt verktyget i månader.

**Ångra fångar in vägen tillbaka före raderingen.** `captureProject` läser allt kaskaden tar med sig
och återställningen går genom `importAll`, alltså samma testade väg som en backupimport. Remsan är
en artighet, inte en garanti: raderingen har redan skett när den visas, och den ersätter ingen
bekräftelse.

**`contextAt` skrevs om under ett differentiellt property-test.** Modulen avgör hur ett privat värde
escapas, så omskrivningen jämförs mot implementationen som den såg ut före ändringen, kopierad ordagrant
in i testfilen. Den hittade omedelbart en riktig bugg. Kopian får tas bort den dag omskrivningen är
beprövad, och inte tidigare.

**Strängextraktionen har tre medvetna undantag.** Säkerhetssidan och introduktionen är dokument med
inbäddad markup; `shortcuts.ts` är redan en tabell där etiketten hör ihop med tangenten. Skälen står
i `src/ui/text.ts`.
