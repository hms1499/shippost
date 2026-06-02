import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Resolve the `@/` path alias (tsconfig "paths") so vitest can load modules —
// e.g. the /api/generate/stream route and its `@/lib/*` imports — the same way
// Next does. Scoped to `@/...` only (regex) so package names like
// `@radix-ui/*` are left to normal node_modules resolution.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${root}/$1` }],
  },
});
