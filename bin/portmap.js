#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = join(root, 'dist', 'server.mjs');

if (!existsSync(serverEntry)) {
  console.error('portmap build not found. Run `npm run build` first.');
  process.exit(1);
}

const { startCli } = await import(pathToFileURL(serverEntry).href);
await startCli(process.argv.slice(2));
