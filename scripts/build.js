// Bundles src/ and its dependencies into dist/, so the published package has
// nothing to install at runtime and starts fast.
import { chmod, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/cli.js'],
  outdir: 'dist',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  // Lets the app (Ink, React) and later the AI SDKs load only when they're used.
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.13',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Ink loads React DevTools only when DEV=true and the package is installed.
  external: ['react-devtools-core'],
  // Bundled CommonJS code (React, commander) calls require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

await chmod('dist/cli.js', 0o755);
