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
await evaluate(`localStorage.clear(); sessionStorage.clear()`);
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
    const recordCard = document.querySelector('.record-card');
    const connectionCard = document.querySelector('.connection-card');
    const triggers = [...document.querySelectorAll('.sleep-form-fields .glass-picker-trigger')];
    const triggerStyles = triggers.map((trigger) => {
      const style = getComputedStyle(trigger);
      const rect = trigger.getBoundingClientRect();
      return { width: rect.width, height: rect.height, border: style.border, radius: style.borderRadius, background: style.backgroundColor, font: style.fontSize };
    });
    const firstTriggerStyle = triggerStyles[0];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      columns: getComputedStyle(topGrid).gridTemplateColumns.split(' ').length,
      footerInViewport: footer.getBoundingClientRect().right <= innerWidth,
      title: document.querySelector('.site-header__page-title').textContent,
      connectionTitle: document.getElementById('connection-title').textContent,
      deviceChooserTriggerTag: document.getElementById('deviceChooserTrigger').tagName,
      defaultDeviceName: document.getElementById('deviceName').textContent,
      deviceBrand: document.getElementById('deviceIllustration')?.dataset.deviceBrand,
      deviceArtworkLoaded: Boolean(document.getElementById('deviceIllustration')?.complete && document.getElementById('deviceIllustration')?.naturalWidth),
      rangeButtons: document.querySelectorAll('[data-range]').length,
      chartCanvases: document.querySelectorAll('.chart-card canvas').length,
      sensorSectionPresent: Boolean(document.getElementById('sensor-session-title') && document.getElementById('sensorChartGrid')),
      compactEspControl: document.querySelectorAll('.connection-card #esp32SyncBtn').length === 1 && !document.querySelector('.connection-card #esp32Endpoint') && !document.querySelector('.esp32-panel'),
      stressTileRemoved: !document.getElementById('latestStress'),
      controlsMatch: triggers.length === 4 && triggers.every((trigger) => trigger.querySelector('.picker-trigger-chevron')) && triggerStyles.every((item) => Math.abs(item.height - firstTriggerStyle.height) < 1 && item.border === firstTriggerStyle.border && item.radius === firstTriggerStyle.radius && item.background === firstTriggerStyle.background && item.font === firstTriggerStyle.font),
      equalDesktopCardHeight: innerWidth <= 1050 || Math.abs(recordCard.getBoundingClientRect().height - connectionCard.getBoundingClientRect().height) <= 1,
      syncDisabledWithoutConnection: document.getElementById('esp32SyncBtn').disabled,
      hasMockGenerator: typeof window.generateMockSleepData === 'function',
      formProminent: document.querySelector('.record-card').getBoundingClientRect().top < document.querySelector('.analysis-card').getBoundingClientRect().top,
      connectionProminent: document.querySelector('.connection-card').getBoundingClientRect().top < document.querySelector('.analysis-card').getBoundingClientRect().top
    };
  })()`);
  await evaluate(`document.getElementById('deviceChooserTrigger').click()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  result.deviceChooser = await evaluate(`(() => {
    const dialog = document.querySelector('.device-chooser-dialog');
    const rect = dialog.getBoundingClientRect();
    const unavailable = document.querySelector('.device-type-option.is-unavailable');
    return {
      open: !document.getElementById('deviceChooserModal').hidden,
      selectableOptions: document.querySelectorAll('#deviceTypeOptions [data-device-type]').length,
      totalOptions: document.querySelectorAll('.device-type-option').length,
      unavailableDisabled: unavailable.disabled && unavailable.getAttribute('aria-disabled') === 'true',
      selectedOptions: document.querySelectorAll('.device-type-option.is-selected').length,
      artworkLoaded: [...document.querySelectorAll('.device-type-option img')].every((image) => image.complete && image.naturalWidth),
      withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      triggerExpanded: document.getElementById('deviceChooserTrigger').getAttribute('aria-expanded') === 'true',
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth
    };
  })()`);
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`health-page-${viewport.name}.png`, Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`document.getElementById('datePickerTrigger').click()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  result.picker = await evaluate(`(() => {
    const dialog = document.getElementById('glassPicker');
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    return {
      open: !document.getElementById('pickerBackdrop').hidden,
      dateCells: document.querySelectorAll('#pickerDays .picker-day').length,
      selectedDates: document.querySelectorAll('#pickerDays .is-selected').length,
      hasBackdropBlur: style.backdropFilter !== 'none' || style.webkitBackdropFilter !== 'none',
      compactCalendar: rect.width <= 450 && rect.height <= 590,
      withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      bottomGap: innerHeight - rect.bottom,
      mobileBottomSheet: innerWidth > 640 || Math.abs(innerHeight - rect.bottom - 82) <= 4,
      desktopAnchored: innerWidth <= 640 || Boolean(dialog.style.left && dialog.style.top),
      triggerExpanded: document.getElementById('datePickerTrigger').getAttribute('aria-expanded') === 'true'
    };
  })()`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`document.getElementById('sleepTimePickerTrigger').click()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  result.timePicker = await evaluate(`(() => {
    const dialogRect = document.getElementById('glassPicker').getBoundingClientRect();
    const hourList = document.getElementById('pickerHours');
    const minuteList = document.getElementById('pickerMinutes');
    const hourRect = hourList.getBoundingClientRect();
    const minuteRect = minuteList.getBoundingClientRect();
    const selectedHour = hourList.querySelector('.is-selected').getBoundingClientRect();
    const selectedMinute = minuteList.querySelector('.is-selected').getBoundingClientRect();
    return {
      hours: hourList.querySelectorAll('[data-hour]').length,
      minutes: minuteList.querySelectorAll('[data-minute]').length,
      firstHour: hourList.querySelector('[data-hour]')?.textContent,
      lastHour: hourList.querySelector('[data-hour]:last-child')?.textContent,
      firstMinute: minuteList.querySelector('[data-minute]')?.textContent,
      lastMinute: minuteList.querySelector('[data-minute]:last-child')?.textContent,
      columns: getComputedStyle(document.querySelector('.picker-time-columns')).gridTemplateColumns.split(' ').length,
      compactHeight: hourRect.height <= 205 && minuteRect.height <= 205,
      compactWidth: dialogRect.width <= 300,
      withinViewport: dialogRect.left >= 0 && dialogRect.top >= 0 && dialogRect.right <= innerWidth && dialogRect.bottom <= innerHeight,
      selectedTimeVisible: selectedHour.top >= hourRect.top && selectedHour.bottom <= hourRect.bottom && selectedMinute.top >= minuteRect.top && selectedMinute.bottom <= minuteRect.bottom,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth
    };
  })()`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  layouts.push({ name: viewport.name, ...result });
}

const signedOutDevicePreview = await evaluate(`(async () => {
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const trigger = document.getElementById('deviceChooserTrigger');
  trigger.click(); await tick();
  const unavailable = document.querySelector('.device-type-option.is-unavailable');
  unavailable.click();
  const unavailableIgnored = document.querySelector('#deviceTypeOptions [data-device-type="miband"]').classList.contains('is-selected');
  document.querySelector('[data-device-type="apple"]').click();
  document.getElementById('deviceDisplayName').value = '';
  document.getElementById('deviceChooserForm').requestSubmit(); await tick();
  const emptyNameRejected = !document.getElementById('deviceChooserError').hidden && !document.getElementById('deviceChooserModal').hidden;
  document.getElementById('deviceDisplayName').value = 'Bedroom Watch';
  document.getElementById('deviceChooserForm').requestSubmit();
  for (let attempt = 0; attempt < 30 && !document.getElementById('deviceChooserModal').hidden; attempt += 1) await tick();
  return {
    unavailableIgnored,
    emptyNameRejected,
    modalClosed: document.getElementById('deviceChooserModal').hidden,
    type: document.getElementById('deviceIllustration').dataset.deviceType,
    name: document.getElementById('deviceName').textContent,
    preview: JSON.parse(sessionStorage.getItem('healthDevicePreview') || 'null'),
    status: document.getElementById('pageStatus').textContent,
    focusRestored: document.activeElement === trigger
  };
})()`);

await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await new Promise((resolve) => setTimeout(resolve, 200));
const signedOutPreviewReload = await evaluate(`({
  type: document.getElementById('deviceIllustration').dataset.deviceType,
  name: document.getElementById('deviceName').textContent,
  previewPresent: Boolean(sessionStorage.getItem('healthDevicePreview'))
})`);

const pickerInteraction = await evaluate(`(async () => {
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const dateTrigger = document.getElementById('datePickerTrigger');
  const bedtimeTrigger = document.getElementById('sleepTimePickerTrigger');
  const wakeTrigger = document.getElementById('wakeTimePickerTrigger');
  const qualityTrigger = document.getElementById('qualityPickerTrigger');
  const originalDate = document.getElementById('date').value;

  dateTrigger.click(); await tick();
  const originalMonth = document.getElementById('pickerMonthLabel').textContent;
  const selectedBefore = document.querySelector('#pickerDays .is-selected').dataset.date;
  document.querySelector('#pickerDays .is-selected').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await tick();
  const selectedAfterArrow = document.querySelector('#pickerDays .is-selected').dataset.date;
  document.getElementById('pickerApply').click();
  const keyboardDate = document.getElementById('date').value;

  dateTrigger.click(); await tick();
  document.getElementById('pickerNextMonth').click(); await tick();
  const navigatedMonth = document.getElementById('pickerMonthLabel').textContent;
  document.getElementById('pickerApply').focus();
  document.getElementById('pickerApply').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  const focusTrapped = document.getElementById('glassPicker').contains(document.activeElement);
  document.getElementById('pickerCancel').click();
  const cancelPreservedDate = document.getElementById('date').value === keyboardDate && document.activeElement === dateTrigger;

  dateTrigger.click(); await tick();
  document.getElementById('pickerBackdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const outsideClosed = document.getElementById('pickerBackdrop').hidden && document.activeElement === dateTrigger;

  dateTrigger.click(); await tick();
  document.getElementById('pickerNextMonth').click();
  document.getElementById('pickerToday').click(); await tick();
  const todaySelection = document.querySelector('#pickerDays .is-selected').dataset.date;
  document.getElementById('pickerApply').click();

  bedtimeTrigger.click(); await tick();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await tick();
  document.querySelector('#pickerMinutes .is-selected').focus();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await tick();
  document.getElementById('pickerApply').click();
  wakeTrigger.click(); await tick();
  document.querySelector('[data-hour="7"]').click();
  document.querySelector('[data-minute="1"]').click();
  document.getElementById('pickerApply').click();

  wakeTrigger.click(); await tick();
  document.querySelector('[data-minute="2"]').click();
  document.getElementById('pickerCancel').click();
  const cancelPreservedTime = document.getElementById('wakeTime').value === '07:01' && document.activeElement === wakeTrigger;
  bedtimeTrigger.click(); await tick();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escapeClosed = document.getElementById('pickerBackdrop').hidden && document.activeElement === bedtimeTrigger;

  const exactTimeGrid = document.querySelectorAll('#pickerHours [data-hour]').length === 24 && document.querySelectorAll('#pickerMinutes [data-minute]').length === 60;
  const qualityValues = [];
  for (const quality of ['excellent', 'good', 'fair', 'poor']) {
    qualityTrigger.click(); await tick();
    document.querySelector('[data-quality="' + quality + '"]').click(); await tick();
    qualityValues.push(document.getElementById('quality').value);
  }
  qualityTrigger.click(); await tick();
  const qualityChoiceCount = document.querySelectorAll('#pickerQualities [data-quality]').length;
  document.querySelector('[data-quality="excellent"]').click(); await tick();
  const duration = document.getElementById('durationValue').textContent;
  document.getElementById('wakeTime').value = '';
  document.getElementById('sleepForm').requestSubmit();
  const validation = !document.getElementById('sleepFormError').hidden && document.activeElement === wakeTrigger;

  return {
    originalDate, originalMonth, selectedBefore, selectedAfterArrow, keyboardDate, navigatedMonth,
    cancelPreservedDate, focusTrapped, outsideClosed, todaySelection, finalDate: document.getElementById('date').value,
    bedtime: document.getElementById('sleepTime').value, cancelPreservedTime, escapeClosed,
    exactTimeGrid, duration, validation, qualityValues, qualityChoiceCount,
    qualityCommittedImmediately: document.getElementById('quality').value === 'excellent' && document.getElementById('pickerBackdrop').hidden,
    noNativePickers: !document.querySelector('input[type="date"], input[type="time"]') && document.getElementById('quality').hidden
  };
})()`);

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
  type: document.getElementById('deviceIllustration').dataset.deviceType,
  name: document.getElementById('deviceName').textContent,
  src: document.getElementById('deviceIllustration').getAttribute('src'),
  loaded: Boolean(document.getElementById('deviceIllustration').complete && document.getElementById('deviceIllustration').naturalWidth),
  signedOutPreviewDiscarded: !sessionStorage.getItem('healthDevicePreview')
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
  type: document.getElementById('deviceIllustration').dataset.deviceType,
  name: document.getElementById('deviceName').textContent,
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
  type: document.getElementById('deviceIllustration').dataset.deviceType,
  name: document.getElementById('deviceName').textContent,
  src: document.getElementById('deviceIllustration').getAttribute('src'),
  loaded: Boolean(document.getElementById('deviceIllustration').complete && document.getElementById('deviceIllustration').naturalWidth)
})`);

const devicePreferenceInteraction = await evaluate(`(async () => {
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const trigger = document.getElementById('deviceChooserTrigger');
  trigger.click(); await tick();
  document.querySelector('[data-device-type="apple"]').click();
  document.getElementById('deviceChooserCancel').click();
  const cancelPreserved = document.getElementById('deviceIllustration').dataset.deviceType === 'miband' && document.activeElement === trigger;
  trigger.click(); await tick();
  document.getElementById('deviceChooserModal').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const outsideClosed = document.getElementById('deviceChooserModal').hidden && document.activeElement === trigger;
  trigger.click(); await tick();
  document.querySelector('#deviceTypeOptions .is-selected').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await tick();
  const keyboardSelectedApple = document.querySelector('[data-device-type="apple"]').classList.contains('is-selected');
  const defaultChangedWithType = document.getElementById('deviceDisplayName').value === 'Apple Watch';
  document.getElementById('deviceDisplayName').value = 'My Migraine Watch';
  document.getElementById('deviceChooserForm').requestSubmit();
  for (let attempt = 0; attempt < 80 && !document.getElementById('deviceChooserModal').hidden; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  const connectionData = await window.ApiClient.getHealthConnection();
  return {
    cancelPreserved,
    outsideClosed,
    keyboardSelectedApple,
    defaultChangedWithType,
    savedType: document.getElementById('deviceIllustration').dataset.deviceType,
    savedName: document.getElementById('deviceName').textContent,
    serverPreference: connectionData.devicePreference,
    focusRestored: document.activeElement === trigger
  };
})()`);

await evaluate(`window.ApiClient.createHealthConnection({
  provider: 'health_connect',
  deviceName: 'Android Phone After Rename',
  manufacturer: 'Google',
  model: 'Pixel Test',
  sourcePackages: ['com.mi.health']
})`);
await call('Page.navigate', { url: `${baseUrl}/sleep.html` });
await waitForReady();
await waitForDeviceBrand('apple');
const devicePreferenceAfterMetadataSync = await evaluate(`(async () => {
  const data = await window.ApiClient.getHealthConnection();
  return {
    type: document.getElementById('deviceIllustration').dataset.deviceType,
    name: document.getElementById('deviceName').textContent,
    reportedDeviceName: data.connection.deviceName,
    preference: data.devicePreference
  };
})()`);

const pickerSave = await evaluate(`(async () => {
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  async function selectTime(triggerId, value) {
    document.getElementById(triggerId).click(); await tick();
    const [hour, minute] = value.split(':').map(Number);
    document.querySelector('[data-hour="' + hour + '"]').click();
    document.querySelector('[data-minute="' + minute + '"]').click();
    document.getElementById('pickerApply').click();
  }
  await selectTime('sleepTimePickerTrigger', '23:59');
  await selectTime('wakeTimePickerTrigger', '07:01');
  document.getElementById('qualityPickerTrigger').click(); await tick();
  document.querySelector('[data-quality="fair"]').click(); await tick();
  const originalSave = window.ApiClient.saveSleepRecord.bind(window.ApiClient);
  let captured;
  let resolveRequest;
  const requested = new Promise((resolve) => { resolveRequest = resolve; });
  window.ApiClient.saveSleepRecord = async (...args) => {
    captured = JSON.parse(JSON.stringify(args));
    const result = await originalSave(...args);
    resolveRequest();
    return result;
  };
  document.getElementById('sleepForm').requestSubmit();
  await requested;
  for (let attempt = 0; attempt < 50 && document.getElementById('sleepTime').value; attempt += 1) await tick();
  const localRecord = JSON.parse(localStorage.getItem('sleepRecords') || '[]').find((item) => item.date === captured[0]);
  return {
    captured,
    localRecord,
    reset: {
      datePresent: /^\\d{4}-\\d{2}-\\d{2}$/.test(document.getElementById('date').value),
      bedtime: document.getElementById('sleepTime').value,
      wakeTime: document.getElementById('wakeTime').value,
      bedtimeDisplay: document.getElementById('sleepTimePickerDisplay').textContent,
      quality: document.getElementById('quality').value,
      duration: document.getElementById('durationValue').textContent
    }
  };
})()`);

const esp32Errors = await evaluate(`(async () => {
  const originalFetch = window.fetch.bind(window);
  const originalSetTimeout = window.setTimeout.bind(window);
  const button = document.getElementById('esp32SyncBtn');
  async function waitForError() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = document.getElementById('pageStatus');
      if (status.classList.contains('is-error') && button.getAttribute('aria-busy') === 'false') return status.textContent;
      await new Promise((resolve) => originalSetTimeout(resolve, 20));
    }
    return '';
  }
  async function run(endpoint, handler) {
    window.fetch = (requested, options) => String(requested) === endpoint
      ? handler(options)
      : originalFetch(requested, options);
    localStorage.setItem('esp32EndpointUrl', endpoint);
    button.click();
    const message = await waitForError();
    const reopened = !document.getElementById('esp32EndpointModal').hidden && document.getElementById('esp32Endpoint').value === endpoint;
    document.getElementById('esp32EndpointCancel').click();
    return { message, reopened };
  }

  localStorage.removeItem('esp32EndpointUrl');
  button.click();
  const firstTimeDialog = !document.getElementById('esp32EndpointModal').hidden;
  document.getElementById('esp32Endpoint').value = 'ftp://esp32.test/data';
  document.getElementById('esp32EndpointForm').requestSubmit();
  const invalidUrl = document.getElementById('esp32EndpointError').textContent;
  document.getElementById('esp32EndpointCancel').click();
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
  return { firstTimeDialog, invalidUrl, malformed, cors, timeout };
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

  localStorage.setItem('esp32EndpointUrl', endpoint);
  document.getElementById('esp32SyncBtn').click();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (document.getElementById('pageStatus').classList.contains('is-success')) break;
    if (document.getElementById('pageStatus').classList.contains('is-error')) {
      throw new Error(document.getElementById('pageStatus').textContent);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ranges = await Promise.all([7, 30, 90].map((range) => window.ApiClient.getHealthAnalysis(range)));
  const sensorSeries = await window.ApiClient.getEnvironmentSeries();
  return {
    success: document.getElementById('pageStatus').classList.contains('is-success'),
    status: document.getElementById('pageStatus').textContent,
    uploadCalls,
    endpointSaved: localStorage.getItem('esp32EndpointUrl'),
    buttonShowsCompletion: /ESP32/.test(document.getElementById('esp32SyncBtn').textContent),
    oneVisibleControl: document.querySelectorAll('.connection-card #esp32SyncBtn').length === 1 && !document.querySelector('.connection-card #esp32Endpoint') && !document.querySelector('.esp32-panel'),
    historyRows: document.querySelectorAll('#healthHistoryBody tr').length,
    historyColumns: document.querySelector('#healthHistoryBody tr')?.children.length || 0,
    environmentCharts: !window.Chart || Boolean(Chart.getChart('environmentClimateChart') && Chart.getChart('environmentExposureChart')),
    sensorSeries: {
      sampleCount: sensorSeries.session?.sampleCount,
      fittedSampleCount: sensorSeries.quality?.fittedSampleCount,
      degree: sensorSeries.smoothing?.degree,
      alignment: sensorSeries.smoothing?.alignment
    },
    sensorCharts: !window.Chart || ['sensorTemperatureChart', 'sensorHumidityChart', 'sensorLightChart', 'sensorNoiseChart'].every((id) => {
      const chart = Chart.getChart(id);
      return chart && chart.data.datasets.length === 2 && chart.data.datasets.every((dataset) => dataset.tension === 0);
    }),
    sensorMeta: document.getElementById('sensorSessionMeta').textContent,
    sensorGridVisible: !document.getElementById('sensorChartGrid').hidden,
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
  endpoint: localStorage.getItem('esp32EndpointUrl'),
  syncEnabled: !document.getElementById('esp32SyncBtn').disabled,
  oneVisibleControl: document.querySelectorAll('.connection-card #esp32SyncBtn').length === 1 && !document.querySelector('.connection-card #esp32Endpoint') && !document.querySelector('.esp32-panel'),
  stressTileRemoved: !document.getElementById('latestStress')
})`);

await evaluate(`window.I18n.setLanguage('en')`);
await evaluate(`document.getElementById('datePickerTrigger').click()`);
await new Promise((resolve) => setTimeout(resolve, 80));
const english = await evaluate(`({
  title: document.querySelector('.site-header__page-title').textContent,
  nav: document.querySelector('.health-nav-link.is-active span:last-child').textContent,
  record: document.querySelector('#record-title').textContent,
  connectionTitle: document.getElementById('connection-title').textContent,
  sensorTitle: document.getElementById('sensor-session-title').textContent,
  pickerTitle: document.getElementById('pickerTitle').textContent,
  today: document.getElementById('pickerToday').textContent,
  cancel: document.getElementById('pickerCancel').textContent,
  apply: document.getElementById('pickerApply').textContent,
  dateDisplay: document.getElementById('datePickerDisplay').textContent
})`);
await evaluate(`document.getElementById('pickerCancel').click()`);
await evaluate(`document.getElementById('deviceChooserTrigger').click()`);
await new Promise((resolve) => setTimeout(resolve, 80));
const englishDeviceChooser = await evaluate(`({
  title: document.getElementById('deviceChooserTitle').textContent,
  nameLabel: document.querySelector('.device-name-field span').textContent,
  availableSoon: document.querySelector('.device-type-option.is-unavailable > span:nth-of-type(2)').textContent,
  triggerLabel: document.getElementById('deviceChooserTrigger').getAttribute('aria-label')
})`);
await evaluate(`document.getElementById('deviceChooserCancel').click()`);

const failures = layouts.flatMap((layout) => [
  !layout.noHorizontalOverflow && `${layout.name}: horizontal overflow (${layout.scrollWidth} > ${layout.viewport.width})`,
  !layout.footerInViewport && `${layout.name}: footer exceeds viewport`,
  layout.deviceBrand !== 'xiaomi' && `${layout.name}: disconnected fallback artwork is not Xiaomi`,
  layout.connectionTitle !== '数据同步' && `${layout.name}: connection card title is not Data Sync`,
  layout.deviceChooserTriggerTag !== 'BUTTON' && `${layout.name}: device artwork is not an interactive button`,
  layout.defaultDeviceName !== 'Mi Band' && `${layout.name}: inferred product name is not shown`,
  !layout.deviceArtworkLoaded && `${layout.name}: fallback artwork did not load`,
  layout.rangeButtons !== 3 && `${layout.name}: range buttons missing`,
  layout.chartCanvases !== 9 && `${layout.name}: environmental chart canvases missing`,
  !layout.sensorSectionPresent && `${layout.name}: recent sensor session section is missing`,
  !layout.compactEspControl && `${layout.name}: connection card does not contain exactly one compact ESP32 control`,
  !layout.stressTileRemoved && `${layout.name}: Stress tile still exists`,
  !layout.controlsMatch && `${layout.name}: selection controls do not share one visual style`,
  !layout.equalDesktopCardHeight && `${layout.name}: top cards are not equal height`,
  !layout.syncDisabledWithoutConnection && `${layout.name}: ESP32 sync is enabled without an active connection`,
  !layout.deviceChooser.open && `${layout.name}: device chooser did not open`,
  layout.deviceChooser.selectableOptions !== 2 || layout.deviceChooser.totalOptions !== 3 ? `${layout.name}: device chooser options are incomplete` : false,
  !layout.deviceChooser.unavailableDisabled && `${layout.name}: Available Soon can be selected`,
  layout.deviceChooser.selectedOptions !== 1 && `${layout.name}: device chooser selection state is invalid`,
  !layout.deviceChooser.artworkLoaded && `${layout.name}: chooser artwork did not load`,
  !layout.deviceChooser.withinViewport && `${layout.name}: device chooser exceeds the viewport`,
  !layout.deviceChooser.triggerExpanded && `${layout.name}: device chooser trigger does not expose expanded state`,
  !layout.deviceChooser.noHorizontalOverflow && `${layout.name}: device chooser causes horizontal overflow`,
  !layout.picker.open && `${layout.name}: liquid-glass date picker did not open`,
  layout.picker.dateCells !== 42 && `${layout.name}: date picker does not render a six-week grid`,
  layout.picker.selectedDates !== 1 && `${layout.name}: date picker selection state is invalid`,
  !layout.picker.hasBackdropBlur && `${layout.name}: picker is missing its liquid-glass blur`,
  !layout.picker.compactCalendar && `${layout.name}: calendar controller is still oversized`,
  !layout.picker.withinViewport && `${layout.name}: picker exceeds the viewport`,
  !layout.picker.mobileBottomSheet && `${layout.name}: mobile picker is not positioned as a bottom sheet`,
  !layout.picker.desktopAnchored && `${layout.name}: desktop picker is not anchored to its trigger`,
  !layout.picker.triggerExpanded && `${layout.name}: picker trigger does not expose its expanded state`,
  layout.timePicker.hours !== 24 || layout.timePicker.minutes !== 60 || layout.timePicker.firstHour !== '00' || layout.timePicker.lastHour !== '23' || layout.timePicker.firstMinute !== '00' || layout.timePicker.lastMinute !== '59' ? `${layout.name}: time picker is missing hour or minute choices` : false,
  layout.timePicker.columns !== 2 && `${layout.name}: time picker does not use separate hour and minute scrolls`,
  !layout.timePicker.compactHeight || !layout.timePicker.compactWidth ? `${layout.name}: time picker is not compact` : false,
  !layout.timePicker.withinViewport && `${layout.name}: time picker exceeds the viewport`,
  !layout.timePicker.selectedTimeVisible && `${layout.name}: selected time is not scrolled into view`,
  !layout.timePicker.noHorizontalOverflow && `${layout.name}: time picker causes horizontal overflow`,
  layout.hasMockGenerator && `${layout.name}: mock generator still exists`,
  !layout.formProminent && `${layout.name}: form is not above analysis`,
  !layout.connectionProminent && `${layout.name}: connection is not above analysis`
].filter(Boolean));
if (appleArtwork.brand !== 'apple' || appleArtwork.type !== 'apple' || appleArtwork.name !== 'Apple Watch' || appleArtwork.src !== 'assets/apple-watch.svg' || !appleArtwork.loaded || !appleArtwork.signedOutPreviewDiscarded) failures.push('Apple artwork selection or signed-out preview cleanup failed');
if (xiaomiArtwork.brand !== 'xiaomi' || xiaomiArtwork.type !== 'miband' || xiaomiArtwork.name !== 'Mi Band' || xiaomiArtwork.src !== 'assets/xiaomi-band.svg' || !xiaomiArtwork.loaded) failures.push('Mi Fitness package artwork selection failed');
if (unknownArtwork.brand !== 'xiaomi' || unknownArtwork.type !== 'miband' || unknownArtwork.name !== 'Mi Band' || unknownArtwork.src !== 'assets/xiaomi-band.svg' || !unknownArtwork.loaded) failures.push('Unknown-device fallback artwork selection failed');
if (!signedOutDevicePreview.unavailableIgnored || !signedOutDevicePreview.emptyNameRejected || !signedOutDevicePreview.modalClosed || signedOutDevicePreview.type !== 'apple' || signedOutDevicePreview.name !== 'Bedroom Watch' || signedOutDevicePreview.preview?.displayName !== 'Bedroom Watch' || !signedOutDevicePreview.status || !signedOutDevicePreview.focusRestored) failures.push('Signed-out device preview behavior failed');
if (signedOutPreviewReload.type !== 'apple' || signedOutPreviewReload.name !== 'Bedroom Watch' || !signedOutPreviewReload.previewPresent) failures.push('Signed-out device preview did not survive a session reload');
if (!devicePreferenceInteraction.cancelPreserved || !devicePreferenceInteraction.outsideClosed || !devicePreferenceInteraction.keyboardSelectedApple || !devicePreferenceInteraction.defaultChangedWithType || devicePreferenceInteraction.savedType !== 'apple' || devicePreferenceInteraction.savedName !== 'My Migraine Watch' || devicePreferenceInteraction.serverPreference?.displayName !== 'My Migraine Watch' || !devicePreferenceInteraction.focusRestored) failures.push('Account-backed device chooser interaction failed');
if (devicePreferenceAfterMetadataSync.type !== 'apple' || devicePreferenceAfterMetadataSync.name !== 'My Migraine Watch' || devicePreferenceAfterMetadataSync.reportedDeviceName !== 'Android Phone After Rename' || devicePreferenceAfterMetadataSync.preference?.displayName !== 'My Migraine Watch') failures.push('Android metadata refresh overwrote the display preference');
if (pickerInteraction.selectedBefore === pickerInteraction.selectedAfterArrow || pickerInteraction.keyboardDate !== pickerInteraction.selectedAfterArrow) failures.push('Date picker keyboard navigation failed');
if (pickerInteraction.originalMonth === pickerInteraction.navigatedMonth || !pickerInteraction.cancelPreservedDate || !pickerInteraction.focusTrapped || !pickerInteraction.outsideClosed) failures.push('Date navigation, cancellation, focus containment, or outside-click behavior failed');
if (pickerInteraction.todaySelection !== pickerInteraction.originalDate || pickerInteraction.finalDate !== pickerInteraction.originalDate) failures.push('Date picker Today action failed');
if (pickerInteraction.bedtime !== '23:59' || !pickerInteraction.cancelPreservedTime || !pickerInteraction.escapeClosed || !pickerInteraction.exactTimeGrid) failures.push('Exact-minute time picker, cancellation, or Escape behavior failed');
if (pickerInteraction.qualityChoiceCount !== 4 || pickerInteraction.qualityValues.join(',') !== 'excellent,good,fair,poor' || !pickerInteraction.qualityCommittedImmediately) failures.push('Custom sleep-quality selector did not commit all four values');
if (pickerInteraction.duration !== '07:02') failures.push('Overnight duration was not recalculated from picker values');
if (!pickerInteraction.validation || !pickerInteraction.noNativePickers) failures.push('Custom picker validation or native-control replacement failed');
if (pickerSave.captured?.[1]?.sleepTime !== '23:59' || pickerSave.captured?.[1]?.wakeTime !== '07:01' || pickerSave.captured?.[1]?.quality !== 'fair' || pickerSave.captured?.[1]?.duration?.totalMinutes !== 422) failures.push('Saved sleep request did not preserve exact picker values');
if (pickerSave.localRecord?.sleepTime !== '23:59' || pickerSave.localRecord?.quality !== 'fair' || pickerSave.reset.bedtime || pickerSave.reset.wakeTime || pickerSave.reset.quality !== 'excellent' || !pickerSave.reset.datePresent || pickerSave.reset.duration !== '--:--') failures.push('Picker values did not persist locally or reset after saving');
if (!esp32Errors.firstTimeDialog || !esp32Errors.invalidUrl || [esp32Errors.malformed, esp32Errors.cors, esp32Errors.timeout].some((result) => !result.message || !result.reopened)) failures.push('An ESP32 setup, URL, malformed-response, CORS, or timeout state was not shown correctly');
if (new Set([esp32Errors.invalidUrl, esp32Errors.malformed.message, esp32Errors.cors.message, esp32Errors.timeout.message]).size !== 4) failures.push('ESP32 error states were not specific to their failure causes');
if (!esp32Sync.success) failures.push('ESP32 sync did not reach its success state');
if (esp32Sync.uploadCalls !== 2) failures.push(`501 ESP32 samples used ${esp32Sync.uploadCalls} uploads instead of two 500-record chunks`);
if (esp32Sync.endpointSaved !== 'http://esp32.test/data') failures.push('ESP32 endpoint URL was not persisted');
if (!esp32Sync.oneVisibleControl || !esp32Sync.buttonShowsCompletion) failures.push('Compact ESP32 sync control did not show completion');
if (esp32Sync.historyRows < 1 || esp32Sync.historyColumns !== 11) failures.push('Environmental history columns or rows are missing');
if (!esp32Sync.environmentCharts) failures.push('Environmental charts were not created');
if (!esp32Sync.sensorCharts || !esp32Sync.sensorGridVisible || !esp32Sync.sensorMeta) failures.push('Recent sensor charts were not created after ESP32 sync');
if (esp32Sync.sensorSeries?.sampleCount !== 501 || esp32Sync.sensorSeries?.fittedSampleCount !== 201 || esp32Sync.sensorSeries?.degree !== 3 || esp32Sync.sensorSeries?.alignment !== 'trailing') failures.push('Recent sensor series does not contain the expected raw and fitted samples');
if (esp32Sync.rangeCoverage.some((item) => item.seriesLength !== item.range || !item.hasEnvironment)) failures.push('Environmental analysis is missing from a 7/30/90-day range');
if (esp32Reload.endpoint !== 'http://esp32.test/data' || !esp32Reload.syncEnabled || !esp32Reload.oneVisibleControl || !esp32Reload.stressTileRemoved) failures.push('ESP32 state did not reload correctly');
if (english.title !== 'Health Analysis' || english.nav !== 'Health Analysis' || english.record !== 'Record Sleep' || english.connectionTitle !== 'Data Sync' || english.sensorTitle !== 'Recent sensor session') failures.push('English translations did not apply');
if (english.pickerTitle !== 'Choose date' || english.today !== 'Today' || english.cancel !== 'Cancel' || english.apply !== 'Apply' || !/[A-Za-z]/.test(english.dateDisplay)) failures.push('English picker translations did not apply');
if (englishDeviceChooser.title !== 'Choose your device' || englishDeviceChooser.nameLabel !== 'Device name' || englishDeviceChooser.availableSoon !== 'Available soon' || englishDeviceChooser.triggerLabel !== 'Choose or rename device') failures.push('English device chooser translations did not apply');
const actionableErrors = errors.filter((error) => !error.includes('net::ERR_NETWORK_ACCESS_DENIED'));
if (actionableErrors.length) failures.push(...actionableErrors.map((error) => `browser: ${error}`));

console.log(JSON.stringify({ layouts, signedOutDevicePreview, signedOutPreviewReload, pickerInteraction, pickerSave, artwork: { appleArtwork, xiaomiArtwork, unknownArtwork }, devicePreferenceInteraction, devicePreferenceAfterMetadataSync, esp32Errors, esp32Sync, esp32Reload, english, englishDeviceChooser, errors: actionableErrors, blockedExternalResources: errors.length - actionableErrors.length }, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join('\n'));
