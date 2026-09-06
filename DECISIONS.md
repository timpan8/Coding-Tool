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

## 2026-09-06 — Funktionsförslagen

**Ett föreslaget bindingnamn är alltid ett namn som går att spara.** `suggestBinding` tar emot valvets
bindings och räknar upp tills namnet är fritt enligt exakt samma jämförelse som `validateBinding` gör.
Alternativet — att låta förslaget krocka och avvisas vid sparning — lade ett fel på användaren som
användaren inte orsakat och inte kunde rätta utan att hitta på ett namn själv. Varje väg som skapar en
binding programmatiskt (blocklistan, en scannerträff) ärver samma uppräkning.

**"Behåll båda" gäller bara projekt och bindings.** En kopia behöver ett nytt id som ingenting annat
pekar på. En version är numrerad i sitt projekt och utpekad av `currentVersionId`, ett utkast är
nycklat på sitt projekt, en profils värden ligger i de bindings som nycklar dem på dess id, ett
dataset hör till ett projekt, och en regel kopierad två gånger rapporterar varje fynd två gånger.
Listan står i `domain/snapshot`, dialogen namnger de slag som inte kan kopieras innan man väljer, och
två tester håller ihop listan med vad importen faktiskt gör. Att tyst falla tillbaka till "behåll
valvets" var att ge ett annat svar än det användaren gav.

**Ersätt-läget erbjuds inte för en privat export.** Filen bär inga projekt, versioner eller utkast, och
`importAll` tömmer varje tabell i det läget. Att tillåta kombinationen hade raderat allt arbete och
lagt tillbaka enbart de privata värdena.

**Rensningen tar också det som ligger utanför Dexie.** Temavalet i `localStorage`, service workern och
dess cachade kopia av appen. Avgränsat till den här installationen och aldrig hela origin: databasnamnet
bär `location.pathname`, så en andra kopia av appen under en annan sökväg är ett annat valv. Dialogen
räknar upp både vad som försvinner och vad som inte gör det — ett påstående som är bredare än vad koden
gör är samma sorts defekt som ett som är för smalt.

**Blocklistan ersätter vid inklistring, inte vid kopiering.** En term blir en binding i samma stund
texten landar i arbetsytan. Därmed går den genom allt som redan finns: `render()` escapar värdet efter
språk, `auditForCopy` räknar den som vilket privat värde som helst, `ingest()` hittar tillbaka från
AI-värdet, och täckningsräkningen ser den. Alternativet — att byta ut vid kopiering — hade krävt en ny
hake förbi `auditForCopy`, en egen escaping-lösning för text som aldrig gått genom `contextsAt`, och
täckning av fem separata kopieringsutgångar; invariant 3 och 4 hade båda behövt bevisas om.

**En blocklistbinding är global.** Beslutet "den här termen får aldrig nå en AI" gäller hela valvet och
inte ett projekt. Det gör också att samma term känns igen i nästa projekt i stället för att samla en
binding per projekt.

**Två skiftlägen av en term är två värden.** Matchningen ignorerar skiftläge, men Local ska ge tillbaka
filen tecken för tecken. `Anna` och `anna` får därför var sin binding i stället för ett gemensamt värde
som hade skrivit tillbaka fel stavning i användarens egen kod.

**Blocklistan följer med i båda backupformerna.** Termen är ett privat värde med ett beslut vidhängt,
alltså samma familj som bindings, profiler och regler. Utan det hade svaret på "kommer allt tillbaka?"
blivit nej dagen listan togs i bruk.

**Appen erbjuder där den förut bara vägrade.** Läckagekollen har hela tiden vetat vilken binding som
äger ett värde den hittar; den kunskapen användes bara till att blockera kopieringen. Nu erbjuds
bytet också: i bindingdialogen när markeringen redan finns i valvet, och i problemlistan när ett känt
värde ligger oskyddat i mallen. Det är ett val och aldrig automatik — samma gräns som DECISIONS.md
sedan tidigare drar för återmatchningens tredje nivå. Erbjudandet visas bara där appen faktiskt kan
rätta det: bindingen måste gå att lösa upp här och värdet måste finnas kvar i mallen.

**"Ersätt alla förekomster" är avmarkerad som standard och räknar de andra.** Den räknade tidigare
med den markerade förekomsten, så ett unikt värde erbjöd sig att ersätta "alla identiska förekomster
(1 st)". Att skriva om varje förekomst i filen är dessutom ett beslut, och förhandsvisningen ovanför
rutan visar bara en rad av det.

**Återmatchningen jämför mot mallen den ersätter.** Kod som kommer tillbaka med det riktiga värdet där
platshållaren stod matchar ingen nivå, så rapporten löd "0 platshållare på plats, 0 att granska" och
"Ersätt mallen" tog bort skyddet utan ett ord — den farligaste händelsen i hela rundturen, och den enda
helt tysta. `ingest` tar nu emot den gamla mallen och räknar vilka platshållare som inte kom hem.
Ersättningen tillåts fortfarande: koden är användarens, och en varning som blockerar är en varning som
kringgås. Knappen säger däremot vad den gör.

**Entropiregeln viker för en regel som kan namnge värdet.** Den är reservregeln för värden ingenting
kan sätta namn på. Ett GUID rapporterat som "slumpmässig sträng" får `<SECRET>` som AI-värde i stället
för ett GUID, och en JWT kallades också slumpmässig sträng. Namnet är det användbara: mellan två regler
som båda namnger värdet avgör allvarlighetsgraden fortfarande, och ingenting här blockerar en
kopiering ändå.

**Kategorin läses ur raden, inte ur markeringen ensam.** Flera regler handlar om tilldelningen och inte
om värdet — `password = "…"` är det som gör `Hunter2!` till en hemlighet, medan `Hunter2!` för sig är
ett ord med en siffra i. Bara fynd som täcker markeringen räknas, så en annan variabel på samma rad
inte kan kategorisera den av misstag.

**Klumpen från scannern öppnar ingen dialog.** Regeln har redan sagt vad värdet är och vad en AI får se
i stället; det finns inget beslut kvar som dialogen skulle hämta. Att ångra tar bort bindingarna också,
eftersom de skapades utan att någon fick se dem. Dialogen finns kvar för en i taget, där poängen är att
titta på den.

**Backuppåminnelsen tjatar inte.** Sidan säger hur gammal den senaste filen är och överlämnar
bedömningen till den som vet vad som hänt sedan dess. Tidsstämpeln skrivs efter att filen lämnats över,
så en misslyckad export inte nollställer den.
