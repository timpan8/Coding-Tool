# Designsystem — AI Code Vault

Detta dokument är **härlett ur koden**, inte påhittat. Varje skala nedan är uppmätt i
`src/ui/styles.css` (1193 rader) och `src/ui/code-first.css` (942 rader). Där jag föreslår en
normalisering står den under rubriken _Förslag_ och är alltid räknad så att den flyttar så få
befintliga värden som möjligt.

Stacken har inget UI-bibliotek och ingen CSS-in-JS: allt är handskriven CSS med custom properties.
Det här dokumentet beskriver systemet som redan finns.

---

## 1. Färg

### 1.1 Struktur

Färg är helt tokeniserad. Alla 44 tokens definieras tre gånger — en gång ljust på `:root`
(`styles.css:2-66`), en gång för systemets mörka läge (`styles.css:72-125`) och en gång för
explicit mörkt val (`styles.css:126-176`). Kommentaren på `styles.css:67-70` beskriver regeln som
gäller:

> _"Tokens only: no component rule is redefined here, so the two themes cannot drift."_

Regeln hålls. Ingen komponentregel definierar om sig per tema, och byggsteget kontrollerar det —
`scripts/check-network.mjs` rapporterar _"colours confined to token definitions"_. **Det här är
systemets starkaste del och bör inte luckras upp.**

### 1.2 Tokens

Ljust värde först, mörkt inom parentes.

**Ytor**

| Token              | Ljus      | Mörk      | Används till                    |
| ------------------ | --------- | --------- | ------------------------------- |
| `--bg`             | `#f4f6f8` | `#0f1216` | Sidbakgrund, `main`             |
| `--surface`        | `#ffffff` | `#171b21` | Kort, paneler, topbar, knappar  |
| `--surface-raised` | `#f9fafb` | `#1c2128` | Upphöjda ytor, toasts, utgångar |
| `--surface-sunken` | `#eef1f4` | `#12161b` | Nedsänkta ytor, aktiv navflik   |
| `--surface-hover`  | `#e9edf1` | `#222830` | Hover på knapp och nav          |

**Linjer**

| Token             | Ljus      | Mörk      | Används till                       |
| ----------------- | --------- | --------- | ---------------------------------- |
| `--border-subtle` | `#e6e9ee` | `#222831` | Svaga avdelare, `.count`-bakgrund  |
| `--border`        | `#d9dde3` | `#2c333c` | Standardram på knapp, kort, dialog |
| `--border-strong` | `#c3c9d2` | `#3b444f` | `input`, `select`                  |
| `--focus-ring`    | `#1f6feb` | `#4c8dff` | Fokusmarkering                     |

**Text** — fem nivåer, varav tre ligger mycket nära varandra.

| Token           | Ljus      | Mörk      | Används till                              |
| --------------- | --------- | --------- | ----------------------------------------- |
| `--text-strong` | `#0f1216` | `#f2f4f7` | Rubriker, projektnamn, varumärke          |
| `--text`        | `#1a1d21` | `#e6e8eb` | Brödtext, knapptext                       |
| `--text-muted`  | `#5c6470` | `#9aa3ad` | `p`, `.muted`, `.eyebrow`, `.text-button` |
| `--text-subtle` | `#5a626d` | `#98a1ab` | `small`, sidfot, `.paste-prompt`          |
| `--text-faint`  | `#616a76` | `#8f98a3` | `.bindings-empty`, radnummer i editorn    |

> **Observation:** `--text-muted`, `--text-subtle` och `--text-faint` ligger inom några procent i
> luminans. Tre tokens gör i praktiken ett jobb. Det är ingen bugg, men det är tre namn att välja
> mellan där ett hade räckt — se §6. Alla tre klarar AA mot `--surface`, `--bg` och `--surface-raised`;
> `src/ui/contrast.test.ts` mäter det.

**Typsnitt** — `--font` `system-ui, "Segoe UI", Roboto, sans-serif` · `--mono` `Consolas, "Cascadia Mono",
"Courier New", monospace`. Definierade på `html`, inte i tokenblocket, så att temat­esterna räknar färger.

**Accent (grön) — delas med AI-projektionen**

`--accent` `#067647` (`#1f9e63`) · `--accent-hover` `#05603a` (`#27b874`) · `--accent-fg` `#ffffff`
(`#06170e`) · `--accent-text` `#067647` (`#32d583`) · `--accent-bright` `#0f6e4a` (`#32d583`) ·
`--accent-muted` `#3f7a5f` (`#7fb99c`) · `--accent-on-dark` `#32d583` (samma i båda) ·
`--accent-glow` `#6fcf9f` (`#1f9e63`) · `--accent-surface` `#e8f7ee` (`#0d2a1c`) ·
`--accent-surface-strong` `#d3f0e0` (`#123a27`) · `--accent-border` `#b3e2c8` (`#1f5a3c`) ·
`--accent-border-strong` `#7fcfa3` (`#2a7a52`)

**Fara (röd/tegel) — delas med Local-projektionen**

`--danger` `#b42318` (`#d9463a`) · `--danger-strong` `#9f1e14` (`#e45a4f`) · `--danger-text`
`#b42318` (`#f97066`) · `--danger-muted` `#9c5a4e` (`#b58a84`) · `--danger-surface` `#fdeceb`
(`#2d1412`) · `--danger-surface-strong` `#f8d5d2` (`#3b1b18`) · `--danger-border` `#f1b3ad`
(`#5a2a25`) · `--danger-border-strong` `#d5463b` (`#8a3a32`)

**Varning** — `--warn-text` `#b54708` (`#f79009`) · `--warn-surface` `#fff4e5` (`#2a1d0b`) ·
`--warn-border` `#f6d4a8` (`#5a3d12`)

**Riktig kopia (amber)** — `--real` `#b54708` (`#f79009`) · `--real-hover` `#9a3c06` (`#ffa726`) ·
`--real-fg` `#ffffff` (`#0b1220`) · `--real-surface` `#fff4e5` (`#2a1d0b`) · `--real-border` `#f2bf7a`
(`#6b4a12`). Bara knappen "Kopiera RIKTIGT", dess checklista och urklippsbannern. Den ska varken kunna
förväxlas med den gröna AI-utgången eller den röda Local-vyn.

**Status och information** — `--ok` `#067647` (`#32d583`) · `--ok-surface` `#e8f7ee` (`#0d2a1c`) ·
`--info-text` `#1f4fa3` (`#8fb4ff`) · `--info-surface` `#e8f0fe` (`#12213a`) · `--info-border` `#c5d8fb`
(`#1f3a66`). Toasts och statusmarkörer.

**Djup** — `--shadow-xs` `#10233304` · `--shadow-sm` `#10233318` · `--shadow-md` `#10233340` ·
`--scrim` `#10233325` · `--backdrop` `#10233380`. I mörkt läge byts basen mot ren svart.

### 1.3 Den semantiska kopplingen

Färgsystemet bär appens viktigaste begrepp och det är medvetet gjort:

- **Grönt = AI-projektionen** (ofarlig, delbar). `button.ai-copy`, `.mode-ai`, accentknappar.
- **Rött/tegel = Local-projektionen** (riktiga värden, farlig). `.mode-local`, `button.danger`,
  `.danger-text`.
- **Gult = varning som inte blockerar.** `.notice`, `.inline-warning`, `.finding`.

Håll den kopplingen. Att använda accentgrönt för en Local-handling eller tegelrött för en AI-handling
bryter det enda mönster i appen som användaren lär sig utan att läsa.

---

## 2. Spacing

### 2.1 Vad som faktiskt finns

Uppmätt över `padding`, `margin` och `gap` i båda stilmallarna: **334 förekomster fördelade på 33
olika px-värden.** Det finns alltså ingen spacing-skala i dag — varje heltal från 1 till 18 används.

```
 1px  ██████ 6          10px  ██████████████████████████████████████████████████ 50
 2px  ████████ 8        11px  █████████ 9
 3px  ██████ 6          12px  ███████████████████████ 23
 4px  ███████████████████ 19   13px  ██ 2
 5px  █████████████████ 17     14px  ███████████████████ 19
 6px  ██████████████████ 18    15px  █████████████████ 17
 7px  ████████████████ 16      16px  ███████████ 11
 8px  ██████████████████████████ 26   17px  █ 1      18px  ████████████████ 16
 9px  ████████████ 12          20px 9 · 22px 7 · 23px 2 · 24px 3 · 25px 9 · 26px 2
                               28px 3 · 30px 11 · 32px 3 · 35px 2 · 38px 1 · 40px 2
                               45px 1 · 50px 2 · 60px 1
```

Tyngdpunkten ligger på **10, 8, 12, 4, 14, 6, 5, 15, 7, 18** — tillsammans 217 av 334 förekomster.

### 2.2 Förslag: skala härledd ur tyngdpunkten

```css
--space-1: 2px;
--space-2: 4px;
--space-3: 6px;
--space-4: 8px;
--space-5: 10px;
--space-6: 12px;
--space-7: 16px;
--space-8: 20px;
--space-9: 24px;
--space-10: 30px;
```

Den skalan är vald för att flytta så lite som möjligt, inte för att vara vacker:

|                              | Andel av 334 förekomster |
| ---------------------------- | ------------------------ |
| Träffar exakt, ingen ändring | **178 (53 %)**           |
| Flyttas ≤ 1 px               | 97 (29 %)                |
| Flyttas ≤ 2 px               | 50 (15 %)                |
| Flyttas > 2 px               | **9 (3 %)**              |

82 % av all spacing i appen ändras alltså med högst en pixel. En klassisk 4-punktsskala
(4/8/12/16/20/24/32) hade träffat exakt på bara 28 % och flyttat 18 förekomster mer än 2 px —
dubbelt så mycket rörelse för samma nytta.

Det här är ett städjobb i storleksordningen M och bör göras i en egen commit utan andra ändringar,
så att en visuell diff faktiskt går att granska.

---

## 3. Typografi

### 3.1 Familj

```css
font-family: Inter, "Segoe UI", Arial, sans-serif; /* styles.css:3 */
font-synthesis: none; /* styles.css:4 */
```

Inter laddas **inte** — appen får inte hämta externa fonter (`font-src 'self'` i CSP:n,
`index.html:7`). Inter används alltså bara av användare som råkar ha den installerad lokalt; alla
andra får Segoe UI eller Arial. Kodytor använder `Consolas, monospace` (t.ex. `styles.css:936`).

> **FRÅGA:** Är `Inter` först i stacken ett medvetet val (gratis förbättring för den som har den),
> eller en rest från ett bygge som laddade fonten? Om det är avsiktligt bör det stå i en kommentar —
> annars är risken att någon "fixar" det genom att lägga till en `@font-face` och därmed bryter CSP:n.

### 3.2 Vad som faktiskt finns

**25 olika font-size-värden.** Rubriknivåerna:

| Element           | Storlek                                      | Vikt | Fil:rad          |
| ----------------- | -------------------------------------------- | ---- | ---------------- |
| `h1`              | `1.9rem` (30,4 px), `letter-spacing: -0.8px` | 650  | `styles.css:254` |
| `h2`              | `1.05rem` (16,8 px)                          | ärvd | `styles.css:260` |
| `h3`              | `1rem` (16 px)                               | ärvd | `styles.css:263` |
| `.panel-title h2` | `0.85rem` (13,6 px)                          | ärvd | `styles.css:789` |

> **Observation:** Steget `h1 → h2` är 1,81× medan `h2 → h3` är 1,05×. Visuellt finns alltså två
> rubriknivåer, inte tre — `h2` och `h3` går inte att skilja åt på storlek. Se UX-AUDIT.md.

De sex vanligaste storlekarna bär nästan hela gränssnittet, och alla är under 16 px:

| rem      | px   | Antal | Används av                                 |
| -------- | ---- | ----- | ------------------------------------------ |
| `0.75`   | 12,0 | 26    | Metadata, kortdetaljer, `small`            |
| `0.7`    | 11,2 | 15    | `.text-button`, `.count`, `.issue-panel p` |
| `0.8125` | 13,0 | 12    | Paneltext                                  |
| `0.875`  | 14,0 | 11    | **`button`**, `.notice`                    |
| `0.8`    | 12,8 | 10    | `.topbar`, `.check`, `.inline-notice`      |
| `0.65`   | 10,4 | 9     | `.eyebrow`-syskon, `.editor-tools`         |

Basen är 16 px (`styles.css:5`) men används nästan aldrig för text — bara `h3` och fem andra ställen
landar på `1rem`.

### 3.3 Förslag: sju steg i stället för 25

```css
--text-2xs: 0.6875rem; /* 11px — badge, kbd, tertiär metadata     (ersätter 0.65–0.72) */
--text-xs: 0.75rem; /* 12px — metadata, small                  (behålls)            */
--text-sm: 0.8125rem; /* 13px — paneltext                        (ersätter 0.78–0.8)  */
--text-base: 0.875rem; /* 14px — knappar, brödtext i UI           (ersätter 0.85–0.9)  */
--text-md: 1rem; /* 16px — h3, längre brödtext              (ersätter 0.925–1.05)*/
--text-lg: 1.4rem; /* 22px — h2 i dokumentvyer                (ersätter 1.2–1.5)   */
--text-xl: 1.9rem; /* 30px — h1                               (behålls)            */
```

Sammanslagningarna ovan flyttar ingen storlek mer än 1,6 px. Insats: M.

**Vikter:** 400 (11×), 500 (2×), 600 (12×), 650 (6×), 700 (1×). Fem vikter på en font-stack där
`font-synthesis: none` gäller betyder att systemfonter som saknar 650 tyst faller till närmaste
riktiga snitt. Förslag: behåll 400 / 600 / 650 och ta bort 500 och 700 — de har två respektive en
användning och tillför ingen nivå som inte redan finns.

**Line-height:** 1.5 (bas), 1.55, 1.6 (2×), 1.75, 1 (`.brand-icon`). Förslag: `1.5` för UI-text,
`1.6` för läsbar löptext i `.document`, `1` för ikoner. De två varianterna 1.55 och 1.75 tillför
inget.

---

## 4. Form och djup

### 4.1 Border-radius

Tio värden i dag: 2, 3, 4, 5, 6, 7 (10×), 8 (13×), 12, 15, 20.

Mönstret bakom dem är tydligt när man sorterar efter användning:

| Roll             | Värde           | Exempel                                                  |
| ---------------- | --------------- | -------------------------------------------------------- |
| Liten kontroll   | `4px`           | Chips, taggar, små markeringar                           |
| Standardkontroll | `6px`           | `input`, `select` (`styles.css:857`)                     |
| Knapp            | `7px`           | `button` (`styles.css:194`)                              |
| Kort och panel   | `8px`           | Projektkort, bindingkort, findings                       |
| Dialog           | `12px`          | `dialog` (`styles.css:962`)                              |
| Pill             | `15px` / `20px` | `.count` (`:796`), `.status-pill` (`code-first.css:741`) |

**Förslag:** `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`, `--radius-xl: 12px`,
`--radius-pill: 999px`. Det slår ihop 6/7 till ett värde och 15/20 till en äkta pill. Insats: S.

### 4.2 Skuggor

Skuggor används sparsamt och alltid via token:

- `box-shadow: 0 20px 80px var(--shadow-md)` — `dialog` (`styles.css:965`)
- Kort och paneler använder `--shadow-xs` / `--shadow-sm`

Behåll det. Djup görs i den här appen huvudsakligen med ytfärg och ram, inte med skugga, och det är
konsekvent genomfört.

---

## 5. Komponentmönster

Mönstren nedan finns redan och används på flera ställen. De är systemets faktiska komponentbibliotek.

### 5.1 Knapp

```css
button {
  /* styles.css:190 */
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 7px;
  padding: 8px 13px;
  font-size: 0.875rem;
  font-weight: 600;
  transition: background 0.15s;
}
```

Fyra varianter, i fallande vikt:

| Variant    | Klass           | Definition                                     | Regel            |
| ---------- | --------------- | ---------------------------------------------- | ---------------- |
| Primär     | `.primary`      | accentfylld, `--accent-fg` text                | `styles.css:215` |
| Destruktiv | `.danger`       | `--danger`-fylld                               | `styles.css:223` |
| Sekundär   | _(ingen klass)_ | ram + `--surface`                              | `styles.css:190` |
| Tertiär    | `.text-button`  | ingen ram, `2px 4px`, `0.7rem`, `--text-muted` | `styles.css:853` |

**Regel:** högst en `.primary` per vy. Det bryts i dag på arbetsytan — se UX-AUDIT.md.

**Varning om `.text-button`:** den är appens minsta och svagaste kontroll (11,2 px text, 2×4 px
padding → uppmätt 28×21 px) och används samtidigt för destruktiva handlingar som _Radera projekt_
och `×` på en binding. Den kombinationen — svagast i systemet, farligast i konsekvens — bör inte
spridas vidare. Se UX-AUDIT.md.

**Fokus** (`styles.css:208-213`) är konsekvent och bra:

```css
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}
```

`:focus-visible` betyder att markeringen bara syns vid tangentbordsnavigation. Behåll det.

**Disabled** (`styles.css:204`) är `opacity: 0.45` på hela knappen. Det är enkelt men sänker
kontrasten på både text och ram under AA — se tillgänglighetsavsnittet i UX-AUDIT.md.

### 5.2 Sidhuvud i en vy

Två varianter av samma mönster:

```
.eyebrow      versal etikett, 0.68rem, weight 650, letter-spacing 1.8px   styles.css:377
h1            1.9rem
p             kort ledtext, --text-muted
.heading-actions   knappar högerställda
```

Används av `.project-heading` (App.tsx:539), `.dashboard-heading` (App.tsx:599), `.document`
(SettingsPage.tsx:36, Security.tsx:2). Mönstret är konsekvent genomfört.

### 5.3 Panelrubrik

```
.panel-title  =  h2/h3  +  .count (pill-badge)  +  valfri .text-button
```

`styles.css:784-798`. Används av BindingPanel, FindingsPanel, BindingsPage.

### 5.4 Dialog

Alla dialoger går genom `Modal` (`components/Modal.tsx`), som ger native `<dialog>` +
`showModal()`, `.dialog-head` (h2 + stängkryss) och `onCancel` → `close()`. Innehållet avslutas med
`.dialog-actions` (knapprad, primär sist till höger).

```css
dialog {
  /* styles.css:960 */
  border-radius: 12px;
  padding: 25px;
  width: min(590px, calc(100vw - 40px));
  box-shadow: 0 20px 80px var(--shadow-md);
  max-height: 90vh;
  overflow: auto;
}
```

`Modal.tsx:10-12` flyttar dessutom fokus till `[autofocus]` eller första fältet i stället för
stängknappen, med en kommentar som förklarar varför. Bra mönster — nya dialoger ska gå genom `Modal`
och inte bygga eget.

Bekräftelser går genom `useConfirm()` (`ConfirmDialog.tsx:96`) som ger ett `await`-bart
`confirm()`. Det stödjer `danger`, `typeToConfirm` (skriv ordet för att bekräfta) och ett extra
`option`-kryss. Använd det i stället för `window.confirm` — motiveringen står på
`ConfirmDialog.tsx:39-40`.

### 5.5 Meddelandeytor

Fyra olika ytor med olika livslängd, alla redan definierade:

| Mönster                    | Klass                        | Livslängd                | Fil                  |
| -------------------------- | ---------------------------- | ------------------------ | -------------------- |
| Beständig varning i flödet | `.notice`                    | tills innehållet ändras  | `styles.css:949`     |
| Tillfälligt besked         | `.inline-notice` (+ `.warn`) | tills användaren stänger | `code-first.css:172` |
| Ångra efter radering       | `.undo-bar`                  | 10 sekunder              | `UndoBar.tsx:121`    |
| Blockerande fel            | `Modal` + `role="alert"`     | tills stängd             | `App.tsx:673`        |

Valet mellan dem är dokumenterat på `App.tsx:113-116`: modal för något som kräver ett beslut, strip
för en vägran eller ett misslyckat bekvämlighetsgrepp.

### 5.6 Kort

Tre kortvarianter delar samma grund (`--surface`, `1px solid var(--border)`, `8px` radie):
`.project-card` (ProjectsPage.tsx), `.binding-card` (BindingPanel.tsx:46), `.finding`
(FindingsPanel.tsx:58). De två senare får en färgad vänsterkant för status respektive severity.

### 5.7 Statusmarkörer

`.status-pill` + `.status-{stable,testing,broken}` (`code-first.css:739-755`) och
`.severity-{critical,high,medium,low}` (`code-first.css:504-511`). Båda byggs med
template-literal (`` `status-${project.status}` ``), så de syns inte i en enkel klasssökning —
ta inte bort dem som "oanvända".

---

## 6. Lager och specificitet

Systemet har två stilmallar med en tydlig tänkt uppdelning:

- `styles.css` — bastokens, element, generella komponenter
- `code-first.css` — den nuvarande "code-first"-skalen, laddas sist (`App.tsx:43`)

`code-first.css` prefixar sina regler med `.code-first`, som alltid finns på rotelementet
(`App.tsx:530`). Det ger specificitet 0,2,0 mot `styles.css` 0,1,0 — **`code-first.css` vinner alltid,
även mot en `@media`-regel i `styles.css`.**

Det är ett fungerande lagersystem så länge man vet om det. I dag gör man det inte överallt: fem
responsiva `.work-grid`-regler och en `@media`-regel för topbaren i `styles.css` är döda av just den
anledningen (se UX-AUDIT.md, avsnitt Död yta). **Regeln att skriva ner:** en responsiv regel för
något som `code-first.css` äger måste också stå i `code-first.css`, eller prefixas `.code-first`.

`!important` används sex gånger. Det är lågt och behöver ingen åtgärd.

---

## 7. Brytpunkter

Nuvarande brytpunkter, i den ordning de finns i koden:

| Brytpunkt           | Fil                          | Vad den gör                                        |
| ------------------- | ---------------------------- | -------------------------------------------------- |
| `min-width: 1600px` | `styles.css:1035`            | 3-kolumners `.work-grid` — **verkningslös**, se §6 |
| `max-width: 1250px` | `styles.css:1046`            | Smalare panel — **verkningslös** för `.work-grid`  |
| `max-width: 900px`  | `styles.css:1078`            | Kompaktare topbar och kort                         |
| `max-width: 750px`  | `code-first.css:262`, `:817` | Topbaren wrappar, `.work-grid` blir en kolumn      |
| `max-width: 650px`  | `styles.css:1124`            | Ytterligare topbar-wrap — **verkningslös**         |

Dessutom finns brytpunkten `750px` i JavaScript: `Editor.tsx:12` väljer `PlainEditor` (en `textarea`)
i stället för Monaco under den bredden.

**Förslag:** tre brytpunkter räcker för den här appen och de bör vara desamma i CSS och JS:

```css
/* --break-narrow: 750px   — en kolumn, textarea i stället för Monaco, topbaren wrappar */
/* --break-mid:   1100px   — panelen krymper                                            */
/* --break-wide:  1600px   — tredje kolumnen                                            */
```

`750px` är redan sanningen i JS och bör därför vara sanningen i CSS också. Det viktiga är att de
tre punkterna definieras **en gång, i `code-first.css`**, så att specificitetsfällan i §6 inte kan
slå till igen. Insats: M.

---

## 8. Att hålla fast vid

1. **Färg går bara genom tokens.** Byggkontrollen bevakar det redan.
2. **Teman skiljer sig bara i tokenvärden.** Ingen komponentregel definieras om per tema.
3. **Grönt = AI, tegelrött = Local, gult = varning som inte blockerar.**
4. **Dialoger byggs med `Modal`, bekräftelser med `useConfirm()`.**
5. **En `.primary` per vy.**
6. **Responsiva regler skrivs i `code-first.css`** — annars är de döda (§6).
7. **`.text-button` är för tertiära handlingar, aldrig för destruktiva.**
