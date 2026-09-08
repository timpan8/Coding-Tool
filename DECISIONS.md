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

**Bindingdialogen visar ett fält och gömmer resten.** Det vanligaste fallet är värde markerat → namn →
klart, och efter etapp 1 och radkontexten finns inget kvar som måste rättas: namnet är fritt när det
föreslås, kategorin är läst ur raden och AI-värdet följer kategorin. Räckvidd, AI-värde, profilvärden,
escaping och beskrivning ligger bakom en fällning som är öppen när man redigerar en befintlig binding —
den som öppnar en sådan kom hit för ett av de fälten. AI-värdet står kvar på skärmen som text även när
det inte står där som ett fält: det är det enda fält som lämnar valvet, och att fälla undan är inte
detsamma som att dölja.

## 2026-09-06 — Gränssnittet tar CodeVaults form

En parallell implementation (`codevault/`, mergad i PR #7) hade ett gränssnitt som var lättare att
läsa: tre kolumner, två utgångar som inte går att förväxla, meddelanden som försvinner av sig
själva. Funktionaliteten i den här appen är större, så det är formen som flyttas hit, inte koden.

**Tre kolumner i stället för fem staplade paneler.** Versionshistoriken har fått en egen kolumn till
vänster; höger kolumn fäller sina sektioner med antalet i rubriken, bindings öppna som standard.
Problemlistan ligger alltid överst där när den finns, eftersom den blockerar kopiering. Under 1100 px
flyttar versionerna under editorn, under 750 px blir det en kolumn.

**Kopiera för AI kopierar direkt när inget kräver ett beslut.** Dialogen fanns för två saker: att
något i filen ser ut som en hemlighet, och att inget är skyddat fast koden har strängar som kunde
vara det. I båda fallen öppnas den fortfarande, med samma kvittens och samma nedladdning bakom den.
I det vanliga fallet — något är bundet, inga allvarliga fynd — är dialogen ett klick som inte
tillför något, och pressen kopierar och säger hur många värden som ersattes. Granskningen är
oförändrad: `auditForCopy` körs på texten som kopieras, och scannern körs synkront på samma text i
stället för att lita på panelens fördröjda lista. Filen går samma väg: "Spara AI-kopia som fil"
öppnar dialogen när granskning krävs och laddar ner direkt annars.

**Kopiera RIKTIGT armeras av ett tryck och kopierar på det andra.** Invariant 9 kräver ett andra
uttryckligt val före riktiga värden. Det valet var en dialog; nu är det ett andra tryck inom fem
sekunder, med checklistan mellan trycken: hur många bindings som har värde, vilka som saknar, vilka
kontexter som inte kan escapas, hur många riktiga värden som skrivs, vilken profil. Armeringen
släpper när texten eller vyn ändras. Dialogen finns kvar bakom "Visa detaljer" för den som vill ha
den långa versionen. Knappen är amber, en färg som varken den gröna AI-utgången eller den röda
Local-vyn använder.

**Meddelanden är toasts.** Remsan under sidhuvudet stod kvar tills någon stängde den, vilket läste
som ett tillstånd hos appen; "AI-kod kopierad" är inget tillstånd. En vägran är fortfarande ingen
modal (U6): den blir en varningstoast som stannar dubbelt så länge och behåller sin stängknapp.
Behållaren är en artig live-region, aldrig `alert`, så en ny toast inte avbryter det en skärmläsare
håller på med (A.7). Sparfelet och uppdateringsnotisen är tillstånd och står kvar som förut.

**Urklippsbannern säger sanningen om rensningen.** Den visas efter varje riktig kopia, även när
auto-rensning är av, med en knapp för att rensa nu. Misslyckas rensningen blir bannern röd och står
kvar tills urklippet faktiskt är rent; appen försöker igen när fliken får fokus. Noten om
urklippshistorik står där för att det är det enda en webbsida inte kan göra något åt.

**Paletten bytte värden, inte namn.** Tokennamnen och kopplingen grönt = AI, tegel = Local, gult =
varning är oförändrade; nya tokens finns bara för amber (`--real*`), status (`--ok*`) och
information (`--info*`). `contrast.test.ts` och `theme.test.ts` mäter fortfarande varje par.

## 2026-09-06 — Uppfångning vid inklistring

**Förkryssat, aldrig automatiskt.** Det som klistras in granskas, och panelen kryssar i förväg för
de fynd där raden själv sagt vad värdet är: en tilldelning till `password`, en `-Identity`, en
`-Server`. Ett rent mönsterfynd — en sökväg, en e-postadress i en kommentar — står okryssat.
Ingenting byts ut förrän någon trycker "Skapa N bindings", och det som byttes går att ångra i ett
steg. Blocklistan är fortfarande undantaget: där är beslutet redan fattat, och den byter direkt.
Förkryssningen sker en gång per inklistring, den första gången skanningen har något att visa, och
rör aldrig kryssrutorna igen: att kryssa ur en rad är ett beslut, och skanningen körs på varje
tangenttryck.

**Var i koden, inte bara vad.** Varje rad i panelen visar raden värdet står på, med värdet självt
maskerat och resten av raden som den är — resten står redan i editorn. Att peka på raden tonar
spannet i editorn, att klicka rubriken markerar det. Editorn fick ett `focusRange` med nonce för
det, eftersom `focusLine` inte kunde be om samma rad två gånger.

**Regler som läser raden.** Användarnamn, server, domän och tenant-id fångas på tilldelningar och
PowerShell-parametrar, inte bara på värdets form, för det är formen på ett skript skrivet för en
miljö. Ett fynd inuti ett annat fynd rapporteras inte: `dc01.corp` inuti `dc01.corp.local` är
samma värde sett av en smalare regel, och att binda båda hade förstört mallen. Entropiregeln får
inte vinna på bredd — den ser `Source=sql01.corp.local` som en körning och skulle annars sluka
servernamnet en regel kan namnge. Verktygets egna exempelvärden är aldrig fynd: `example.user` i
en tilldelning är hur en sanerad fil ser ut, och att rapportera den hade lärt folk att avfärda
panelen. Personnumret kontrollräknas med Luhn, så ett ordernummer med datumform inte kallas person.

**Ett AI-värde per binding.** Två bindings med samma AI-värde är ett värde i AI-kopian, och när
koden kommer tillbaka kan återmatchningens nivå två inte skilja dem åt. Generatorn ger därför ett
värde som ingen annan binding använder, format efter det riktiga värdet — adress för adress, GUID
för GUID, fullt värdnamn för fullt värdnamn — i reserverade namnrymder. Den första i en serie
behåller kategorins gamla standardvärde, så en binding gjord i dag läser som en gjord i går.
Dialogen varnar när ett AI-värde redan används, men vägrar inte: den som skriver in det kan ha
ett skäl.

**Sanera text sparar ingenting.** Felmeddelanden, transcript och kommandoutdata bär samma värden
som skripten men är inga skript. Sidan kör valvet över vilken text som helst: kända riktiga värden
byts mot sina AI-värden, blocklistan tillämpas, resten granskas av samma regler. Kopieringen går
genom samma exaktvärdeskontroll som ett projekt, och ett värde som ändå står kvar stoppar den. Att
binda därifrån ger en global binding, eftersom ett värde mött i ett felmeddelande inte hör till
något projekt.

## Piller i editorn och diff-statistik som versionsnot

**Pillret är tre dekorationer och en injicerad text, inte en widget.** Monaco kan inte byta ut
text mot ett element i en redigerbar modell utan att markören, ångra-stacken och varje offset
ändrar betydelse. Klamrarna dämpas, namnet får kategorins färg som bakgrund och AI-värdet står
efter som injicerad text — den finns inte i modellen, så `getOffsetAt` och `Ctrl+B` räknar som
förut, och markören stannar aldrig i den (`cursorStops: None`). I Local- och AI-vyn bär det
utbytta värdet i stället bindingens namn på samma sätt, så en projektion läser vad ett värde är
utan att någon behöver hålla muspekaren stilla.

**Kortet visar det riktiga värdet på begäran och i en minut.** Värdet finns redan i Local-vyn på
samma maskin; det kortet lägger till är att det syns bredvid platshållaren utan att vyn byts.
Det går inte att markera, så en visning blir aldrig en kopia av misstag, och det döljs igen efter
60 sekunder eller när kortet stängs. "Ta bort platshållaren" skriver tillbaka värdet på just den
platsen, inte överallt — det är vad radering av bindingen gör — och erbjuder ångra. Kortet är
bundet till texten det öppnades i: en ändring eller ett vybyte gör spannet till en gissning, och
då försvinner kortet hellre än pekar fel.

**Etiketten som ingen skrev är raddiffen.** En version utan etikett hette "Utan etikett", och två
sparningar samma dag gick inte att skilja åt. Nu får en tom etikett `+n −m` mot versionen
utkastet bygger på, räknat med en rad-LCS så en insättning högst upp inte kallar varje rad under
ändrad; den första versionen får filens storlek. Dialogen säger vad som skrivs om fältet lämnas
tomt, så det aldrig kommer som en överraskning i historiken. Samma tal står vid varje version i
listan.

## Kryptering är valbar, och klartext är fortfarande standard

**Standard är klartext, för att appen ska gå att förlora.** Ett valv utan lösenord kan inte bli
oåtkomligt: rensad webbläsardata kostar dig valvet, men ingen glömd hemlighet gör det. Kryptering
är ett val med ett pris, och priset står i dialogen innan den frågar: förlorat lösenord plus
förlorad återställningsnyckel är ett förlorat valv, och appen har ingen kopia av något av dem.
Därför finns nyckeln, den visas en gång med en nedladdningsknapp, och dialogen stänger inte förrän
du kryssat att du sparat den. Den går att visa igen — för den som kan lösenordet.

**Rad för rad, inte databas för databas.** Dexie måste kunna hitta en post utan nyckel:
`versions.where('projectId')` kan inte fråga ett låst valv vad en rad innehåller. Därför ligger
id:n, tidsstämplar, utkastets revision och `number` kvar i klartext, och allt annat flyttar in i
ett `enc`-fält med AES-256-GCM och AAD `tabell:id`, så en rad inte kan flyttas till en annan post.
Det som syns utan nyckel är alltså att ett projekt finns och när det ändrades — aldrig vad det
innehåller. Kontraktstestet körs i båda lägena, för en fråga som läser ett krypterat fält inuti en
transaktion ska falla i testet och inte framför en användare. `Dexie.waitFor()` finns runt varje
`crypto.subtle`-väntan inuti en transaktion; utan den commitar transaktionen under fötterna på oss.

**Låset tömmer, det gömmer inte.** Att låsa skriver först ut osparad text (invariant 8: går det
inte, låses valvet inte alls), och därefter kastas nyckeln, sessionen, bindings, profiler,
blocklistan och reglerna. Låsskärmen är hela appen — inget skal med gammal data bakom. Temat,
teckenstorleken och auto-låsets tid ligger kvar i klartext, eftersom de behövs innan något
lösenord finns att fråga efter.

**Fältet är inte `type="password"`.** Det är just det som får en lösenordshanterare att erbjuda sig
att spara huvudlösenordet till ett lokalt valv, bredvid datan det skyddar. Tecknen döljs med CSS,
autofyll avvisas, och en knapp visar dem — vilket är fallet hanterarens egen visning hade täckt.

**En krypterad export är krypterad.** En backup som lämnar skyddet kvar i webbläsaren är precis det
hål krypteringen skulle täppa till. Filen bär valvets egen nyckelinpackning, så den öppnas med
samma lösenord eller återställningsnyckel på vilken maskin som helst, och innehållet är exakt det
klartextsnapshot schemat redan känner till. Klartextexport finns kvar bakom en uttrycklig varning.
Import känner igen kuvertet på filen själv, inte på filnamnet.

**"Rensa hela valvet" behåller huvudet.** Ett valv någon valt att kryptera ska inte skriva nästa
sak i klartext för att det råkade tömmas. Detsamma gäller en ersättande import: den återställer
innehåll, aldrig nyckeln som öppnar det. Den som tappat både lösenord och nyckel kommer vidare med
en fullständig återställning, som tar bort huvudet också.

## Utgående skydd: fler former av samma värde, pensionerade värden, en märkning

**Grinden är fortfarande exakt.** Varje sträng kontrollen letar efter är härledd ur ett värde valvet
känner: base64 i UTF-8 och UTF-16, URL-kodning, JSON- och HTML-escaping, backtick, dubblerade
apostrofer, regex-escaping. Ett träff är därför fortfarande "det här exakta värdet står i utdatan",
aldrig en gissning — men ett värde slutar inte vara sitt värde för att någon base64-kodade det på
vägen ut. Långa base64-körningar avkodas dessutom och genomsöks, vid varje teckenalignment, eftersom
ett värde kan ligga mitt i en `-EncodedCommand`. Ett värde under fyra tecken får inga varianter: det
skulle matcha halva filen, och den exakta formen stoppar det ändå. Meddelandet säger vilken form
värdet hittades i men aldrig värdet och aldrig den kodade texten — invariant 5 gäller båda.

**Pensionerade värden bevakas för alltid.** Ett roterat lösenord är fortfarande lösenordet som satt
på kontot förra veckan, och kod skriven då bär det. När en bindings värde byts flyttar det gamla till
`retired` och fortsätter blockera AI-kopiering. Att byta värde är också det som rensar
exponeringsflaggan: "roterad" betyder att du har bytt det på riktigt, inte att appen kontrollerat
något — appen kan inte det och påstår det inte.

**Exponering är ett faktum, inte en dom.** Klistras kod in som AI-svar och den bär ett riktigt värde,
märks bindingen med datumet. Panelen visar det tills värdet byts. Ingenting blockeras: texten finns
redan på maskinen, och det som är kvar att göra ligger utanför appen.

**Sentinelraden gör två små saker.** Kopiera RIKTIGT lägger `# [REAL VALUES - never paste into AI] v1`
överst (i filens kommentarsyntax, utelämnad i språk som saknar en). Den som hittar filen senare vet
vad den bär, och appen känner igen den om den klistras in som AI-svar — vilket är ett misstag värt att
fånga, eftersom värdena i den aldrig var sanerade. Valbar, på som standard.

**Sökvägar skrivs mot en rot.** En binding kan hålla `{{ROOT}}\AdSync` i stället för en fast sökväg;
byter du arbetsmapp följer alla med. En nivå och bara `{{ROOT}}` — invariant 3 står kvar, och en rot
som själv innehöll en platshållare vore rekursiv substitution igen. Det lagrade värdet hålls i takt,
så en kontext utan rot (en äldre export, en annan flik mitt i ändringen) fortfarande löser till något
sant. En hittad filsökväg binds som sin katalog: mappen tillhör den här maskinen, filnamnet tillhör
koden, och en AI som döper om loggfilen ska få göra det.

## Offline-skalet får gå till nätet när cachen fattas

Service workern svarade `Response.error()` när en fil ur app-skalet saknades i cachen. Tanken var
att en fil utanför skalet aldrig ska hämtas, men följden blev värre än problemet: cachen är inte
garanterad. Webbläsaren vräker CacheStorage när utrymmet tryter, och en installation som avbryts
lämnar poster som aldrig skrevs. Då svarade workern fel på varje förfrågan, för alltid — appen gick
inte att nå, och en omladdning hjälpte inte, eftersom det är workern själv som svarar. Enda vägen
ut var att veta att man skulle avregistrera den i utvecklarverktygen, vilket ingen användare vet.

Nu hämtas filen från samma origin som appen laddades från, och läggs tillbaka i cachen så nästa
start fungerar offline igen. Det är exakt vad webbläsaren hade gjort utan worker. Gränsen är
oförändrad: bara filer i `ASSETS` passerar, alltså appens eget skal — användarens kod och värden
hamnar aldrig i CacheStorage och hämtas aldrig över nätet. `check-network.mjs` undantar `sw.js`
från förbudet mot `fetch` just därför att en worker utan `fetch` inte kan laga sig själv.

Ett e2e-test tömmer cachen som en webbläsare under utrymmesbrist gör och kräver att appen ändå
startar. Utan rättningen faller det på `net::ERR_FAILED` vid omladdningen.
