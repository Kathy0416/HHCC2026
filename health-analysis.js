(function () {
  'use strict';

  const state = { range: 30, analysis: null, connection: null, latest: null, environmentLatest: null, devicePreference: null, devicePreferenceSaving: false, esp32Syncing: false, esp32Synced: false, charts: {} };
  const QUALITY = new Set(['excellent', 'good', 'fair', 'poor']);
  const ESP32_ENDPOINT_KEY = 'esp32EndpointUrl';
  const DEVICE_PREVIEW_KEY = 'healthDevicePreview';
  const ESP32_UPLOAD_CHUNK_SIZE = 500;
  const DEVICE_ARTWORK = Object.freeze({
    apple: 'assets/apple-watch.svg',
    miband: 'assets/xiaomi-band.svg'
  });
  const DEVICE_TYPES = new Set(['apple', 'miband']);
  const deviceChooserState = { open: false, type: 'miband', trigger: null };
  const pickerState = {
    open: false, type: null, targetId: null, trigger: null,
    pendingDate: '', viewMonth: null, pendingTime: '', pendingQuality: 'excellent'
  };

  function t(key, variables) {
    return window.I18n ? window.I18n.t(key, variables) : key;
  }

  function locale() {
    return window.I18n ? window.I18n.getLanguage() : 'en';
  }

  function setStatus(message, type) {
    const element = document.getElementById('pageStatus');
    element.textContent = message || '';
    element.className = `page-status${type ? ` is-${type}` : ''}`;
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (error) { return null; }
  }

  function showModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
  }

  function hideModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
  }

  function updateAuthHeader() {
    const user = currentUser();
    const authButtons = document.getElementById('authBtns');
    const userStatus = document.getElementById('userStatus');
    const username = document.getElementById('usernameDisplay');
    if (!authButtons || !userStatus) return;
    authButtons.style.display = user ? 'none' : 'flex';
    userStatus.style.display = user ? 'flex' : 'none';
    if (username) username.textContent = user ? user.username : '';
  }

  function initAuth() {
    updateAuthHeader();
    document.getElementById('loginBtn')?.addEventListener('click', () => showModal('loginModal'));
    document.getElementById('registerBtn')?.addEventListener('click', () => showModal('registerModal'));
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      window.ApiClient?.setToken('');
      window.ApiClient?.clearLocalData();
      localStorage.removeItem('currentUser');
      updateAuthHeader();
      state.connection = null;
      state.latest = null;
      state.environmentLatest = null;
      state.devicePreference = null;
      renderConnection();
      renderLocalAnalysis();
      setStatus(t('health.record.loginRequired'));
    });
    document.querySelectorAll('.close-modal').forEach((button) => button.addEventListener('click', () => hideModal(button.closest('.modal').id)));
    document.getElementById('switchToRegister')?.addEventListener('click', (event) => { event.preventDefault(); hideModal('loginModal'); showModal('registerModal'); });
    document.getElementById('switchToLogin')?.addEventListener('click', (event) => { event.preventDefault(); hideModal('registerModal'); showModal('loginModal'); });
    document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) hideModal(modal.id); }));

    document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await window.ApiClient.login(
          document.getElementById('loginUsername').value.trim(),
          document.getElementById('loginPassword').value
        );
        window.ApiClient.setToken(data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        sessionStorage.removeItem(DEVICE_PREVIEW_KEY);
        hideModal('loginModal');
        updateAuthHeader();
        await loadAll();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    document.getElementById('registerForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = document.getElementById('registerPassword').value;
      if (password !== document.getElementById('registerConfirmPassword').value) {
        setStatus(locale() === 'en' ? 'The passwords do not match.' : '两次输入的密码不一致。', 'error');
        return;
      }
      try {
        const data = await window.ApiClient.register(document.getElementById('registerUsername').value.trim(), password);
        window.ApiClient.setToken(data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        sessionStorage.removeItem(DEVICE_PREVIEW_KEY);
        hideModal('registerModal');
        updateAuthHeader();
        await loadAll();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  }

  function localToday() {
    const value = new Date();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  function dateFromIso(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoFromDate(value) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  function formatPickerDate(value, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
    const date = dateFromIso(value);
    return date ? new Intl.DateTimeFormat(locale(), options).format(date) : t('health.picker.selectDate');
  }

  function refreshPickerTriggers() {
    document.getElementById('datePickerDisplay').textContent = formatPickerDate(document.getElementById('date').value);
    for (const targetId of ['sleepTime', 'wakeTime']) {
      const value = document.getElementById(targetId).value;
      document.getElementById(`${targetId}PickerDisplay`).textContent = value || t('health.picker.selectTime');
    }
    const quality = QUALITY.has(document.getElementById('quality').value) ? document.getElementById('quality').value : 'excellent';
    document.getElementById('qualityPickerDisplay').textContent = t(`sleep.quality.${quality}`);
  }

  function showSleepFormError(message = '') {
    const element = document.getElementById('sleepFormError');
    element.textContent = message;
    element.hidden = !message;
  }

  function pickerTitle() {
    if (pickerState.type === 'date') return t('health.picker.chooseDate');
    if (pickerState.type === 'quality') return t('health.picker.chooseQuality');
    return t(pickerState.targetId === 'sleepTime' ? 'health.picker.chooseBedtime' : 'health.picker.chooseWakeTime');
  }

  function renderPickerWeekdays() {
    const container = document.getElementById('pickerWeekdays');
    container.replaceChildren();
    const formatter = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
    const sunday = new Date(2024, 0, 7, 12);
    for (let index = 0; index < 7; index += 1) {
      const day = new Date(sunday); day.setDate(sunday.getDate() + index);
      const label = document.createElement('span'); label.textContent = formatter.format(day); container.appendChild(label);
    }
  }

  function renderDatePicker(focusSelected = false) {
    const selected = dateFromIso(pickerState.pendingDate) || dateFromIso(localToday());
    const month = pickerState.viewMonth || new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
    pickerState.viewMonth = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    document.getElementById('pickerMonthLabel').textContent = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(month);
    renderPickerWeekdays();

    const grid = document.getElementById('pickerDays');
    grid.replaceChildren();
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay(), 12);
    const today = localToday();
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const iso = isoFromDate(date);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'picker-day'; button.dataset.date = iso; button.textContent = String(date.getDate());
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', formatPickerDate(iso, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
      button.setAttribute('aria-selected', String(iso === pickerState.pendingDate));
      button.tabIndex = iso === pickerState.pendingDate ? 0 : -1;
      if (date.getMonth() !== month.getMonth()) button.classList.add('is-adjacent');
      if (iso === today) button.classList.add('is-today');
      if (iso === pickerState.pendingDate) button.classList.add('is-selected');
      grid.appendChild(button);
    }
    if (focusSelected) requestAnimationFrame(() => grid.querySelector('.is-selected')?.focus());
  }

  function renderTimePicker(focusSelected = false) {
    const [selectedHour, selectedMinute] = pickerState.pendingTime.split(':').map(Number);
    const renderColumn = (id, part, count, selectedValue) => {
      const list = document.getElementById(id);
      const fragment = document.createDocumentFragment();
      list.replaceChildren();
      for (let value = 0; value < count; value += 1) {
        const selected = value === selectedValue;
        const button = document.createElement('button'); button.type = 'button'; button.dataset[part] = String(value);
        button.className = `picker-choice${selected ? ' is-selected' : ''}`; button.textContent = String(value).padStart(2, '0');
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(selected));
        button.setAttribute('aria-posinset', String(value + 1)); button.setAttribute('aria-setsize', String(count));
        button.tabIndex = selected ? 0 : -1; fragment.appendChild(button);
      }
      list.appendChild(fragment);
    };
    renderColumn('pickerHours', 'hour', 24, selectedHour);
    renderColumn('pickerMinutes', 'minute', 60, selectedMinute);
    requestAnimationFrame(() => {
      for (const id of ['pickerHours', 'pickerMinutes']) {
        const list = document.getElementById(id); const selected = list.querySelector('.is-selected');
        list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2);
      }
      if (focusSelected) document.querySelector('#pickerHours .is-selected')?.focus({ preventScroll: true });
    });
  }

  function selectTimePart(part, value, focus = false) {
    const [hour, minute] = pickerState.pendingTime.split(':').map(Number);
    pickerState.pendingTime = part === 'hour'
      ? `${String(value).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : `${String(hour).padStart(2, '0')}:${String(value).padStart(2, '0')}`;
    const list = document.getElementById(part === 'hour' ? 'pickerHours' : 'pickerMinutes');
    list.querySelector('.is-selected')?.classList.remove('is-selected');
    list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    const selected = list.querySelector(`[data-${part}="${value}"]`);
    selected.classList.add('is-selected'); selected.setAttribute('aria-selected', 'true');
    list.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1'); selected.tabIndex = 0;
    if (focus) {
      selected.focus({ preventScroll: true });
      list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2);
    }
  }

  function renderQualityPicker(focusSelected = false) {
    const list = document.getElementById('pickerQualities');
    list.replaceChildren();
    for (const quality of QUALITY) {
      const selected = quality === pickerState.pendingQuality;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.quality = quality;
      button.className = `picker-choice${selected ? ' is-selected' : ''}`; button.textContent = t(`sleep.quality.${quality}`);
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      list.appendChild(button);
    }
    if (focusSelected) requestAnimationFrame(() => list.querySelector('.is-selected')?.focus());
  }

  function positionPicker() {
    const picker = document.getElementById('glassPicker');
    picker.style.removeProperty('left'); picker.style.removeProperty('top');
    if (!pickerState.open || window.matchMedia('(max-width: 640px)').matches) return;
    const trigger = pickerState.trigger.getBoundingClientRect();
    const bounds = picker.getBoundingClientRect();
    const left = Math.max(12, Math.min(trigger.left, window.innerWidth - bounds.width - 12));
    const below = trigger.bottom + 12;
    const top = below + bounds.height <= window.innerHeight - 12 ? below : Math.max(12, trigger.top - bounds.height - 12);
    picker.style.left = `${Math.round(left)}px`; picker.style.top = `${Math.round(top)}px`;
  }

  function refreshOpenPicker() {
    if (!pickerState.open) return;
    document.getElementById('pickerTitle').textContent = pickerTitle();
    if (pickerState.type === 'date') renderDatePicker();
    else if (pickerState.type === 'time') renderTimePicker();
    else renderQualityPicker();
    positionPicker();
  }

  function openPicker(trigger) {
    pickerState.open = true; pickerState.type = trigger.dataset.picker;
    pickerState.targetId = trigger.dataset.target || 'date'; pickerState.trigger = trigger;
    if (pickerState.type === 'date') {
      pickerState.pendingDate = document.getElementById('date').value || localToday();
      const selected = dateFromIso(pickerState.pendingDate);
      pickerState.viewMonth = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
    } else if (pickerState.type === 'time') {
      const value = document.getElementById(pickerState.targetId).value;
      const now = new Date();
      pickerState.pendingTime = /^\d{2}:\d{2}$/.test(value)
        ? value
        : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    } else {
      const value = document.getElementById('quality').value;
      pickerState.pendingQuality = QUALITY.has(value) ? value : 'excellent';
    }
    document.querySelectorAll('.glass-picker-trigger').forEach((item) => item.setAttribute('aria-expanded', String(item === trigger)));
    document.getElementById('datePickerView').hidden = pickerState.type !== 'date';
    document.getElementById('timePickerView').hidden = pickerState.type !== 'time';
    document.getElementById('qualityPickerView').hidden = pickerState.type !== 'quality';
    document.getElementById('pickerToday').hidden = pickerState.type !== 'date';
    document.getElementById('pickerActions').hidden = pickerState.type === 'quality';
    document.getElementById('glassPicker').classList.toggle('is-time', pickerState.type === 'time');
    document.getElementById('glassPicker').classList.toggle('is-quality', pickerState.type === 'quality');
    document.getElementById('pickerTitle').textContent = pickerTitle();
    document.getElementById('pickerBackdrop').hidden = false; document.body.classList.add('has-picker-open');
    if (pickerState.type === 'date') renderDatePicker(true);
    else if (pickerState.type === 'time') renderTimePicker(true);
    else renderQualityPicker(true);
    requestAnimationFrame(positionPicker);
  }

  function closePicker(restoreFocus = true) {
    if (!pickerState.open) return;
    const trigger = pickerState.trigger; pickerState.open = false;
    document.getElementById('pickerBackdrop').hidden = true; document.body.classList.remove('has-picker-open');
    document.querySelectorAll('.glass-picker-trigger').forEach((item) => item.setAttribute('aria-expanded', 'false'));
    if (restoreFocus) trigger?.focus();
  }

  function applyPicker() {
    const input = document.getElementById(pickerState.targetId);
    input.value = pickerState.type === 'date' ? pickerState.pendingDate : pickerState.pendingTime;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    showSleepFormError(); refreshPickerTriggers(); closePicker();
  }

  function moveCalendarSelection(days) {
    const date = dateFromIso(pickerState.pendingDate); date.setDate(date.getDate() + days);
    pickerState.pendingDate = isoFromDate(date); pickerState.viewMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    renderDatePicker(true); positionPicker();
  }

  function handlePickerKeydown(event) {
    if (!pickerState.open) return;
    if (event.key === 'Escape') { event.preventDefault(); closePicker(); return; }
    const timeButton = event.target.closest?.('[data-hour], [data-minute]');
    if (timeButton && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const part = timeButton.hasAttribute('data-hour') ? 'hour' : 'minute';
      const limit = part === 'hour' ? 24 : 60;
      const deltas = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
      let value = Number(timeButton.dataset[part]);
      if (event.key === 'Home') value = 0;
      else if (event.key === 'End') value = limit - 1;
      else value = Math.max(0, Math.min(limit - 1, value + deltas[event.key]));
      selectTimePart(part, value, true);
      return;
    }
    const qualityButton = event.target.closest?.('[data-quality]');
    if (qualityButton && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const choices = [...document.querySelectorAll('#pickerQualities [data-quality]')];
      let index = choices.indexOf(qualityButton);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = choices.length - 1;
      else index = Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
      choices[index].focus();
      return;
    }
    const dateButton = event.target.closest?.('[data-date]');
    const moveBy = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (dateButton && moveBy) { event.preventDefault(); moveCalendarSelection(moveBy); return; }
    if (event.key !== 'Tab') return;
    const picker = document.getElementById('glassPicker');
    const focusable = [...picker.querySelectorAll('button:not([hidden]):not(:disabled), [tabindex="0"]')].filter((item) => item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function initGlassPicker() {
    document.querySelectorAll('.glass-picker-trigger').forEach((trigger) => trigger.addEventListener('click', () => openPicker(trigger)));
    document.getElementById('pickerClose').addEventListener('click', () => closePicker());
    document.getElementById('pickerCancel').addEventListener('click', () => closePicker());
    document.getElementById('pickerApply').addEventListener('click', applyPicker);
    document.getElementById('pickerToday').addEventListener('click', () => {
      pickerState.pendingDate = localToday(); const date = dateFromIso(pickerState.pendingDate);
      pickerState.viewMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12); renderDatePicker(true); positionPicker();
    });
    document.getElementById('pickerPrevMonth').addEventListener('click', () => { pickerState.viewMonth.setMonth(pickerState.viewMonth.getMonth() - 1); renderDatePicker(); positionPicker(); });
    document.getElementById('pickerNextMonth').addEventListener('click', () => { pickerState.viewMonth.setMonth(pickerState.viewMonth.getMonth() + 1); renderDatePicker(); positionPicker(); });
    document.getElementById('pickerDays').addEventListener('click', (event) => {
      const button = event.target.closest('[data-date]'); if (!button) return;
      pickerState.pendingDate = button.dataset.date; const date = dateFromIso(pickerState.pendingDate);
      pickerState.viewMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12); renderDatePicker(true); positionPicker();
    });
    for (const part of ['hour', 'minute']) {
      document.getElementById(part === 'hour' ? 'pickerHours' : 'pickerMinutes').addEventListener('click', (event) => {
        const button = event.target.closest(`[data-${part}]`); if (!button) return;
        selectTimePart(part, Number(button.dataset[part]), true);
      });
    }
    document.getElementById('pickerQualities').addEventListener('click', (event) => {
      const button = event.target.closest('[data-quality]'); if (!button) return;
      const input = document.getElementById('quality');
      input.value = button.dataset.quality;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      refreshPickerTriggers();
      closePicker();
    });
    document.getElementById('pickerBackdrop').addEventListener('pointerdown', (event) => { if (event.target === event.currentTarget) closePicker(); });
    document.getElementById('glassPicker').addEventListener('keydown', handlePickerKeydown);
    window.addEventListener('resize', positionPicker); window.addEventListener('scroll', positionPicker, { passive: true });
    refreshPickerTriggers();
  }

  function calculateDuration() {
    const sleep = document.getElementById('sleepTime').value;
    const wake = document.getElementById('wakeTime').value;
    if (!sleep || !wake) {
      document.getElementById('durationValue').textContent = '--:--';
      return null;
    }
    const [sleepHour, sleepMinute] = sleep.split(':').map(Number);
    const [wakeHour, wakeMinute] = wake.split(':').map(Number);
    let minutes = wakeHour * 60 + wakeMinute - sleepHour * 60 - sleepMinute;
    if (minutes <= 0) minutes += 1440;
    const duration = { hours: Math.floor(minutes / 60), minutes: minutes % 60, totalMinutes: minutes };
    document.getElementById('durationValue').textContent = `${String(duration.hours).padStart(2, '0')}:${String(duration.minutes).padStart(2, '0')}`;
    return duration;
  }

  function localSleepRecords() {
    try {
      const records = JSON.parse(localStorage.getItem('sleepRecords') || '[]');
      return Array.isArray(records) ? records : [];
    } catch (error) {
      return [];
    }
  }

  function saveLocalSleep(record) {
    const records = localSleepRecords();
    const index = records.findIndex((item) => item.date === record.date);
    if (index >= 0) records[index] = record;
    else records.push(record);
    localStorage.setItem('sleepRecords', JSON.stringify(records));
  }

  function initSleepForm() {
    document.getElementById('date').value = localToday();
    initGlassPicker();
    document.getElementById('sleepTime').addEventListener('change', calculateDuration);
    document.getElementById('wakeTime').addEventListener('change', calculateDuration);
    document.getElementById('sleepForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const missing = ['date', 'sleepTime', 'wakeTime'].find((id) => !document.getElementById(id).value);
      if (missing) {
        showSleepFormError(t('health.picker.required'));
        if (missing === 'date') document.getElementById('datePickerTrigger').focus();
        else document.querySelector(`.glass-picker-trigger[data-target="${missing}"]`)?.focus();
        return;
      }
      showSleepFormError();
      if (!window.ApiClient?.isLoggedIn()) {
        setStatus(t('health.record.loginRequired'), 'error');
        showModal('loginModal');
        return;
      }
      const duration = calculateDuration();
      if (!duration) return;
      const record = {
        date: document.getElementById('date').value,
        sleepTime: document.getElementById('sleepTime').value,
        wakeTime: document.getElementById('wakeTime').value,
        quality: QUALITY.has(document.getElementById('quality').value) ? document.getElementById('quality').value : 'good',
        duration
      };
      saveLocalSleep(record);
      try {
        await window.ApiClient.saveSleepRecord(record.date, record);
        setStatus(t('health.record.saved'), 'success');
        document.getElementById('sleepForm').reset();
        document.getElementById('date').value = localToday();
        document.getElementById('sleepTime').value = '';
        document.getElementById('wakeTime').value = '';
        document.getElementById('durationValue').textContent = '--:--';
        refreshPickerTriggers();
        await loadAll(false);
      } catch (error) {
        setStatus(t('health.common.offline'), 'error');
        renderLocalAnalysis();
      }
    });
  }

  function formatDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatDuration(minutes) {
    if (!Number.isFinite(Number(minutes))) return '—';
    const value = Math.round(Number(minutes));
    const hours = Math.floor(value / 60);
    const remainder = value % 60;
    return locale() === 'en' ? `${hours}h ${remainder}m` : `${hours}小时${remainder}分钟`;
  }

  function rounded(value, suffix, digits = 0) {
    return value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(digits)}${suffix || ''}`;
  }

  function inferDeviceType(connection) {
    if (!connection) return 'miband';
    const sourcePackages = Array.isArray(connection.sourcePackages) ? connection.sourcePackages : [];
    const identity = [connection.manufacturer, connection.model, connection.deviceName, ...sourcePackages]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (/\bapple\b|apple\s*watch|watchos|com\.apple\./.test(identity)) return 'apple';
    return 'miband';
  }

  function defaultDeviceName(deviceType) {
    return t(deviceType === 'apple' ? 'health.deviceChooser.apple' : 'health.deviceChooser.miband');
  }

  function normalizedDevicePreference(value) {
    if (!value || !DEVICE_TYPES.has(value.deviceType)) return null;
    const displayName = String(value.displayName || '').trim();
    if (!displayName || Array.from(displayName).length > 60) return null;
    return { deviceType: value.deviceType, displayName };
  }

  function sessionDevicePreview() {
    try { return normalizedDevicePreference(JSON.parse(sessionStorage.getItem(DEVICE_PREVIEW_KEY) || 'null')); } catch (error) { return null; }
  }

  function effectiveDevicePreference() {
    const saved = normalizedDevicePreference(state.devicePreference);
    if (saved) return saved;
    if (!window.ApiClient?.hasToken()) {
      const preview = sessionDevicePreview();
      if (preview) return preview;
    }
    const deviceType = inferDeviceType(state.connection);
    return { deviceType, displayName: defaultDeviceName(deviceType) };
  }

  function renderDeviceArtwork(preference) {
    const illustration = document.getElementById('deviceIllustration');
    if (!illustration) return;
    illustration.src = DEVICE_ARTWORK[preference.deviceType];
    illustration.dataset.deviceType = preference.deviceType;
    illustration.dataset.deviceBrand = preference.deviceType === 'miband' ? 'xiaomi' : 'apple';
  }

  function updateEsp32Button() {
    const button = document.getElementById('esp32SyncBtn');
    const active = !!state.connection?.active;
    button.disabled = !active || state.esp32Syncing;
    button.setAttribute('aria-busy', String(state.esp32Syncing));
    const key = state.esp32Syncing ? 'health.esp32.syncing' : (state.esp32Synced ? 'health.esp32.syncedShort' : 'health.esp32.sync');
    button.textContent = t(key);
  }

  function renderConnection() {
    const connection = state.connection;
    const latest = state.latest;
    const active = !!(connection && connection.active);
    const badge = document.getElementById('connectionBadge');
    badge.className = `connection-badge ${active ? 'is-online' : 'is-offline'}`;
    badge.textContent = t(active ? 'health.connection.connected' : 'health.connection.disconnected');

    if (active && connection.lastSyncedAt) {
      const age = Date.now() - new Date(`${connection.lastSyncedAt}Z`).getTime();
      if (Number.isFinite(age) && age > 48 * 60 * 60 * 1000) {
        badge.className = 'connection-badge is-stale';
        badge.textContent = t('health.connection.stale');
      }
    }
    const devicePreference = effectiveDevicePreference();
    document.getElementById('deviceName').textContent = devicePreference.displayName;
    renderDeviceArtwork(devicePreference);
    document.getElementById('deviceChooserTrigger').setAttribute('aria-label', t('health.deviceChooser.open'));
    document.getElementById('lastSync').textContent = connection?.lastSyncedAt
      ? `${t('health.connection.lastSync')}: ${formatDateTime(connection.lastSyncedAt)}` : '—';
    document.getElementById('latestHeartRate').textContent = latest?.heartRate?.avg == null ? '—' : Math.round(latest.heartRate.avg);
    document.getElementById('latestSpo2').textContent = latest?.spo2?.avg == null ? '—' : Number(latest.spo2.avg).toFixed(1);
    document.getElementById('latestSteps').textContent = latest?.steps == null ? '—' : Number(latest.steps).toLocaleString(locale());
    document.getElementById('latestSleep').textContent = latest?.sleep?.durationMinutes == null ? '—' : formatDuration(latest.sleep.durationMinutes);
    document.getElementById('disconnectBtn').disabled = !active;
    updateEsp32Button();
  }

  function setDeviceChooserError(message = '') {
    const element = document.getElementById('deviceChooserError');
    element.textContent = message;
    element.hidden = !message;
  }

  function syncDeviceChooserSelection(focusSelected = false) {
    const options = [...document.querySelectorAll('#deviceTypeOptions [data-device-type]')];
    options.forEach((option) => {
      const selected = option.dataset.deviceType === deviceChooserState.type;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-checked', String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
    if (focusSelected) options.find((option) => option.dataset.deviceType === deviceChooserState.type)?.focus();
  }

  function chooseDeviceType(deviceType, focusSelected = false) {
    if (!DEVICE_TYPES.has(deviceType)) return;
    const input = document.getElementById('deviceDisplayName');
    const previousDefault = defaultDeviceName(deviceChooserState.type);
    const currentName = input.value.trim();
    deviceChooserState.type = deviceType;
    if (!currentName || currentName === previousDefault) input.value = defaultDeviceName(deviceType);
    syncDeviceChooserSelection(focusSelected);
    setDeviceChooserError();
  }

  function openDeviceChooser() {
    const preference = effectiveDevicePreference();
    deviceChooserState.open = true;
    deviceChooserState.type = preference.deviceType;
    deviceChooserState.trigger = document.getElementById('deviceChooserTrigger');
    document.getElementById('deviceDisplayName').value = preference.displayName;
    setDeviceChooserError();
    syncDeviceChooserSelection();
    document.getElementById('deviceChooserModal').hidden = false;
    deviceChooserState.trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('has-picker-open');
    requestAnimationFrame(() => syncDeviceChooserSelection(true));
  }

  function closeDeviceChooser(restoreFocus = true) {
    if (!deviceChooserState.open) return;
    deviceChooserState.open = false;
    document.getElementById('deviceChooserModal').hidden = true;
    document.getElementById('deviceChooserTrigger').setAttribute('aria-expanded', 'false');
    setDeviceChooserError();
    if (!pickerState.open && document.getElementById('esp32EndpointModal').hidden) document.body.classList.remove('has-picker-open');
    if (restoreFocus) deviceChooserState.trigger?.focus();
  }

  async function saveDevicePreference(event) {
    event.preventDefault();
    const input = document.getElementById('deviceDisplayName');
    const displayName = input.value.trim();
    if (!displayName || Array.from(displayName).length > 60) {
      setDeviceChooserError(t('health.deviceChooser.invalidName'));
      input.focus();
      return;
    }
    const preference = { deviceType: deviceChooserState.type, displayName };
    const applyButton = document.getElementById('deviceChooserApply');
    state.devicePreferenceSaving = true;
    applyButton.disabled = true;
    document.getElementById('deviceChooserForm').setAttribute('aria-busy', 'true');
    try {
      if (window.ApiClient?.hasToken()) {
        const result = await window.ApiClient.updateHealthDevicePreference(preference);
        state.devicePreference = result.devicePreference;
        sessionStorage.removeItem(DEVICE_PREVIEW_KEY);
        setStatus(t('health.deviceChooser.saved'), 'success');
      } else {
        sessionStorage.setItem(DEVICE_PREVIEW_KEY, JSON.stringify(preference));
        state.devicePreference = null;
        setStatus(t('health.deviceChooser.previewOnly'));
      }
      renderConnection();
      closeDeviceChooser();
    } catch (error) {
      setDeviceChooserError(error.message || t('health.common.offline'));
    } finally {
      state.devicePreferenceSaving = false;
      applyButton.disabled = false;
      document.getElementById('deviceChooserForm').setAttribute('aria-busy', 'false');
    }
  }

  function handleDeviceChooserKeydown(event) {
    if (!deviceChooserState.open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDeviceChooser(); return; }
    const option = event.target.closest?.('[data-device-type]');
    if (option && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const types = ['apple', 'miband'];
      let index = types.indexOf(option.dataset.deviceType);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = types.length - 1;
      else index = (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + types.length) % types.length;
      chooseDeviceType(types[index], true);
      return;
    }
    if (event.key !== 'Tab') return;
    const modal = document.getElementById('deviceChooserModal');
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter((item) => item.offsetParent !== null && item.tabIndex >= 0);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function initDeviceChooser() {
    document.getElementById('deviceChooserTrigger').addEventListener('click', openDeviceChooser);
    document.getElementById('deviceTypeOptions').addEventListener('click', (event) => {
      const option = event.target.closest('[data-device-type]');
      if (option) chooseDeviceType(option.dataset.deviceType, true);
    });
    document.getElementById('deviceChooserForm').addEventListener('submit', saveDevicePreference);
    document.getElementById('deviceChooserClose').addEventListener('click', () => closeDeviceChooser());
    document.getElementById('deviceChooserCancel').addEventListener('click', () => closeDeviceChooser());
    document.getElementById('deviceChooserModal').addEventListener('pointerdown', (event) => {
      if (event.target === event.currentTarget) closeDeviceChooser();
    });
    document.getElementById('deviceChooserModal').addEventListener('keydown', handleDeviceChooserKeydown);
  }

  function chartDefaults() {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#aebbd5', usePointStyle: true, boxWidth: 8 } },
        tooltip: { backgroundColor: 'rgba(10,15,27,.94)', titleColor: '#fff', bodyColor: '#cbd6ec', borderColor: 'rgba(112,148,241,.3)', borderWidth: 1 }
      },
      scales: {
        x: { ticks: { color: '#8794af', maxTicksLimit: state.range === 90 ? 10 : 15 }, grid: { color: 'rgba(123,147,205,.07)' } },
        y: { ticks: { color: '#8794af' }, grid: { color: 'rgba(123,147,205,.09)' } }
      }
    };
  }

  function replaceChart(name, canvas, config) {
    if (!window.Chart) return;
    state.charts[name]?.destroy();
    state.charts[name] = new window.Chart(document.getElementById(canvas), config);
  }

  function renderCharts(analysis) {
    const labels = analysis.series.map((day) => formatDate(day.date));
    const sleep = analysis.series.map((day) => day.sleepMinutes == null ? null : Number((day.sleepMinutes / 60).toFixed(2)));
    const migraineSleep = analysis.series.map((day, index) => day.migraine ? (sleep[index] == null ? 0 : sleep[index]) : null);
    replaceChart('sleep', 'sleepMigraineChart', {
      type: 'line',
      data: { labels, datasets: [
        { label: t('health.history.sleep'), data: sleep, borderColor: '#729cff', backgroundColor: 'rgba(96,137,244,.15)', fill: true, tension: .34, spanGaps: true, pointRadius: 2 },
        { label: t('health.history.migraine'), data: migraineSleep, showLine: false, pointRadius: 6, pointHoverRadius: 7, pointBackgroundColor: '#ff6c7c', pointBorderColor: '#ffd1d6', pointBorderWidth: 2 }
      ] },
      options: { ...chartDefaults(), scales: { ...chartDefaults().scales, y: { ...chartDefaults().scales.y, suggestedMin: 0, suggestedMax: 10, title: { display: true, text: locale() === 'en' ? 'Hours' : '小时', color: '#8794af' } } } }
    });

    const vitalsOptions = chartDefaults();
    vitalsOptions.scales = {
      x: vitalsOptions.scales.x,
      heart: { type: 'linear', position: 'left', ticks: { color: '#8794af' }, grid: { color: 'rgba(123,147,205,.09)' } },
      oxygen: { type: 'linear', position: 'right', min: 80, max: 100, ticks: { color: '#8794af' }, grid: { drawOnChartArea: false } }
    };
    replaceChart('vitals', 'vitalsChart', {
      type: 'line', data: { labels, datasets: [
        { label: t('health.connection.heartRate'), data: analysis.series.map((day) => day.heartRateAvg), yAxisID: 'heart', borderColor: '#ff8c9b', backgroundColor: '#ff8c9b', tension: .3, spanGaps: true, pointRadius: 2 },
        { label: t('health.connection.spo2'), data: analysis.series.map((day) => day.spo2Avg), yAxisID: 'oxygen', borderColor: '#66d5dc', backgroundColor: '#66d5dc', tension: .3, spanGaps: true, pointRadius: 2 }
      ] }, options: vitalsOptions
    });
    replaceChart('steps', 'stepsChart', {
      type: 'bar', data: { labels, datasets: [{ label: t('health.connection.steps'), data: analysis.series.map((day) => day.steps), backgroundColor: analysis.series.map((day) => day.migraine ? 'rgba(255,108,124,.7)' : 'rgba(101,147,255,.62)'), borderRadius: 5 }] }, options: chartDefaults()
    });

    const climateOptions = chartDefaults();
    climateOptions.scales = {
      x: climateOptions.scales.x,
      temperature: { type: 'linear', position: 'left', ticks: { color: '#8794af' }, grid: { color: 'rgba(123,147,205,.09)' }, title: { display: true, text: '°C', color: '#8794af' } },
      humidity: { type: 'linear', position: 'right', min: 0, max: 100, ticks: { color: '#8794af' }, grid: { drawOnChartArea: false }, title: { display: true, text: '%', color: '#8794af' } }
    };
    replaceChart('environmentClimate', 'environmentClimateChart', {
      type: 'line', data: { labels, datasets: [
        { label: t('health.environment.temperature'), data: analysis.series.map((day) => day.temperatureAvg), yAxisID: 'temperature', borderColor: '#ff9b75', backgroundColor: '#ff9b75', tension: .3, spanGaps: true, pointRadius: 2 },
        { label: t('health.environment.humidity'), data: analysis.series.map((day) => day.humidityAvg), yAxisID: 'humidity', borderColor: '#66d5dc', backgroundColor: '#66d5dc', tension: .3, spanGaps: true, pointRadius: 2 }
      ] }, options: climateOptions
    });

    const exposureOptions = chartDefaults();
    exposureOptions.scales = {
      x: exposureOptions.scales.x,
      light: { type: 'linear', position: 'left', beginAtZero: true, ticks: { color: '#8794af' }, grid: { color: 'rgba(123,147,205,.09)' }, title: { display: true, text: 'lux', color: '#8794af' } },
      noise: { type: 'linear', position: 'right', beginAtZero: true, suggestedMax: 120, ticks: { color: '#8794af' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'dB', color: '#8794af' } }
    };
    replaceChart('environmentExposure', 'environmentExposureChart', {
      type: 'line', data: { labels, datasets: [
        { label: t('health.environment.light'), data: analysis.series.map((day) => day.lightAvg), yAxisID: 'light', borderColor: '#ffd36a', backgroundColor: '#ffd36a', tension: .3, spanGaps: true, pointRadius: 2 },
        { label: t('health.environment.noise'), data: analysis.series.map((day) => day.noiseAvg), yAxisID: 'noise', borderColor: '#bd8cff', backgroundColor: '#bd8cff', tension: .3, spanGaps: true, pointRadius: 2 }
      ] }, options: exposureOptions
    });
  }

  function addComparison(container, title, comparison, formatter) {
    const card = document.createElement('article');
    card.className = 'comparison-card';
    const heading = document.createElement('h4');
    heading.textContent = title;
    const values = document.createElement('div');
    values.className = 'comparison-values';
    const migraine = document.createElement('span');
    migraine.textContent = `${t('health.insights.migraineAverage')}: ${formatter(comparison.migraineAverage)}`;
    const nonMigraine = document.createElement('span');
    nonMigraine.textContent = `${t('health.insights.nonMigraineAverage')}: ${formatter(comparison.nonMigraineAverage)}`;
    values.append(migraine, nonMigraine);
    const difference = document.createElement('span');
    difference.className = 'comparison-difference';
    difference.textContent = `${t('health.insights.difference')}: ${formatter(comparison.difference, true)}`;
    card.append(heading, values, difference);
    container.appendChild(card);
  }

  function renderInsights(analysis) {
    const container = document.getElementById('insightsContent');
    container.replaceChildren();
    if (!analysis.coverage.insightsAvailable || !analysis.comparisons) {
      const message = document.createElement('p');
      message.className = 'insufficient-message';
      message.textContent = t('health.insights.insufficient');
      container.appendChild(message);
      return;
    }
    addComparison(container, t('health.kpi.sleep'), analysis.comparisons.sleepMinutes, (value) => formatDuration(value));
    addComparison(container, t('health.kpi.heartRate'), analysis.comparisons.heartRate, (value, signed) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${Number(value).toFixed(1)} bpm`);
    addComparison(container, t('health.kpi.spo2'), analysis.comparisons.spo2, (value, signed) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${Number(value).toFixed(1)}%`);
    addComparison(container, t('health.kpi.steps'), analysis.comparisons.steps, (value, signed) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${Math.round(value).toLocaleString(locale())}`);
    if (analysis.comparisons.stressTriggerRate != null) {
      const stress = document.createElement('p');
      stress.className = 'stress-insight';
      stress.textContent = t('health.insights.stressRate', { rate: analysis.comparisons.stressTriggerRate });
      container.appendChild(stress);
    }
  }

  function renderHistory(analysis) {
    const body = document.getElementById('healthHistoryBody');
    body.replaceChildren();
    const rows = analysis.series.filter((day) => (
      day.sleepMinutes != null || day.heartRateAvg != null || day.spo2Avg != null || day.steps != null ||
      day.temperatureAvg != null || day.humidityAvg != null || day.lightAvg != null || day.noiseAvg != null || day.hasDiaryEntry
    )).slice().reverse();
    document.getElementById('emptyState').hidden = rows.length > 0;
    document.querySelector('.health-table').hidden = rows.length === 0;
    rows.forEach((day) => {
      const row = document.createElement('tr');
      const source = day.sleepSource ? t(`health.source.${day.sleepSource}`) : '—';
      const cells = [
        formatDate(day.date), source, formatDuration(day.sleepMinutes), rounded(day.heartRateAvg, ' bpm'),
        rounded(day.spo2Avg, '%', 1), day.steps == null ? '—' : Math.round(day.steps).toLocaleString(locale()),
        rounded(day.temperatureAvg, ' °C', 1), rounded(day.humidityAvg, '%', 1),
        rounded(day.lightAvg, ' lux', 1), rounded(day.noiseAvg, ' dB', 1)
      ];
      cells.forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 1 && day.sleepSource) {
          const pill = document.createElement('span'); pill.className = 'source-pill'; pill.textContent = value; cell.appendChild(pill);
        } else cell.textContent = value;
        row.appendChild(cell);
      });
      const migraineCell = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `migraine-pill ${day.migraine ? 'yes' : 'no'}`;
      pill.textContent = t(day.migraine ? 'health.common.yes' : 'health.common.no');
      migraineCell.appendChild(pill); row.appendChild(migraineCell); body.appendChild(row);
    });
  }

  function exportAnalysisCsv() {
    const analysis = state.analysis;
    if (!analysis || !Array.isArray(analysis.series) || !analysis.series.length) {
      setStatus(t('health.common.noData'), 'error');
      return;
    }
    const headers = [
      t('health.history.date'), t('health.history.source'), t('health.history.sleep'),
      'Sleep start', 'Sleep end', t('health.history.heartRate'), t('health.history.spo2'),
      t('health.history.steps'), t('health.environment.temperature'), t('health.environment.humidity'),
      t('health.environment.light'), t('health.environment.noise'), t('health.history.migraine'), 'Stress trigger', 'Triggers'
    ];
    const rows = analysis.series.map((day) => [
      day.date, day.sleepSource || '', day.sleepMinutes ?? '', day.sleepStart || '', day.sleepEnd || '',
      day.heartRateAvg ?? '', day.spo2Avg ?? '', day.steps ?? '', day.temperatureAvg ?? '',
      day.humidityAvg ?? '', day.lightAvg ?? '', day.noiseAvg ?? '', day.migraine ? 'true' : 'false',
      day.stressTrigger ? 'true' : 'false', Array.isArray(day.triggers) ? day.triggers.join('; ') : ''
    ]);
    const csvCell = (value) => {
      let text = String(value ?? '');
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `health-analysis-${analysis.range}d-${analysis.startDate || localToday()}-${analysis.endDate || localToday()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t('health.export.success'), 'success');
  }

  function renderAnalysis(analysis) {
    state.analysis = analysis;
    document.getElementById('kpiSleep').textContent = formatDuration(analysis.kpis.averageSleepMinutes);
    document.getElementById('kpiMigraine').textContent = analysis.kpis.migraineDays ?? '—';
    document.getElementById('kpiHeartRate').textContent = rounded(analysis.kpis.averageHeartRate, ' bpm');
    document.getElementById('kpiSpo2').textContent = rounded(analysis.kpis.averageSpo2, '%', 1);
    document.getElementById('kpiSteps').textContent = analysis.kpis.averageSteps == null ? '—' : Math.round(analysis.kpis.averageSteps).toLocaleString(locale());
    document.getElementById('coverageSummary').textContent = t('health.coverage', { recorded: analysis.coverage.recordedDays, overlap: analysis.coverage.overlappingDays });
    renderCharts(analysis);
    renderInsights(analysis);
    renderHistory(analysis);
    renderConnection();
  }

  function localDate(offset) {
    const date = new Date(); date.setDate(date.getDate() + offset);
    const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function renderLocalAnalysis() {
    const records = new Map(localSleepRecords().map((record) => [record.date, record]));
    const series = Array.from({ length: state.range }, (_, index) => {
      const date = localDate(index - state.range + 1); const record = records.get(date);
      return {
        date, migraine: false, hasDiaryEntry: false, stressTrigger: false,
        sleepMinutes: record?.duration?.totalMinutes ?? null, sleepSource: record ? 'manual' : null,
        heartRateAvg: null, spo2Avg: null, steps: null,
        temperatureAvg: null, humidityAvg: null, lightAvg: null, noiseAvg: null
      };
    });
    const sleepValues = series.map((day) => day.sleepMinutes).filter(Number.isFinite);
    renderAnalysis({ range: state.range, series, kpis: { averageSleepMinutes: sleepValues.length ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length : null, migraineDays: 0, averageHeartRate: null, averageSpo2: null, averageSteps: null }, coverage: { recordedDays: sleepValues.length, overlappingDays: 0, insightsAvailable: false }, comparisons: null });
  }

  async function loadAll(showLoading = true) {
    if (showLoading) setStatus(t('health.common.loading'));
    if (!window.ApiClient?.hasToken()) {
      state.connection = null; state.latest = null; state.environmentLatest = null; state.devicePreference = null; renderConnection(); renderLocalAnalysis(); setStatus(t('health.record.loginRequired'));
      return;
    }
    try {
      sessionStorage.removeItem(DEVICE_PREVIEW_KEY);
      const [connectionData, analysis] = await Promise.all([window.ApiClient.getHealthConnection(), window.ApiClient.getHealthAnalysis(state.range)]);
      state.connection = connectionData.connection;
      state.latest = connectionData.latest;
      state.environmentLatest = connectionData.environmentLatest;
      state.devicePreference = connectionData.devicePreference;
      renderAnalysis(analysis);
      setStatus('');
    } catch (error) {
      if (error.status === 401) showModal('loginModal');
      renderLocalAnalysis();
      setStatus(error.status ? error.message : t('health.common.offline'), 'error');
    }
  }

  function validatedEsp32Url(value) {
    let endpoint;
    try {
      endpoint = new URL(String(value || '').trim());
    } catch (error) {
      throw Object.assign(new Error(t('health.esp32.invalidUrl')), { code: 'invalidUrl' });
    }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw Object.assign(new Error(t('health.esp32.invalidUrl')), { code: 'invalidUrl' });
    }
    if (window.location.protocol === 'https:' && endpoint.protocol === 'http:') {
      throw Object.assign(new Error(t('health.esp32.mixedContent')), { code: 'mixedContent' });
    }
    return endpoint.href;
  }

  function esp32ParseMessage(error) {
    const keyByCode = {
      responseTooLarge: 'health.esp32.responseTooLarge',
      tooManySamples: 'health.esp32.tooManySamples',
      noValidSamples: 'health.esp32.noValidSamples'
    };
    return t(keyByCode[error?.code] || 'health.esp32.fetchFailed');
  }

  function setEndpointDialogError(message = '') {
    const error = document.getElementById('esp32EndpointError');
    error.textContent = message;
    error.hidden = !message;
  }

  function openEsp32EndpointDialog(message = '') {
    const modal = document.getElementById('esp32EndpointModal');
    const input = document.getElementById('esp32Endpoint');
    input.value = localStorage.getItem(ESP32_ENDPOINT_KEY) || '';
    setEndpointDialogError(message);
    modal.hidden = false;
    document.body.classList.add('has-picker-open');
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function closeEsp32EndpointDialog(restoreFocus = true) {
    document.getElementById('esp32EndpointModal').hidden = true;
    setEndpointDialogError();
    if (!pickerState.open) document.body.classList.remove('has-picker-open');
    if (restoreFocus) document.getElementById('esp32SyncBtn').focus();
  }

  async function syncEsp32Environment(endpointOverride) {
    if (!window.ApiClient?.hasToken()) {
      setStatus(t('health.esp32.loginRequired'), 'error');
      showModal('loginModal');
      return;
    }
    if (!state.connection?.active) {
      setStatus(t('health.esp32.connectionRequired'), 'error');
      return;
    }

    const savedEndpoint = localStorage.getItem(ESP32_ENDPOINT_KEY);
    if (!endpointOverride && !savedEndpoint) {
      openEsp32EndpointDialog();
      return;
    }
    let endpoint;
    try {
      endpoint = validatedEsp32Url(endpointOverride || savedEndpoint);
    } catch (error) {
      setStatus(error.message, 'error');
      openEsp32EndpointDialog(error.message);
      return;
    }

    localStorage.setItem(ESP32_ENDPOINT_KEY, endpoint);
    state.esp32Synced = false;
    state.esp32Syncing = true;
    updateEsp32Button();
    setStatus(t('health.esp32.fetching'));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    let phase = 'fetch';
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'text/plain' },
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(t('health.esp32.httpError', { status: response.status }));
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > window.Esp32Parser.MAX_RESPONSE_BYTES) {
        throw Object.assign(new Error('responseTooLarge'), { code: 'responseTooLarge' });
      }
      const parsed = window.Esp32Parser.parseEsp32Samples(await response.text());
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      let uploaded = 0;
      phase = 'upload';
      for (let index = 0; index < parsed.readings.length; index += ESP32_UPLOAD_CHUNK_SIZE) {
        const readings = parsed.readings.slice(index, index + ESP32_UPLOAD_CHUNK_SIZE);
        const result = await window.ApiClient.syncEsp32Environment({ connectionId: state.connection.id, timezone, readings });
        uploaded += result.readingsUpserted;
        state.environmentLatest = result.environmentLatest;
      }
      await loadAll(false);
      state.esp32Synced = true;
      setStatus(t('health.esp32.synced', { count: uploaded, skipped: parsed.skipped }), 'success');
      window.setTimeout(() => { state.esp32Synced = false; updateEsp32Button(); }, 2500);
    } catch (error) {
      const message = error.name === 'AbortError'
        ? t('health.esp32.timeout')
        : (error.code ? esp32ParseMessage(error) : (error instanceof TypeError ? t('health.esp32.fetchFailed') : (error.message || t('health.esp32.fetchFailed'))));
      setStatus(message, 'error');
      if (phase === 'fetch') openEsp32EndpointDialog(message);
    } finally {
      window.clearTimeout(timeout);
      state.esp32Syncing = false;
      updateEsp32Button();
    }
  }

  function initControls() {
    document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', async () => {
      state.range = Number(button.dataset.range);
      document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('is-active', item === button));
      await loadAll();
    }));
    document.getElementById('refreshBtn').addEventListener('click', () => loadAll());
    document.getElementById('esp32SyncBtn').addEventListener('click', () => syncEsp32Environment());
    document.getElementById('esp32EndpointForm').addEventListener('submit', (event) => {
      event.preventDefault();
      let endpoint;
      try {
        endpoint = validatedEsp32Url(document.getElementById('esp32Endpoint').value);
      } catch (error) {
        setEndpointDialogError(error.message);
        document.getElementById('esp32Endpoint').focus();
        return;
      }
      localStorage.setItem(ESP32_ENDPOINT_KEY, endpoint);
      closeEsp32EndpointDialog(false);
      syncEsp32Environment(endpoint);
    });
    document.getElementById('esp32EndpointClose').addEventListener('click', () => closeEsp32EndpointDialog());
    document.getElementById('esp32EndpointCancel').addEventListener('click', () => closeEsp32EndpointDialog());
    document.getElementById('esp32EndpointModal').addEventListener('pointerdown', (event) => {
      if (event.target === event.currentTarget) closeEsp32EndpointDialog();
    });
    document.getElementById('esp32EndpointModal').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEsp32EndpointDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const modal = document.getElementById('esp32EndpointModal');
      const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter((item) => item.offsetParent !== null);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.getElementById('setupBtn').addEventListener('click', () => {
      const panel = document.getElementById('androidSetup');
      panel.hidden = !panel.hidden;
      document.getElementById('setupBtn').setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.getElementById('exportAnalysisBtn').addEventListener('click', exportAnalysisCsv);
    document.getElementById('disconnectBtn').addEventListener('click', async () => {
      if (!state.connection?.active || !window.confirm(t('health.connection.confirmDisconnect'))) return;
      try {
        await window.ApiClient.disconnectHealthConnection(state.connection.id);
        state.connection.active = false;
        renderConnection();
        setStatus(t('health.connection.disconnectedNotice'), 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  }

  function init() {
    initAuth();
    initSleepForm();
    initDeviceChooser();
    initControls();
    loadAll();
    window.addEventListener('migraine:languagechange', () => {
      updateAuthHeader();
      refreshPickerTriggers();
      refreshOpenPicker();
      if (state.analysis) renderAnalysis(state.analysis);
      else renderConnection();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
