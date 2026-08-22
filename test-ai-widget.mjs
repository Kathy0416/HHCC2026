import fs from 'node:fs';

const debugPort = process.env.AI_WIDGET_DEBUG_PORT || '9334';
const appOrigin = process.env.AI_WIDGET_ORIGIN || 'http://127.0.0.1:3210';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('No Chrome page target was found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    requestId += 1;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('#ai-chat-launcher'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('AI widget did not mount');
}

async function navigate(pathname) {
  await call('Page.navigate', { url: `${appOrigin}/${pathname}` });
  await ready();
}

async function clickAt(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function pressEscape() {
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await navigate('index.html');
await evaluate(`localStorage.removeItem('aiChatButtonPositionV2')`);
await navigate('index.html');

const initial = await evaluate(`(() => {
  const button = document.querySelector('#ai-chat-launcher');
  const image = button.querySelector('img');
  const box = button.getBoundingClientRect();
  return {
    iconLoaded: image.complete && image.naturalWidth > 0,
    iconSource: image.getAttribute('src'),
    inViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    expanded: button.getAttribute('aria-expanded')
  };
})()`);

const start = await evaluate(`(() => { const box = document.querySelector('#ai-chat-launcher').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2, left: box.left, top: box.top }; })()`);
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - 160, y: start.y - 100, button: 'left' });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x - 160, y: start.y - 100, button: 'left', clickCount: 1 });
const dragged = await evaluate(`(() => { const button = document.querySelector('#ai-chat-launcher'); const box = button.getBoundingClientRect(); return { moved: Math.abs(box.left - ${start.left}) > 50 || Math.abs(box.top - ${start.top}) > 50, stayedClosed: button.getAttribute('aria-expanded') === 'false', stored: Boolean(localStorage.getItem('aiChatButtonPositionV2')) }; })()`);

const buttonCenter = await evaluate(`(() => { const box = document.querySelector('#ai-chat-launcher').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
await clickAt(buttonCenter.x, buttonCenter.y);
await new Promise((resolve) => setTimeout(resolve, 250));
const opened = await evaluate(`(() => { const panel = document.querySelector('#ai-chat-panel'); const box = panel.getBoundingClientRect(); const viewport = visualViewport || { offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight }; return { open: panel.classList.contains('is-open'), inViewport: box.left >= viewport.offsetLeft - 1 && box.top >= viewport.offsetTop - 1 && box.right <= viewport.offsetLeft + viewport.width + 1 && box.bottom <= viewport.offsetTop + viewport.height + 1, focusedInput: document.activeElement.id === 'ai-chat-input', panelBounds: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, viewportBounds: { left: viewport.offsetLeft, top: viewport.offsetTop, right: viewport.offsetLeft + viewport.width, bottom: viewport.offsetTop + viewport.height } }; })()`);
await evaluate(`document.querySelector('#ai-chat-speaker').click()`);
const speakerEnabled = await evaluate(`document.querySelector('#ai-chat-speaker').getAttribute('aria-pressed') === 'true' && localStorage.getItem('aiChatSpeakReplies') === 'true'`);
await evaluate(`document.querySelector('#ai-chat-speaker').click()`);
await evaluate(`(() => { const input = document.querySelector('#ai-chat-input'); input.value = 'Can you use my records?'; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#ai-chat-send').click(); })()`);
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate(`Boolean(document.querySelector('.ai-chat-message--error'))`)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const configurationError = await evaluate(`(() => ({
  visible: Boolean(document.querySelector('.ai-chat-message--error')),
  actionable: /DEEPSEEK_API_KEY|DeepSeek/.test(document.querySelector('.ai-chat-message--error')?.textContent || ''),
  sendReenabled: !document.querySelector('#ai-chat-send').disabled
}))()`);
const desktopShot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync('ai-widget-open-desktop.png', Buffer.from(desktopShot.data, 'base64'));
await pressEscape();
const escaped = await evaluate(`!document.querySelector('#ai-chat-panel').classList.contains('is-open')`);

const layouts = [];
for (const viewport of [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }]) {
  await call('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  for (const pathname of ['index.html', 'diary.html', 'sleep.html', 'tips.html', 'my.html', 'ai-chat.html']) {
    await navigate(pathname);
    await evaluate(`document.querySelector('#ai-chat-launcher').click()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const result = await evaluate(`(() => {
      const button = document.querySelector('#ai-chat-launcher').getBoundingClientRect();
      const panel = document.querySelector('#ai-chat-panel').getBoundingClientRect();
      const viewport = visualViewport || { offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight };
      return {
        buttonInViewport: button.left >= viewport.offsetLeft - 1 && button.top >= viewport.offsetTop - 1 && button.right <= viewport.offsetLeft + viewport.width + 1 && button.bottom <= viewport.offsetTop + viewport.height + 1,
        panelInViewport: panel.left >= viewport.offsetLeft - 1 && panel.top >= viewport.offsetTop - 1 && panel.right <= viewport.offsetLeft + viewport.width + 1 && panel.bottom <= viewport.offsetTop + viewport.height + 1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        iconLoaded: document.querySelector('#ai-chat-launcher img').naturalWidth > 0
      };
    })()`);
    layouts.push({ viewport: viewport.name, pathname, ...result });
  }
}

await navigate('test-ai-chat-voice.html?mode=success');
await evaluate(`document.querySelector('#ai-chat-launcher').click(); document.querySelector('#ai-chat-microphone').click()`);
const voiceStarted = await evaluate(`(() => ({ transcript: document.querySelector('#ai-chat-input').value, pressed: document.querySelector('#ai-chat-microphone').getAttribute('aria-pressed') }))()`);
await evaluate(`document.querySelector('#ai-chat-microphone').click()`);
const voiceStopped = await evaluate(`document.querySelector('#ai-chat-microphone').getAttribute('aria-pressed') === 'false'`);
await navigate('test-ai-chat-voice.html?mode=denied');
await evaluate(`document.querySelector('#ai-chat-launcher').click(); document.querySelector('#ai-chat-microphone').click()`);
const voiceDenied = await evaluate(`/denied|权限被拒绝/i.test(document.querySelector('#ai-chat-status').textContent)`);
await navigate('test-ai-chat-voice.html?mode=unsupported');
await evaluate(`document.querySelector('#ai-chat-microphone').click()`);
const voiceUnsupported = await evaluate(`(() => ({
  markedUnavailable: document.querySelector('#ai-chat-microphone').getAttribute('aria-disabled') === 'true',
  explained: /not supported|不支持/i.test(document.querySelector('#ai-chat-status').textContent)
}))()`);

await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await navigate('sleep.html');
await evaluate(`document.querySelector('#ai-chat-launcher').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
const mobileShot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync('ai-widget-open-mobile.png', Buffer.from(mobileShot.data, 'base64'));

const failedLayouts = layouts.filter((item) => !item.buttonInViewport || !item.panelInViewport || !item.noHorizontalOverflow || !item.iconLoaded);
const voice = { started: voiceStarted.transcript === 'voice question' && voiceStarted.pressed === 'true', stopped: voiceStopped, denied: voiceDenied, unsupported: voiceUnsupported, speakerEnabled };
const result = { initial, dragged, opened, voice, configurationError, escaped, layouts, failedLayouts };
console.log(JSON.stringify(result, null, 2));
if (!initial.iconLoaded || !initial.inViewport || !dragged.moved || !dragged.stayedClosed || !dragged.stored || !opened.open || !opened.inViewport || !voice.started || !voice.stopped || !voice.denied || !voice.unsupported.markedUnavailable || !voice.unsupported.explained || !voice.speakerEnabled || !configurationError.visible || !configurationError.actionable || !configurationError.sendReenabled || !escaped || failedLayouts.length) process.exitCode = 1;
socket.close();
