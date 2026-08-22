(function () {
  'use strict';

  const STORAGE_POSITION = 'aiChatButtonPositionV2';
  const STORAGE_HISTORY = 'aiChatHistory';
  const STORAGE_SPEECH = 'aiChatSpeakReplies';
  const DRAG_THRESHOLD = 7;
  const EDGE_MARGIN = 10;
  const HISTORY_LIMIT = 50;

  const copy = {
    en: {
      title: 'Migraine Signal AI',
      description: 'Uses up to 90 days of your migraine, sleep, wearable, and environment records with general health knowledge. Educational guidance only—not a diagnosis.',
      welcome: 'Ask about your migraine patterns, sleep, triggers, wearable readings, or environment. Sign in to use your records.',
      open: 'Open Migraine Signal AI', close: 'Close assistant', input: 'Ask a question…', send: 'Send message',
      microphone: 'Use voice input', stopMicrophone: 'Stop listening', speakerOn: 'Turn spoken replies off', speakerOff: 'Turn spoken replies on',
      listening: 'Listening… Your audio stays with the browser; only the transcript is sent.', thinking: 'DeepSeek is thinking…',
      unsupportedVoice: 'Voice input is not supported by this browser. You can continue with text chat.',
      deniedVoice: 'Microphone access was denied. Allow microphone permission or continue with text chat.',
      voiceError: 'Voice input stopped. Please try again or continue with text chat.',
      offline: 'The server is unavailable. Start the local Node server and try again.',
      retry: 'The assistant could not answer. Please try again.', personalized: 'Personalized from your records', general: 'General knowledge',
      data: { migraine: 'migraine', sleep: 'sleep', wearable: 'wearable', environment: 'environment' }
    },
    'zh-CN': {
      title: 'Migraine Signal AI',
      description: '结合最近 90 天的偏头痛、睡眠、可穿戴设备和环境记录，以及通用健康知识提供健康教育建议；不作医疗诊断。',
      welcome: '可以询问你的偏头痛规律、睡眠、触发因素、可穿戴数据或环境情况。登录后可结合个人记录回答。',
      open: '打开 Migraine Signal AI', close: '关闭助手', input: '输入你的问题…', send: '发送消息',
      microphone: '使用语音输入', stopMicrophone: '停止聆听', speakerOn: '关闭语音播报', speakerOff: '开启语音播报',
      listening: '正在聆听… 音频由浏览器处理，本应用只发送转写文字。', thinking: 'DeepSeek 正在思考…',
      unsupportedVoice: '当前浏览器不支持语音输入，你仍可继续使用文字聊天。',
      deniedVoice: '麦克风权限被拒绝，请允许麦克风权限或继续使用文字聊天。',
      voiceError: '语音输入已停止，请重试或继续使用文字聊天。',
      offline: '服务器不可用，请先启动本地 Node 服务后重试。',
      retry: '助手暂时无法回答，请重试。', personalized: '已结合你的记录', general: '通用知识',
      data: { migraine: '偏头痛', sleep: '睡眠', wearable: '可穿戴', environment: '环境' }
    }
  };

  let language = getLanguage();
  let strings = copy[language];
  let history = [];
  let sending = false;
  let recognition = null;
  let listening = false;
  let speechEnabled = localStorage.getItem(STORAGE_SPEECH) === 'true';
  let dragState = null;
  let suppressNextClick = false;

  function getLanguage() {
    const selected = window.I18n && typeof window.I18n.getLanguage === 'function'
      ? window.I18n.getLanguage()
      : document.documentElement.lang;
    return String(selected || '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderMarkdown(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
      .replace(/^[-*]\s+(.+)$/gm, '• $1')
      .replace(/\n/g, '<br>');
  }

  function mount() {
    document.querySelectorAll('.chat-bubble-btn, #chat-container').forEach((element) => element.remove());
    const root = document.createElement('div');
    root.className = 'ai-chat-widget';
    root.id = 'ai-chat-widget';
    root.innerHTML = `
      <button class="ai-chat-launcher" id="ai-chat-launcher" type="button" aria-haspopup="dialog" aria-expanded="false">
        <img src="assets/ai-chat-icon.svg" alt="" draggable="false">
      </button>
      <section class="ai-chat-panel" id="ai-chat-panel" role="dialog" aria-modal="false" aria-labelledby="ai-chat-title" aria-describedby="ai-chat-description">
        <header class="ai-chat-header">
          <div class="ai-chat-header__copy">
            <h2 class="ai-chat-title" id="ai-chat-title"></h2>
            <p class="ai-chat-description" id="ai-chat-description"></p>
          </div>
          <button class="ai-chat-icon-button" id="ai-chat-speaker" type="button" aria-pressed="false"><span aria-hidden="true">🔈</span></button>
          <button class="ai-chat-icon-button" id="ai-chat-close" type="button"><span aria-hidden="true">×</span></button>
        </header>
        <div class="ai-chat-messages" id="ai-chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="ai-chat-status" id="ai-chat-status" role="status" hidden></div>
        <div class="ai-chat-compose">
          <button class="ai-chat-icon-button" id="ai-chat-microphone" type="button" aria-pressed="false"><span aria-hidden="true">🎙</span></button>
          <textarea class="ai-chat-input" id="ai-chat-input" rows="1" maxlength="4000"></textarea>
          <button class="ai-chat-icon-button ai-chat-send" id="ai-chat-send" type="button"><span aria-hidden="true">➤</span></button>
        </div>
      </section>`;
    document.body.appendChild(root);
    bindElements();
    updateCopy();
    installEvents();
    initRecognition();
    requestAnimationFrame(() => {
      applyStoredPosition();
      loadHistory();
    });
  }

  let launcher;
  let panel;
  let messages;
  let status;
  let input;
  let sendButton;
  let microphoneButton;
  let speakerButton;
  let closeButton;

  function bindElements() {
    launcher = document.getElementById('ai-chat-launcher');
    panel = document.getElementById('ai-chat-panel');
    messages = document.getElementById('ai-chat-messages');
    status = document.getElementById('ai-chat-status');
    input = document.getElementById('ai-chat-input');
    sendButton = document.getElementById('ai-chat-send');
    microphoneButton = document.getElementById('ai-chat-microphone');
    speakerButton = document.getElementById('ai-chat-speaker');
    closeButton = document.getElementById('ai-chat-close');
  }

  function updateCopy() {
    language = getLanguage();
    strings = copy[language];
    document.getElementById('ai-chat-title').textContent = strings.title;
    document.getElementById('ai-chat-description').textContent = strings.description;
    launcher.setAttribute('aria-label', strings.open);
    closeButton.setAttribute('aria-label', strings.close);
    input.setAttribute('placeholder', strings.input);
    input.setAttribute('aria-label', strings.input);
    sendButton.setAttribute('aria-label', strings.send);
    microphoneButton.setAttribute('aria-label', listening ? strings.stopMicrophone : strings.microphone);
    speakerButton.setAttribute('aria-label', speechEnabled ? strings.speakerOn : strings.speakerOff);
    speakerButton.setAttribute('aria-pressed', String(speechEnabled));
    const welcome = messages && messages.querySelector('.ai-chat-welcome');
    if (welcome) welcome.textContent = strings.welcome;
  }

  function installEvents() {
    launcher.addEventListener('pointerdown', onPointerDown);
    launcher.addEventListener('pointermove', onPointerMove);
    launcher.addEventListener('pointerup', onPointerUp);
    launcher.addEventListener('pointercancel', onPointerCancel);
    launcher.addEventListener('click', () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      togglePanel();
    });
    closeButton.addEventListener('click', closePanel);
    sendButton.addEventListener('click', sendMessage);
    microphoneButton.addEventListener('click', toggleRecognition);
    speakerButton.addEventListener('click', toggleSpeech);
    input.addEventListener('input', resizeInput);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
    });
    window.addEventListener('resize', () => {
      applyStoredPosition();
      if (panel.classList.contains('is-open')) positionPanel();
    });
    window.addEventListener('orientationchange', () => setTimeout(() => {
      applyStoredPosition();
      if (panel.classList.contains('is-open')) positionPanel();
    }, 100));
    window.addEventListener('migraine:languagechange', updateCopy);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, dragging: false };
    launcher.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragState.dragging = true;
    launcher.classList.add('is-dragging');
    setLauncherPosition(dragState.left + dx, dragState.top + dy);
    if (panel.classList.contains('is-open')) positionPanel();
  }

  function onPointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const wasDragging = dragState.dragging;
    launcher.releasePointerCapture(event.pointerId);
    launcher.classList.remove('is-dragging');
    dragState = null;
    if (wasDragging) {
      suppressNextClick = true;
      snapToNearestEdge();
      savePosition();
      if (panel.classList.contains('is-open')) positionPanel();
    }
  }

  function onPointerCancel() {
    launcher.classList.remove('is-dragging');
    dragState = null;
  }

  function viewportBounds() {
    const viewport = window.visualViewport;
    const viewportLeft = viewport ? viewport.offsetLeft : 0;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportWidth = viewport ? viewport.width : document.documentElement.clientWidth;
    const viewportHeight = viewport ? viewport.height : document.documentElement.clientHeight;
    return {
      minLeft: viewportLeft + EDGE_MARGIN,
      minTop: viewportTop + EDGE_MARGIN,
      maxLeft: Math.max(viewportLeft + EDGE_MARGIN, viewportLeft + viewportWidth - launcher.offsetWidth - EDGE_MARGIN),
      maxTop: Math.max(viewportTop + EDGE_MARGIN, viewportTop + viewportHeight - launcher.offsetHeight - EDGE_MARGIN)
    };
  }

  function setLauncherPosition(left, top) {
    const bounds = viewportBounds();
    launcher.style.left = `${Math.min(bounds.maxLeft, Math.max(bounds.minLeft, left))}px`;
    launcher.style.top = `${Math.min(bounds.maxTop, Math.max(bounds.minTop, top))}px`;
  }

  function snapToNearestEdge() {
    const rect = launcher.getBoundingClientRect();
    const bounds = viewportBounds();
    const distances = [
      { edge: 'left', value: rect.left - bounds.minLeft },
      { edge: 'right', value: bounds.maxLeft - rect.left },
      { edge: 'top', value: rect.top - bounds.minTop },
      { edge: 'bottom', value: bounds.maxTop - rect.top }
    ].sort((a, b) => a.value - b.value);
    let left = rect.left;
    let top = rect.top;
    if (distances[0].edge === 'left') left = bounds.minLeft;
    if (distances[0].edge === 'right') left = bounds.maxLeft;
    if (distances[0].edge === 'top') top = bounds.minTop;
    if (distances[0].edge === 'bottom') top = bounds.maxTop;
    setLauncherPosition(left, top);
  }

  function savePosition() {
    const rect = launcher.getBoundingClientRect();
    const bounds = viewportBounds();
    const widthRange = Math.max(1, bounds.maxLeft - bounds.minLeft);
    const heightRange = Math.max(1, bounds.maxTop - bounds.minTop);
    localStorage.setItem(STORAGE_POSITION, JSON.stringify({
      x: (rect.left - bounds.minLeft) / widthRange,
      y: (rect.top - bounds.minTop) / heightRange
    }));
  }

  function applyStoredPosition() {
    const bounds = viewportBounds();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_POSITION)); } catch (error) { stored = null; }
    const x = stored && Number.isFinite(stored.x) ? Math.min(1, Math.max(0, stored.x)) : 1;
    const y = stored && Number.isFinite(stored.y) ? Math.min(1, Math.max(0, stored.y)) : 1;
    setLauncherPosition(
      bounds.minLeft + x * Math.max(1, bounds.maxLeft - bounds.minLeft),
      bounds.minTop + y * Math.max(1, bounds.maxTop - bounds.minTop)
    );
  }

  function togglePanel() {
    if (panel.classList.contains('is-open')) closePanel(); else openPanel();
  }

  function openPanel() {
    panel.classList.add('is-open');
    launcher.setAttribute('aria-expanded', 'true');
    positionPanel();
    setTimeout(() => input.focus(), 180);
  }

  function closePanel() {
    panel.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    stopRecognition();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    launcher.focus();
  }

  function positionPanel() {
    const anchor = launcher.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const viewport = window.visualViewport;
    const viewportLeft = viewport ? viewport.offsetLeft : 0;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportRight = viewportLeft + (viewport ? viewport.width : document.documentElement.clientWidth);
    const viewportBottom = viewportTop + (viewport ? viewport.height : document.documentElement.clientHeight);
    const gap = 10;
    let left = anchor.right + gap;
    if (left + panelWidth > viewportRight - EDGE_MARGIN) left = anchor.left - panelWidth - gap;
    let top = anchor.bottom - panelHeight;
    if (top < viewportTop + EDGE_MARGIN) top = anchor.top;
    left = Math.max(viewportLeft + EDGE_MARGIN, Math.min(left, viewportRight - panelWidth - EDGE_MARGIN));
    top = Math.max(viewportTop + EDGE_MARGIN, Math.min(top, viewportBottom - panelHeight - EDGE_MARGIN));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function showWelcome() {
    if (history.length || messages.querySelector('.ai-chat-welcome')) return;
    const element = document.createElement('p');
    element.className = 'ai-chat-welcome';
    element.textContent = strings.welcome;
    messages.appendChild(element);
  }

  function displayMessage(content, role, metadata) {
    const welcome = messages.querySelector('.ai-chat-welcome');
    if (welcome) welcome.remove();
    const element = document.createElement('div');
    element.className = `ai-chat-message ai-chat-message--${role === 'user' ? 'user' : 'assistant'}`;
    element.setAttribute('data-i18n-skip', '');
    element.setAttribute('data-user-content', '');
    if (metadata && metadata.error) element.classList.add('ai-chat-message--error');
    element.innerHTML = renderMarkdown(content);
    if (role !== 'user' && metadata) {
      const meta = document.createElement('div');
      meta.className = 'ai-chat-meta';
      const label = document.createElement('span');
      label.className = 'ai-chat-chip';
      label.textContent = metadata.personalized ? strings.personalized : strings.general;
      meta.appendChild(label);
      (metadata.usedDataCategories || []).forEach((category) => {
        const chip = document.createElement('span');
        chip.className = 'ai-chat-chip';
        chip.textContent = strings.data[category] || category;
        meta.appendChild(chip);
      });
      element.appendChild(meta);
    }
    messages.appendChild(element);
    messages.scrollTop = messages.scrollHeight;
  }

  function setStatus(message, className) {
    status.textContent = message || '';
    status.hidden = !message;
    status.className = `ai-chat-status${className ? ` ${className}` : ''}`;
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function setSending(value) {
    sending = value;
    sendButton.disabled = value;
    input.disabled = value;
    microphoneButton.disabled = value;
  }

  async function loadHistory() {
    history = [];
    try {
      if (window.ApiClient && window.ApiClient.hasToken()) {
        const data = await window.ApiClient.chatHistory();
        history = Array.isArray(data.messages) ? data.messages.slice(-HISTORY_LIMIT).map((item) => ({ role: item.role, content: item.content })) : [];
      } else {
        const local = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
        history = Array.isArray(local) ? local.slice(-HISTORY_LIMIT).map((item) => ({ role: item.role || (item.sender === 'user' ? 'user' : 'assistant'), content: item.content || item.text || '' })).filter((item) => item.content) : [];
      }
    } catch (error) {
      history = [];
    }
    messages.textContent = '';
    history.forEach((item) => displayMessage(item.content, item.role));
    showWelcome();
  }

  function saveGuestHistory() {
    if (window.ApiClient && window.ApiClient.hasToken()) return;
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  }

  async function sendMessage() {
    const content = input.value.trim();
    if (!content || sending) return;
    const priorHistory = history.slice(-20);
    history.push({ role: 'user', content });
    displayMessage(content, 'user');
    saveGuestHistory();
    input.value = '';
    resizeInput();
    stopRecognition();
    setSending(true);
    setStatus(strings.thinking);
    try {
      if (!window.ApiClient) throw new Error(strings.offline);
      const data = await window.ApiClient.chat(content, priorHistory);
      history.push({ role: 'assistant', content: data.reply });
      history = history.slice(-HISTORY_LIMIT);
      displayMessage(data.reply, 'assistant', data);
      saveGuestHistory();
      if (speechEnabled) speak(data.reply);
      setStatus('');
    } catch (error) {
      const message = error && error.message ? error.message : strings.retry;
      displayMessage(message, 'assistant', { error: true, personalized: false, usedDataCategories: [] });
      setStatus('');
    } finally {
      setSending(false);
      if (panel.classList.contains('is-open')) input.focus();
    }
  }

  function initRecognition() {
    const Recognition = Object.prototype.hasOwnProperty.call(window, 'MigraineSignalSpeechRecognition')
      ? window.MigraineSignalSpeechRecognition
      : (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!Recognition) {
      microphoneButton.setAttribute('aria-disabled', 'true');
      return;
    }
    recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      listening = true;
      microphoneButton.setAttribute('aria-pressed', 'true');
      microphoneButton.setAttribute('aria-label', strings.stopMicrophone);
      setStatus(strings.listening, 'is-listening');
    };
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0].transcript;
      input.value = transcript;
      resizeInput();
    };
    recognition.onerror = (event) => {
      setStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? strings.deniedVoice : strings.voiceError);
    };
    recognition.onend = () => {
      listening = false;
      microphoneButton.setAttribute('aria-pressed', 'false');
      microphoneButton.setAttribute('aria-label', strings.microphone);
      if (status.classList.contains('is-listening')) setStatus('');
      if (panel.classList.contains('is-open')) input.focus();
    };
  }

  function toggleRecognition() {
    if (!recognition) {
      setStatus(strings.unsupportedVoice);
      return;
    }
    if (listening) {
      stopRecognition();
      return;
    }
    recognition.lang = language === 'en' ? 'en-US' : 'zh-CN';
    try { recognition.start(); } catch (error) { setStatus(strings.voiceError); }
  }

  function stopRecognition() {
    if (recognition && listening) recognition.stop();
  }

  function toggleSpeech() {
    speechEnabled = !speechEnabled;
    localStorage.setItem(STORAGE_SPEECH, String(speechEnabled));
    if (!speechEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
    updateCopy();
  }

  function speak(text) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text).replace(/[*#`]/g, ''));
    utterance.lang = language === 'en' ? 'en-US' : 'zh-CN';
    window.speechSynthesis.speak(utterance);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
