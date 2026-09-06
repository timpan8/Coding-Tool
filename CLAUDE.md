# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI Code Vault: a static React 19 + TypeScript app for GitHub Pages that keeps private values out of
code you hand to an AI. Code is stored as a **template** with `{{BINDING_NAME}}` placeholders, and
rendered into three projections:

- **Mall** — the editable source, the only view you can type in.
- **Local** — the template with your real values substituted, for your own machine.
- **AI** — the template with harmless example values, for a chat window.

The interface is Swedish. Everything is local: IndexedDB via Dexie, no server, no network.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm test                    # vitest, unit + property tests
pnpm test:watch
pnpm lint                    # oxlint && prettier --check .
pnpm format
pnpm build                   # tsc -b, vite build, service worker, then the static audit
pnpm test:e2e                # Playwright; builds and serves the preview itself
pnpm preview --port 4173
```

A single test:

```sh
pnpm exec vitest run src/domain/render/context.test.ts
pnpm exec vitest run -t "blocks a shell here-document"
pnpm exec playwright test -g "copies a selection in sanitised form"
pnpm exec playwright test e2e/accessibility.spec.ts
```

**Check the exit code, not the output.** `pnpm lint` prints oxlint warnings that are not failures and
Prettier failures that are; grepping its text for a pattern will tell you it passed when it did not.
This has already happened and left six commits red.

## Invariants

These are decisions, not accidents. Several are enforced by tests or by the build.

1. **No network traffic, ever.** `connect-src 'none'` in `index.html`, and `scripts/check-network.mjs`
   runs as part of `pnpm build`: it fails on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or
   `sendBeacon` anywhere in the bundle, on a remote `@import` or off-origin `url()` in the CSS, and on
   any `preconnect`/`prefetch`/`preload` in the HTML. No CDN, no external font, no analytics.
2. **No code execution.** No `eval`, no `new Function` — `.oxlintrc.json` makes both errors.
3. **Escaping blocks rather than guesses.** A context that cannot be escaped safely is refused with a
   message saying what to do instead. Rendering never substitutes recursively.
4. **The AI projection never contains a private value.** The exact-value check lives in
   `auditForCopy()` and must run before _every_ copy, on the text being copied.
5. **Error messages and issue objects never contain private values.**
6. **Drafts never create version history.** Saving a version is always an explicit act.
7. **Draft writes are revision-checked.** A stale write is rejected with `DraftConflictError`, never
   applied.
8. **The user's text survives a storage failure.** It stays in the tab and the failure is reported.
9. **Copy Local with secrets always needs a second, explicit choice.**
10. **Only `dist/` is published to `gh-pages`.** Never user data, never a backup file.

## Architecture

### `src/domain/` — pure, no DOM, no storage

- **`render/`** is the heart. `render()` is _projection only_: substitution and escaping, cheap enough
  to run on every keystroke. It is **not** a safety gate. `audit.ts` holds `auditForCopy()`, the only
  function the copy path may call, which re-renders and then runs the exact-value leak check. If you
  move work between them, invariant 4 is what you are risking.
- **`render/escape.ts`** decides how a value is escaped, per language. `contextsAt()` lexes the source
  **once** for every placeholder position (it used to restart per placeholder — 184 ms on a 2000-line
  file, twice per keystroke). `escapeValue()` then has one branch per language.
- **`scanner/`** finds values that _look_ like secrets. It **warns**, it never blocks — a false
  positive nobody can acknowledge is how a tool gets worked around. Excerpts are masked and
  dismissals are keyed by a hash, never the value.
- **`snapshot/`** is the export/import schema (zod). The private-only backup shape is enforced by the
  schema, not by remembering to omit keys.
- **`roundtrip/`** matches AI-returned code back onto placeholders in three tiers; tier 3 is always a
  suggestion and is never applied automatically.

### `src/storage/`

`StorageProvider` is the interface; `IndexedDbProvider` is the only implementation. `contract.test.ts`
runs against it with `fake-indexeddb` and is where storage behaviour is pinned.

Two things that look like bugs and are not:

- `saveDraft` **refuses a changed file set**, so a stale tab cannot resurrect a deleted file through
  autosave. Adding or removing files goes through `changeFiles`, which carries the same revision check.
- The database name includes `location.pathname`, so localhost and a GitHub Pages sub-path are
  separate vaults.

### `src/ui/`

`WorkspaceController` is an external store consumed with `useSyncExternalStore` — not context, not a
reducer. It owns the session, the debounced draft autosave and the revision check. `App.tsx` is state,
routing, shortcuts and composition; views and dialogs are components beside it.

The editor is lazy: `Editor.tsx` renders a `<textarea>` until Monaco arrives, and _keeps_ the textarea
below 750 px, where Monaco has no touch selection handles. Both honour the same `EditorProps`.

**All visible strings live in `src/ui/text.ts`.** Messages that vary are functions, so Swedish plurals
live with the text. Three deliberate exceptions, documented in that file: the security page and the
introduction are documents with inline markup, and `shortcuts.ts` is already a table where the label
belongs beside the key.

## Conventions that will bite you

- **Prettier never touches `.ts`/`.tsx`** — see `.prettierignore`. The terse style in `src/` (several
  statements per line, comma-separated declarations) is deliberate. Extracted components are written
  as ordinary multi-line JSX; match whichever file you are in.
- **Colours may only appear where a token is defined.** `check-network.mjs` fails the build on a hex
  literal anywhere else in `styles.css` or `code-first.css`, because a colour outside a token exists in
  one theme and not the other.
- **e2e runs against `pnpm preview`, never `pnpm dev`.** HMR uses a WebSocket that the CSP blocks, so
  the dev server looks like a broken app.
- **Every e2e test starts from an empty vault and therefore meets the introduction.** Use the `open()`
  helper in `e2e/app.ts` rather than `page.goto`.
- Playwright's `getByLabel` matches substrings; "Namn" also matches "Filnamn" and "Projektnamn". Use
  explicit `aria-label`s and `{ exact: true }`.
- typescript-eslint does not support TypeScript 7, which is why the linter is oxlint.

## Adding a language

Adding an entry to `LanguageId` is not adding a language. Without a branch in `escapeValue()` a value
falls through to the generic rule at the end and is escaped for the wrong syntax — silently. Each
language needs its own escaping rule, its own tests, and its own refusals for the forms it cannot
represent. Worked examples: C#'s `@"…"` has no escapes at all so a quote is doubled; C#'s `$"…"` is
refused because the language reads `{{` as an escaped `{` and would swallow the placeholder; INI has
no specification so only values that survive every plausible parser are allowed.

`context.test.ts` carries a **verbatim copy of the lexer as it stood before the single-pass rewrite**,
as a differential oracle. It caught a real bug immediately. Its language list is frozen on purpose:
the reference has no opinion about languages added after it, so adding one there fails for a reason
that is not a bug. The batching property below it does cover every language.

## Reference

- `DECISIONS.md` — why things are the way they are, including the judgement calls behind the
  refusals. Add to it when you make a decision the code cannot show on its own.
- `FORBATTRINGSRAPPORT.md` — a full review of the tool with per-finding status. Useful as a map of
  what was wrong and what the fix was.
- `README.md` — user-facing, including the threat model that is also served at `#/security` in the
  app. Keep the two in step: a security document that understates what the tool does is the same
  class of defect as one that overstates it.
