# Contributing to Folio

Thanks for your interest in Folio. It's a reading-first PDF reader that values **focus by
subtraction** — so the most important thing to know up front is that *what we deliberately don't
build* is as considered as what we do. A quick read of [`SPEC.md`](./SPEC.md) (especially the
**non-goals in §3**) will save everyone time.

## Ground rules

- **Discuss scope before building.** Open an issue first for anything beyond a small fix. A great
  PR that adds a non-goal (PDF editing, OCR, gamification, note-graph, a backend, …) can't be
  merged, and we'd hate for you to spend the effort. If in doubt, ask.
- **Pagination is the identity.** Pages *turn*; they do not scroll. Changes that reintroduce
  scrolling as a primary interaction are out of scope.
- **Local & private.** In v1 nothing leaves the device. Please don't add network calls, analytics,
  or telemetry.
- Be kind — see the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

```bash
git clone https://github.com/addahadi/Folio.git
cd Folio
npm install
npm run dev
```

Requires Node 18+.

## Before you open a pull request

- **`npm run build` must pass** (`tsc -b` + the Vite production build). There is no test runner or
  linter configured yet, so a clean type-check is the gate.
- Keep changes **focused** — one logical change per PR, small enough to review.
- **Match the surrounding code.** TypeScript throughout; Tailwind for styling; comment density and
  naming in the style of the file you're editing. `pdfjs-dist` is touched only in
  `src/reader/pdf.ts` — components consume the typed wrappers, not the library.
- Reference the issue your PR addresses (e.g. "Closes #42").

## Reporting bugs

Open an issue using the **Bug report** template. Include:
- what you did, what you expected, what happened;
- your browser + OS;
- if relevant, whether the PDF is born-digital (selectable text) or scanned — the two paths behave
  differently, and a small sample PDF that reproduces the problem is gold.

## Suggesting features

Open an issue using the **Feature request** template and describe the *reading problem* you're
trying to solve, not just the feature. Because this project is scoped by subtraction, the framing
matters: which of the four deficits (annotation, sense of place, focus, eye comfort) does it serve?

## Commit messages

Short, imperative, and scoped — e.g. `Reader: keep selection across a page turn`. Reference issues
where relevant.

Thanks for helping make digital reading feel a little closer to a book.
