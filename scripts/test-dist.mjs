import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const required = ['index.html', 'sleep.html', 'api.js', 'native-auth.js', 'mobile-health.js', 'runtime-config.js', 'vendor/chart.umd.js'];
for (const file of required) await access(path.join(dist, file));

const names = await readdir(dist);
for (const forbidden of ['server', 'android', 'android-companion', 'test-health-page.mjs']) {
  if (names.includes(forbidden)) throw new Error(`Forbidden build output: ${forbidden}`);
}

const config = await readFile(path.join(dist, 'runtime-config.js'), 'utf8');
if (!config.includes('apiBaseUrl')) throw new Error('The generated runtime API configuration is missing.');

const sleep = await readFile(path.join(dist, 'sleep.html'), 'utf8');
if (sleep.includes('cdn.jsdelivr.net/npm/chart.js')) throw new Error('Chart.js was not vendored for the native app.');
console.log('dist verification passed');
