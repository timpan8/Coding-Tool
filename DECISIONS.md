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
