import { useTheme } from './store/theme';

const REPO_URL = 'https://github.com/addahadi/Book';

// First-visit explainer. Reading Stage's home is the shelf, so this is the pitch
// a newcomer lands on before entering the library; it's dismissed for good once
// they click through (App remembers via localStorage).
const DEFICITS = [
  {
    title: 'Annotation',
    body: 'Highlight, underline, and write in the margins — then find every mark again in a notebook that gathers them per book.',
  },
  {
    title: 'Sense of place',
    body: 'A two-hands indicator shows how much lies behind and ahead. Grab it to seek with live thumbnails — a felt position, not a scrollbar.',
  },
  {
    title: 'Focus',
    body: 'Pages turn, they never scroll. No tabs, no notifications, no upsells — and a focus mode where the chrome fades as you read.',
  },
  {
    title: 'Eye comfort',
    body: 'A real warm night mode and line-aware pagination that never bisects a line, instead of an endless bright scroll.',
  },
];

export default function Landing({ onEnter }: { onEnter: () => void }) {
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="h-full overflow-y-auto bg-neutral-100 text-neutral-900 dark:bg-stone-900 dark:text-stone-100">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4 text-sm">
        <span className="font-semibold">Reading Stage</span>
        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            GitHub
          </a>
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
            className="rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-6">
        {/* Hero */}
        <section className="py-16 sm:py-24">
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight sm:text-5xl">
            Digital reading that feels closer to a book.
          </h1>
          <p className="mt-5 max-w-xl text-base text-neutral-600 dark:text-neutral-300 sm:text-lg">
            Reading Stage is a reading-first PDF experience for the web — built around{' '}
            <span className="font-medium text-neutral-900 dark:text-neutral-100">annotation</span> and a{' '}
            <span className="font-medium text-neutral-900 dark:text-neutral-100">sense of place</span>.
            Not an editor, not a PDF toolkit. A paginated reader for serious, re-read-heavy material.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onEnter}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              Enter your library →
            </button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-5 py-2.5 text-sm font-medium ring-1 ring-black/15 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/5"
            >
              View the source
            </a>
          </div>
          <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
            Free &amp; open source · works offline · nothing to sign up for.
          </p>
        </section>

        {/* Thesis */}
        <section className="border-t border-black/10 py-12 dark:border-white/10">
          <p className="max-w-2xl text-lg leading-relaxed text-neutral-700 dark:text-neutral-200">
            Physical books beat digital ones for <em>thinking</em>, not for <em>looking</em>. Reading
            Stage doesn&apos;t fake paper — it closes the specific things that make PDF reading worse
            than a book for a serious reader.
          </p>
        </section>

        {/* The four deficits */}
        <section className="grid gap-6 border-t border-black/10 py-12 dark:border-white/10 sm:grid-cols-2">
          {DEFICITS.map((d) => (
            <div key={d.title}>
              <h2 className="text-lg font-semibold">{d.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                {d.body}
              </p>
            </div>
          ))}
        </section>

        {/* Privacy */}
        <section className="border-t border-black/10 py-12 dark:border-white/10">
          <h2 className="text-lg font-semibold">Yours, and only yours</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            Your books and every note you make live entirely in this browser, on this device. There
            is no backend, no account, and no tracking — and because Reading Stage is open source,
            that&apos;s something you can verify, not just take on trust. Export your annotations to a
            file anytime as a backup.
          </p>
          <button
            type="button"
            onClick={onEnter}
            className="mt-6 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            Start reading →
          </button>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-4xl border-t border-black/10 px-6 py-8 text-sm text-neutral-500 dark:border-white/10 dark:text-neutral-400">
        <p>
          Open source under the{' '}
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="underline hover:no-underline">
            AGPL-3.0
          </a>{' '}
          license ·{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline hover:no-underline">
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
