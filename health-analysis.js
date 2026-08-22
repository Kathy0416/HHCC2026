(function () {
  'use strict';

  const state = {
    range: 30,
    analysis: null,
    connection: null,
    latest: null,
    charts: {},
    native: { enabled: false, availability: null, permissions: null, origins: [], busy: false }
  };
  const QUALITY = new Set(['excellent', 'good', 'fair', 'poor']);

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

  function setNativeStatus(message) {
    const element = document.getElementById('nativeHealthStatus');
    if (element) element.textContent = message || '';
  }

  function setNativeBusy(busy) {
    state.native.busy = busy;
    document.getElementById('nativeHealthControls')?.classList.toggle('is-busy', busy);
    renderNativeControls();
  }

  function requireNativeLogin() {
    if (window.ApiClient?.hasToken()) return true;
    setNativeStatus(t('health.connection.loginToSync'));
    showModal('loginModal');
    return false;
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
    renderNativeControls();
  }

  function renderNativeControls() {
    const nativeControls = document.getElementById('nativeHealthControls');
    const browserSetup = document.getElementById('browserHealthSetup');
    if (!nativeControls || !browserSetup) return;
    nativeControls.hidden = !state.native.enabled;
    browserSetup.hidden = state.native.enabled;
    if (!state.native.enabled) return;

    const select = document.getElementById('healthSourceSelect');
    const savedSource = localStorage.getItem('healthConnectSource') || '';
    const current = select.value || savedSource;
    select.replaceChildren();
    if (!state.native.origins.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = t('health.connection.noSource');
      select.appendChild(option);
    } else {
      state.native.origins.forEach((origin) => {
        const option = document.createElement('option');
        option.value = origin.packageName;
        option.textContent = `${origin.likelyMiFitness ? 'Mi Fitness · ' : ''}${origin.packageName}`;
        select.appendChild(option);
      });
      const match = state.native.origins.find((origin) => origin.packageName === current);
      if (match) select.value = match.packageName;
      else if (state.native.origins.length === 1) select.value = state.native.origins[0].packageName;
      if (select.value) localStorage.setItem('healthConnectSource', select.value);
    }
    select.disabled = state.native.busy || !state.native.origins.length;
    document.getElementById('healthPermissionBtn').disabled = state.native.busy;
    document.getElementById('discoverSourcesBtn').disabled = state.native.busy;
    document.getElementById('manageHealthBtn').disabled = state.native.busy;
    document.getElementById('syncNowBtn').disabled = state.native.busy || !select.value || !window.ApiClient?.hasToken();
  }

  async function refreshNativeState() {
    if (!state.native.enabled) return;
    setNativeStatus(t('health.connection.checking'));
    try {
      state.native.availability = await window.MobileHealth.getAvailability();
      if (state.native.availability.status === 'update_required') {
        setNativeStatus(t('health.connection.healthUpdate'));
        return;
      }
      if (state.native.availability.status !== 'available') {
        setNativeStatus(t('health.connection.healthUnavailable'));
        return;
      }
      state.native.permissions = await window.MobileHealth.getPermissionState();
      setNativeStatus(state.native.permissions.granted.length
        ? t('health.connection.permissionGranted')
        : t('health.connection.permissionMissing'));
    } catch (error) {
      setNativeStatus(error.message || t('health.connection.healthUnavailable'));
    } finally {
      renderNativeControls();
    }
  }

  async function requestNativePermissions() {
    if (!requireNativeLogin()) return;
    setNativeBusy(true);
    try {
      state.native.permissions = await window.MobileHealth.requestPermissions({ includeHistory: true });
      setNativeStatus(state.native.permissions.granted.length
        ? t('health.connection.permissionGranted')
        : t('health.connection.permissionMissing'));
      if (state.native.permissions.granted.length) await discoverNativeSources();
    } catch (error) {
      setNativeStatus(error.message);
    } finally {
      setNativeBusy(false);
    }
  }

  async function discoverNativeSources() {
    if (!requireNativeLogin()) return;
    setNativeBusy(true);
    try {
      const result = await window.MobileHealth.discoverOrigins({ days: 30 });
      state.native.origins = Array.isArray(result.origins) ? result.origins : [];
      renderNativeControls();
      setNativeStatus(state.native.origins.length
        ? t('health.connection.sourcesFound', { count: state.native.origins.length })
        : t('health.connection.noSourcesFound'));
    } catch (error) {
      setNativeStatus(error.message);
    } finally {
      setNativeBusy(false);
    }
  }

  async function syncNativeHealth() {
    if (!requireNativeLogin()) return;
    const sourcePackage = document.getElementById('healthSourceSelect')?.value || '';
    if (!sourcePackage) {
      setNativeStatus(t('health.connection.sourceRequired'));
      return;
    }
    localStorage.setItem('healthConnectSource', sourcePackage);
    setNativeBusy(true);
    setNativeStatus(t('health.connection.syncing'));
    try {
      const availability = state.native.availability || await window.MobileHealth.getAvailability();
      if (availability.status !== 'available') throw new Error(t(availability.status === 'update_required' ? 'health.connection.healthUpdate' : 'health.connection.healthUnavailable'));
      let permissions = await window.MobileHealth.getPermissionState();
      if (!permissions.granted.length) permissions = await window.MobileHealth.requestPermissions({ includeHistory: true });
      if (!permissions.granted.length) throw new Error(t('health.connection.permissionMissing'));

      const connectionData = await window.ApiClient.createHealthConnection({
        provider: 'health_connect',
        deviceName: availability.deviceName || 'Android device',
        manufacturer: availability.manufacturer || '',
        model: availability.model || '',
        sourcePackages: [sourcePackage]
      });
      const nativeData = await window.MobileHealth.readDailyData({ sourcePackage, days: 90 });
      const payload = nativeData.payload || {};
      payload.connectionId = connectionData.connection.id;
      await window.ApiClient.syncHealthData(payload);
      state.native.permissions = nativeData;
      let message = t('health.connection.syncComplete', {
        days: payload.days?.length || 0,
        sessions: payload.sleepSessions?.length || 0
      });
      if (nativeData.missing?.length) message += t('health.connection.syncPartial');
      if (nativeData.actualDays < nativeData.requestedDays) message += t('health.connection.historyLimited');
      setNativeStatus(message);
      setStatus(message, 'success');
      await loadAll(false);
    } catch (error) {
      if (error.status === 401) showModal('loginModal');
      setNativeStatus(error.message || t('health.common.offline'));
      setStatus(error.message || t('health.common.offline'), 'error');
    } finally {
      setNativeBusy(false);
    }
  }

  function initNativeHealth() {
    state.native.enabled = !!window.MobileHealth?.isAvailable();
    renderNativeControls();
    if (!state.native.enabled) return;
    document.getElementById('healthSourceSelect')?.addEventListener('change', (event) => {
      if (event.target.value) localStorage.setItem('healthConnectSource', event.target.value);
      renderNativeControls();
    });
    document.getElementById('healthPermissionBtn')?.addEventListener('click', requestNativePermissions);
    document.getElementById('discoverSourcesBtn')?.addEventListener('click', discoverNativeSources);
    document.getElementById('syncNowBtn')?.addEventListener('click', syncNativeHealth);
    document.getElementById('manageHealthBtn')?.addEventListener('click', async () => {
      try { await window.MobileHealth.openHealthConnectSettings(); } catch (error) { setNativeStatus(error.message); }
    });
    refreshNativeState();
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
        hideModal('registerModal');
        updateAuthHeader();
        await loadAll();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
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
    document.getElementById('date').valueAsDate = new Date();
    document.getElementById('sleepTime').addEventListener('change', calculateDuration);
    document.getElementById('wakeTime').addEventListener('change', calculateDuration);
    document.getElementById('sleepForm').addEventListener('submit', async (event) => {
      event.preventDefault();
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
        document.getElementById('date').valueAsDate = new Date();
        document.getElementById('durationValue').textContent = '--:--';
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
    document.getElementById('deviceName').textContent = connection
      ? (connection.deviceName || [connection.manufacturer, connection.model].filter(Boolean).join(' ') || 'Health Connect')
      : 'Health Connect';
    document.getElementById('lastSync').textContent = connection?.lastSyncedAt
      ? `${t('health.connection.lastSync')}: ${formatDateTime(connection.lastSyncedAt)}` : '—';
    document.getElementById('latestHeartRate').textContent = latest?.heartRate?.avg == null ? '—' : Math.round(latest.heartRate.avg);
    document.getElementById('latestSpo2').textContent = latest?.spo2?.avg == null ? '—' : Number(latest.spo2.avg).toFixed(1);
    document.getElementById('latestSteps').textContent = latest?.steps == null ? '—' : Number(latest.steps).toLocaleString(locale());
    document.getElementById('latestSleep').textContent = latest?.sleep?.durationMinutes == null ? '—' : formatDuration(latest.sleep.durationMinutes);
    const latestDay = state.analysis?.series?.find((day) => day.date === latest?.date);
    document.getElementById('latestStress').textContent = connection
      ? `${t(latestDay?.stressTrigger ? 'health.common.yes' : 'health.common.no')} · ${t('health.connection.stressDiary')}`
      : t('health.connection.unavailable');
    document.getElementById('disconnectBtn').disabled = !active;
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
    const rows = analysis.series.filter((day) => day.sleepMinutes != null || day.heartRateAvg != null || day.spo2Avg != null || day.steps != null || day.hasDiaryEntry).slice().reverse();
    document.getElementById('emptyState').hidden = rows.length > 0;
    document.querySelector('.health-table').hidden = rows.length === 0;
    rows.forEach((day) => {
      const row = document.createElement('tr');
      const source = day.sleepSource ? t(`health.source.${day.sleepSource}`) : '—';
      const cells = [formatDate(day.date), source, formatDuration(day.sleepMinutes), rounded(day.heartRateAvg, ' bpm'), rounded(day.spo2Avg, '%', 1), day.steps == null ? '—' : Math.round(day.steps).toLocaleString(locale())];
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
      return { date, migraine: false, hasDiaryEntry: false, stressTrigger: false, sleepMinutes: record?.duration?.totalMinutes ?? null, sleepSource: record ? 'manual' : null, heartRateAvg: null, spo2Avg: null, steps: null };
    });
    const sleepValues = series.map((day) => day.sleepMinutes).filter(Number.isFinite);
    renderAnalysis({ range: state.range, series, kpis: { averageSleepMinutes: sleepValues.length ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length : null, migraineDays: 0, averageHeartRate: null, averageSpo2: null, averageSteps: null }, coverage: { recordedDays: sleepValues.length, overlappingDays: 0, insightsAvailable: false }, comparisons: null });
  }

  async function loadAll(showLoading = true) {
    if (showLoading) setStatus(t('health.common.loading'));
    if (!window.ApiClient?.hasToken()) {
      state.connection = null; state.latest = null; renderConnection(); renderLocalAnalysis(); setStatus(t('health.record.loginRequired'));
      return;
    }
    try {
      const [connectionData, analysis] = await Promise.all([window.ApiClient.getHealthConnection(), window.ApiClient.getHealthAnalysis(state.range)]);
      state.connection = connectionData.connection;
      state.latest = connectionData.latest;
      renderAnalysis(analysis);
      setStatus('');
    } catch (error) {
      if (error.status === 401) showModal('loginModal');
      renderLocalAnalysis();
      setStatus(error.status ? error.message : t('health.common.offline'), 'error');
    }
  }

  function initControls() {
    document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', async () => {
      state.range = Number(button.dataset.range);
      document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('is-active', item === button));
      await loadAll();
    }));
    document.getElementById('refreshBtn').addEventListener('click', () => loadAll());
    document.getElementById('setupBtn').addEventListener('click', () => {
      const panel = document.getElementById('androidSetup');
      panel.hidden = !panel.hidden;
      document.getElementById('setupBtn').setAttribute('aria-expanded', String(!panel.hidden));
    });
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

  async function init() {
    await window.ApiClient?.ready?.();
    initAuth();
    initSleepForm();
    initControls();
    initNativeHealth();
    loadAll();
    window.addEventListener('migraine:languagechange', () => {
      updateAuthHeader();
      if (state.analysis) renderAnalysis(state.analysis);
      else renderConnection();
      renderNativeControls();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
