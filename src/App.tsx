import PdfCanvas from './reader/PdfCanvas';
import { useReader } from './store/reader';
import samplePdf from './assets/sample.pdf?url';

export default function App() {
  const { currentPage, numPages } = useReader();

  return (
    <div className="flex h-full flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2 text-sm dark:border-white/10">
        <span className="font-semibold">Reading Stage</span>
        <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
          page {currentPage}
          {numPages ? ` of ${numPages}` : ''}
        </span>
      </header>
      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <PdfCanvas src={samplePdf} />
      </main>
    </div>
  );
}
