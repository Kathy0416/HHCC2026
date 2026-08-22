import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const files = [
  'index.html', 'diary.html', 'sleep.html', 'tips.html', 'my.html', 'ai-chat.html',
  'styles.css', 'health-analysis.css',
  'api.js', 'locales.js', 'i18n.js', 'script.js', 'site-header.js',
  'ai-chat.js', 'health-analysis.js', 'native-auth.js', 'mobile-health.js', 'sw.js', '睡眠.png'
];

function apiOrigin() {
  const configured = (process.env.MIGRAINE_API_URL || 'http://10.0.2.2:3000').trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('MIGRAINE_API_URL must be a complete http:// or https:// URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || /\/api$/i.test(parsed.pathname)) {
    throw new Error('MIGRAINE_API_URL must be a server origin/base URL without a trailing /api.');
  }
  if (process.env.MIGRAINE_RELEASE === '1' && parsed.protocol !== 'https:') {
    throw new Error('Release builds require an HTTPS MIGRAINE_API_URL.');
  }
  return configured;
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'vendor'), { recursive: true });

for (const relative of files) {
  const source = path.join(root, relative);
  const target = path.join(dist, relative);
  if (relative.endsWith('.html')) {
    let html = await readFile(source, 'utf8');
    html = html
      .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js(?:@[^"/]*)?(?:\/dist\/chart\.umd\.min\.js)?"><\/script>/g, '<script src="vendor/chart.umd.js"></script>')
      .replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chartjs-chart-heatmap@[^\"]+"><\/script>/g, '');
    await writeFile(target, html, 'utf8');
  } else {
    await cp(source, target);
  }
}

await cp(path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), path.join(dist, 'vendor', 'chart.umd.js'));
await writeFile(
  path.join(dist, 'runtime-config.js'),
  `(function(g){g.MIGRAINE_APP_CONFIG=Object.freeze({apiBaseUrl:${JSON.stringify(apiOrigin())},nativeBuild:true});}(window));\n`,
  'utf8'
);

console.log(`Built Capacitor web assets in ${dist}`);
