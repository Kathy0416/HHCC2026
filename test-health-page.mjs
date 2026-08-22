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
await call('Log.clear');
errors.length = 0;
await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await evaluate(`localStorage.clear()`);
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
      chartCanvases: document.querySelectorAll('.chart-card canvas').length,
      hasEnvironmentPanel: Boolean(document.getElementById('esp32Endpoint') && document.getElementById('latestTemperature')),
      stressTileRemoved: !document.getElementById('latestStress'),
      environmentFitsCard: document.querySelector('.esp32-panel').getBoundingClientRect().right <= document.querySelector('.connection-card').getBoundingClientRect().right,
      syncDisabledWithoutConnection: document.getElementById('esp32SyncBtn').disabled,
      hasMockGenerator: typeof window.generateMockSleepData === 'function',
      formProminent: document.querySelector('.record-card').getBoundingClientRect().top < document.querySelector('.analysis-card').getBoundingClientRect().top,
      connectionProminent: document.querySelector('.connection-card').getBoundingClientRect().top < document.querySelector('.analysis-card').getBoundingClientRect().top
    };
  })()`);
  layouts.push({ name: viewport.name, ...result });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`health-page-${viewport.name}.png`, Buffer.from(screenshot.data, 'base64'));
}

await evaluate(`(async () => {
  const username = 'band-art-' + Date.now();
  const password = 'band-artwork-test-password';
  const result = await window.ApiClient.register(username, password);
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

const esp32Errors = await evaluate(`(async () => {
  const originalFetch = window.fetch.bind(window);
  const originalSetTimeout = window.setTimeout.bind(window);
  const input = document.getElementById('esp32Endpoint');
  const button = document.getElementById('esp32SyncBtn');
  async function waitForError() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = document.getElementById('esp32Status');
      if (status.classList.contains('is-error') && !button.disabled) return status.textContent;
      await new Promise((resolve) => originalSetTimeout(resolve, 20));
    }
    return '';
  }
  async function run(endpoint, handler) {
    window.fetch = (requested, options) => String(requested) === endpoint
      ? handler(options)
      : originalFetch(requested, options);
    input.value = endpoint;
    button.click();
    return waitForError();
  }

  input.value = 'ftp://esp32.test/data';
  button.click();
  const invalidUrl = await waitForError();
  const malformed = await run('http://esp32.test/malformed', () => Promise.resolve(new Response(
    '[SAMPLE] mode=NORMAL mono_us=1 utc_ms=null light=1 temp=1 humidity=1 noise=1',
    { status: 200, headers: { 'content-type': 'text/plain' } }
  )));
  const cors = await run('http://esp32.test/cors', () => Promise.reject(new TypeError('Failed to fetch')));
  window.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 10000 ? 1 : delay, ...args);
  const timeout = await run('http://esp32.test/timeout', (options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  window.fetch = originalFetch;
  window.setTimeout = originalSetTimeout;
  return { invalidUrl, malformed, cors, timeout };
})()`);

const esp32Sync = await evaluate(`(async () => {
  const endpoint = 'http://esp32.test/data';
  const originalFetch = window.fetch.bind(window);
  const originalSync = window.ApiClient.syncEsp32Environment.bind(window.ApiClient);
  const latestTimestamp = Date.now();
  const lines = Array.from({ length: 501 }, (_, index) => {
    const utcMs = latestTimestamp - (500 - index) * 1000;
    return '[SAMPLE] noise=' + (60.1 + index / 1000).toFixed(3) +
      ' humidity=' + (62.1 + index / 10000).toFixed(4) +
      ' temp=' + (24 + index / 1000).toFixed(3) +
      ' utc_ms=' + utcMs +
      ' light=' + (428.3 + index).toFixed(1) +
      ' mode=NORMAL mono_us=' + (106183660 + index);
  });
  lines.splice(250, 0, '[SAMPLE] mode=NORMAL mono_us=1 utc_ms=null light=1 temp=1 humidity=1 noise=1');
  let uploadCalls = 0;
  window.ApiClient.syncEsp32Environment = async (...args) => {
    uploadCalls += 1;
    return originalSync(...args);
  };
  window.fetch = (input, options) => {
    if (String(input) === endpoint) {
      return Promise.resolve(new Response(lines.join('\\n'), {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      }));
    }
    return originalFetch(input, options);
  };

  document.getElementById('esp32Endpoint').value = endpoint;
  document.getElementById('esp32SyncBtn').click();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (document.getElementById('esp32Status').classList.contains('is-success')) break;
    if (document.getElementById('esp32Status').classList.contains('is-error')) {
      throw new Error(document.getElementById('esp32Status').textContent);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ranges = await Promise.all([7, 30, 90].map((range) => window.ApiClient.getHealthAnalysis(range)));
  return {
    success: document.getElementById('esp32Status').classList.contains('is-success'),
    status: document.getElementById('esp32Status').textContent,
    uploadCalls,
    endpointSaved: localStorage.getItem('esp32EndpointUrl'),
    latest: {
      temperature: document.getElementById('latestTemperature').textContent,
      humidity: document.getElementById('latestHumidity').textContent,
      light: document.getElementById('latestLight').textContent,
      noise: document.getElementById('latestNoise').textContent
    },
    historyRows: document.querySelectorAll('#healthHistoryBody tr').length,
    historyColumns: document.querySelector('#healthHistoryBody tr')?.children.length || 0,
    environmentCharts: Boolean(window.Chart && Chart.getChart('environmentClimateChart') && Chart.getChart('environmentExposureChart')),
    rangeCoverage: ranges.map((analysis) => ({
      range: analysis.range,
      seriesLength: analysis.series.length,
      hasEnvironment: analysis.series.some((day) => day.temperatureAvg != null && day.humidityAvg != null && day.lightAvg != null && day.noiseAvg != null)
    }))
  };
})()`);

await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await new Promise((resolve) => setTimeout(resolve, 500));
const esp32Reload = await evaluate(`({
  endpoint: document.getElementById('esp32Endpoint').value,
  temperature: document.getElementById('latestTemperature').textContent,
  syncEnabled: !document.getElementById('esp32SyncBtn').disabled,
  stressTileRemoved: !document.getElementById('latestStress')
})`);

await evaluate(`window.I18n.setLanguage('en')`);
const english = await evaluate(`({ title: document.querySelector('.site-header__page-title').textContent, nav: document.querySelector('.health-nav-link.is-active span:last-child').textContent, record: document.querySelector('#record-title').textContent })`);

const failures = layouts.flatMap((layout) => [
  !layout.noHorizontalOverflow && `${layout.name}: horizontal overflow (${layout.scrollWidth} > ${layout.viewport.width})`,
  !layout.footerInViewport && `${layout.name}: footer exceeds viewport`,
  layout.deviceBrand !== 'xiaomi' && `${layout.name}: disconnected fallback artwork is not Xiaomi`,
  !layout.deviceArtworkLoaded && `${layout.name}: fallback artwork did not load`,
  layout.rangeButtons !== 3 && `${layout.name}: range buttons missing`,
  layout.chartCanvases !== 5 && `${layout.name}: environmental chart canvases missing`,
  !layout.hasEnvironmentPanel && `${layout.name}: ESP32 panel is missing`,
  !layout.stressTileRemoved && `${layout.name}: Stress tile still exists`,
  !layout.environmentFitsCard && `${layout.name}: ESP32 panel exceeds the connection card`,
  !layout.syncDisabledWithoutConnection && `${layout.name}: ESP32 sync is enabled without an active connection`,
  layout.hasMockGenerator && `${layout.name}: mock generator still exists`,
  !layout.formProminent && `${layout.name}: form is not above analysis`,
  !layout.connectionProminent && `${layout.name}: connection is not above analysis`
].filter(Boolean));
if (appleArtwork.brand !== 'apple' || appleArtwork.src !== 'assets/apple-watch.svg' || !appleArtwork.loaded) failures.push('Apple artwork selection failed');
if (xiaomiArtwork.brand !== 'xiaomi' || xiaomiArtwork.src !== 'assets/xiaomi-band.svg' || !xiaomiArtwork.loaded) failures.push('Mi Fitness package artwork selection failed');
if (unknownArtwork.brand !== 'xiaomi' || unknownArtwork.src !== 'assets/xiaomi-band.svg' || !unknownArtwork.loaded) failures.push('Unknown-device fallback artwork selection failed');
if (Object.values(esp32Errors).some((message) => !message)) failures.push('An ESP32 URL, malformed-response, CORS, or timeout error state was not shown');
if (new Set(Object.values(esp32Errors)).size !== 4) failures.push('ESP32 error states were not specific to their failure causes');
if (!esp32Sync.success) failures.push('ESP32 sync did not reach its success state');
if (esp32Sync.uploadCalls !== 2) failures.push(`501 ESP32 samples used ${esp32Sync.uploadCalls} uploads instead of two 500-record chunks`);
if (esp32Sync.endpointSaved !== 'http://esp32.test/data') failures.push('ESP32 endpoint URL was not persisted');
if (esp32Sync.latest.temperature !== '24.5' || esp32Sync.latest.humidity !== '62.1' || esp32Sync.latest.light !== '928.3' || esp32Sync.latest.noise !== '60.6') failures.push('Latest ESP32 tiles were not rendered correctly');
if (esp32Sync.historyRows < 1 || esp32Sync.historyColumns !== 11) failures.push('Environmental history columns or rows are missing');
if (!esp32Sync.environmentCharts) failures.push('Environmental charts were not created');
if (esp32Sync.rangeCoverage.some((item) => item.seriesLength !== item.range || !item.hasEnvironment)) failures.push('Environmental analysis is missing from a 7/30/90-day range');
if (esp32Reload.endpoint !== 'http://esp32.test/data' || esp32Reload.temperature !== '24.5' || !esp32Reload.syncEnabled || !esp32Reload.stressTileRemoved) failures.push('ESP32 state did not reload correctly');
if (english.title !== 'Health Analysis' || english.nav !== 'Health Analysis' || english.record !== 'Record Sleep') failures.push('English translations did not apply');
if (errors.length) failures.push(...errors.map((error) => `browser: ${error}`));

console.log(JSON.stringify({ layouts, artwork: { appleArtwork, xiaomiArtwork, unknownArtwork }, esp32Errors, esp32Sync, esp32Reload, english, errors }, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join('\n'));
