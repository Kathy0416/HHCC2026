import fs from 'node:fs';

const debugPort = process.env.CHROME_DEBUG_PORT || '9334';
const baseUrl = process.env.APP_URL || 'http://127.0.0.1:3000';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('No Chrome page target is available');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.health-top-grid'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Health Analysis page did not become ready');
}

async function waitForDeviceBrand(expectedBrand) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(`document.getElementById('deviceIllustration')?.dataset.deviceBrand === ${JSON.stringify(expectedBrand)}`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Device artwork did not resolve to ${expectedBrand}`);
}

await call('Runtime.enable');
await call('Log.enable');
const layouts = [];
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1100, mobile: false },
  { name: 'mobile', width: 390, height: 900, mobile: true }
]) {
  await call('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
  await waitForReady();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const result = await evaluate(`(() => {
    const topGrid = document.querySelector('.health-top-grid');
    const footer = document.querySelector('.health-footer');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      columns: getComputedStyle(topGrid).gridTemplateColumns.split(' ').length,
      footerInViewport: footer.getBoundingClientRect().right <= innerWidth,
      title: document.querySelector('.site-header__page-title').textContent,
      deviceBrand: document.getElementById('deviceIllustration')?.dataset.deviceBrand,
      deviceArtworkLoaded: Boolean(document.getElementById('deviceIllustration')?.complete && document.getElementById('deviceIllustration')?.naturalWidth),
      rangeButtons: document.querySelectorAll('[data-range]').length,
      hasMockGenerator: typeof window.generateMockSleepData === 'function',
      formProminent: document.querySelector('.record-card').getBoundingClientRect().top < document.querySelector('.analysis-card').getBoundingClientRect().top,
      connectionProminent: document.querySelector('.connection-card').getBoundingClientRect().top < document.querySelector('.analysis-card').getBoundingClientRect().top
    };
  })()`);
  layouts.push({ name: viewport.name, ...result });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`health-page-${viewport.name}.png`, Buffer.from(screenshot.data, 'base64'));
}

const auth = await evaluate(`(async () => {
  const username = 'band-artwork-browser-test';
  const password = 'band-artwork-test-password';
  let result;
  try { result = await window.ApiClient.register(username, password); }
  catch (error) { result = await window.ApiClient.login(username, password); }
  window.ApiClient.setToken(result.token);
  localStorage.setItem('currentUser', JSON.stringify(result.user));
  return result;
})()`);

await evaluate(`window.ApiClient.createHealthConnection({
  provider: 'health_connect',
  deviceName: 'Apple Watch Series 10',
  manufacturer: 'Apple',
  model: 'Watch',
  sourcePackages: []
})`);
await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await waitForDeviceBrand('apple');
const appleArtwork = await evaluate(`({
  brand: document.getElementById('deviceIllustration').dataset.deviceBrand,
  src: document.getElementById('deviceIllustration').getAttribute('src'),
  loaded: Boolean(document.getElementById('deviceIllustration').complete && document.getElementById('deviceIllustration').naturalWidth)
})`);

await evaluate(`window.ApiClient.createHealthConnection({
  provider: 'health_connect',
  deviceName: 'Galaxy Phone',
  manufacturer: 'Samsung',
  model: 'SM-Test',
  sourcePackages: ['com.mi.health']
})`);
await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await waitForDeviceBrand('xiaomi');
const xiaomiArtwork = await evaluate(`({
  brand: document.getElementById('deviceIllustration').dataset.deviceBrand,
  src: document.getElementById('deviceIllustration').getAttribute('src'),
  loaded: Boolean(document.getElementById('deviceIllustration').complete && document.getElementById('deviceIllustration').naturalWidth)
})`);

await evaluate(`window.ApiClient.createHealthConnection({
  provider: 'health_connect',
  deviceName: 'Unknown wearable',
  manufacturer: 'Example',
  model: 'Unknown',
  sourcePackages: []
})`);
await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await waitForDeviceBrand('xiaomi');
const unknownArtwork = await evaluate(`({
  brand: document.getElementById('deviceIllustration').dataset.deviceBrand,
  src: document.getElementById('deviceIllustration').getAttribute('src'),
  loaded: Boolean(document.getElementById('deviceIllustration').complete && document.getElementById('deviceIllustration').naturalWidth)
})`);

await evaluate(`window.I18n.setLanguage('en')`);
const english = await evaluate(`({ title: document.querySelector('.site-header__page-title').textContent, nav: document.querySelector('.health-nav-link.is-active span:last-child').textContent, record: document.querySelector('#record-title').textContent })`);

const failures = layouts.flatMap((layout) => [
  !layout.noHorizontalOverflow && `${layout.name}: horizontal overflow (${layout.scrollWidth} > ${layout.viewport.width})`,
  !layout.footerInViewport && `${layout.name}: footer exceeds viewport`,
  layout.deviceBrand !== 'xiaomi' && `${layout.name}: disconnected fallback artwork is not Xiaomi`,
  !layout.deviceArtworkLoaded && `${layout.name}: fallback artwork did not load`,
  layout.rangeButtons !== 3 && `${layout.name}: range buttons missing`,
  layout.hasMockGenerator && `${layout.name}: mock generator still exists`,
  !layout.formProminent && `${layout.name}: form is not above analysis`,
  !layout.connectionProminent && `${layout.name}: connection is not above analysis`
].filter(Boolean));
if (appleArtwork.brand !== 'apple' || appleArtwork.src !== 'assets/apple-watch.svg' || !appleArtwork.loaded) failures.push('Apple artwork selection failed');
if (xiaomiArtwork.brand !== 'xiaomi' || xiaomiArtwork.src !== 'assets/xiaomi-band.svg' || !xiaomiArtwork.loaded) failures.push('Mi Fitness package artwork selection failed');
if (unknownArtwork.brand !== 'xiaomi' || unknownArtwork.src !== 'assets/xiaomi-band.svg' || !unknownArtwork.loaded) failures.push('Unknown-device fallback artwork selection failed');
if (english.title !== 'Health Analysis' || english.nav !== 'Health Analysis' || english.record !== 'Record Sleep') failures.push('English translations did not apply');
if (errors.length) failures.push(...errors.map((error) => `browser: ${error}`));

console.log(JSON.stringify({ layouts, artwork: { appleArtwork, xiaomiArtwork, unknownArtwork }, english, errors }, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join('\n'));
