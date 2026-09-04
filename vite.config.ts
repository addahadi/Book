import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pdfjs-dist ships an ESM worker; Vite bundles it via the `?url` import in src/reader/pdf.ts.
export default defineConfig({
  plugins: [react()],
});
