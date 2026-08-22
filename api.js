// ============================================================
// 偏头痛记录日历 - 后端 API 客户端
// 说明：
//   1. 后端服务运行在 http://localhost:3000（可通过 window.API_BASE_URL 覆盖）
//   2. 后端可用时，数据读写走服务端（SQLite + JWT），否则自动降级到 localStorage
//   3. 这样即使不启动后端，原有功能也不受影响
// ============================================================
(function (global) {
  'use strict';

  const defaultOrigin = /^https?:$/.test(global.location.protocol) ? global.location.origin : 'http://localhost:3000';
  const API_BASE = (global.API_BASE_URL || defaultOrigin).replace(/\/+$/, '') + '/api';

  const ApiClient = {
    _token: null,
    _backendAvailable: null, // null=未知 true=可用 false=不可用

    // ---- Token 管理 ----
    setToken(token) {
      this._token = token || '';
      if (token) {
        localStorage.setItem('authToken', token);
      } else {
        localStorage.removeItem('authToken');
      }
    },
    getToken() {
      if (!this._token) {
        this._token = localStorage.getItem('authToken') || '';
      }
      return this._token;
    },
    hasToken() {
      return !!this.getToken();
    },

    // ---- 基础请求 ----
    async _request(method, path, body) {
      const headers = {
        'Content-Type': 'application/json',
        'Accept-Language': global.I18n ? global.I18n.getLanguage() : 'zh-CN'
      };
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
      const res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }

      if (!res.ok) {
        const fallbackMessage = global.I18n
          ? global.I18n.t('api.requestFailed', { status: res.status })
          : ('请求失败 (' + res.status + ')');
        const err = new Error((data && data.error) || fallbackMessage);
        err.status = res.status;
        throw err;
      }
      return data;
    },

    // 健康检查（探测后端是否可用）
    async health() {
      try {
        const res = await fetch(API_BASE + '/health', {
          method: 'GET',
          headers: { 'Accept-Language': global.I18n ? global.I18n.getLanguage() : 'zh-CN' }
        });
        const data = await res.json();
        this._backendAvailable = !!(data && data.ok);
      } catch (e) {
        this._backendAvailable = false;
      }
      return this._backendAvailable;
    },

    isAvailable() {
      return this._backendAvailable === true;
    },

    // 是否已登录（有 token 或本地有当前登录用户）
    isLoggedIn() {
      return this.hasToken() || !!localStorage.getItem('currentUser');
    },

    // 需要登录才能继续；未登录则提示并尝试打开登录框，返回 false
    requireLogin(message) {
      if (this.isLoggedIn()) return true;
      alert(message || '请先登录或注册后再操作');
      if (typeof window.showModal === 'function') {
        window.showModal('loginModal');
      } else {
        const modal = document.getElementById('loginModal');
        if (modal) modal.style.display = 'flex';
      }
      return false;
    },

    // 清空本地个人数据缓存（退出登录/切换账号时调用，避免串号看到他人数据）
    clearLocalData() {
      localStorage.removeItem('migraineCalendarData');
      localStorage.removeItem('sleepRecords');
      localStorage.removeItem('sleepData');
      localStorage.removeItem('aiChatHistory');
    },

    // ---- 认证 ----
    register(username, password) {
      return this._request('POST', '/auth/register', { username, password });
    },
    login(username, password) {
      return this._request('POST', '/auth/login', { username, password });
    },
    me() {
      return this._request('GET', '/auth/me');
    },

    // ---- 日历 ----
    getCalendar() {
      return this._request('GET', '/calendar');
    },
    saveCalendarEntry(date, entry) {
      return this._request('PUT', '/calendar/' + encodeURIComponent(date), entry);
    },
    deleteCalendarEntry(date) {
      return this._request('DELETE', '/calendar/' + encodeURIComponent(date));
    },

    // ---- 睡眠 ----
    getSleepRecords() {
      return this._request('GET', '/sleep');
    },
    saveSleepRecord(date, record) {
      return this._request('PUT', '/sleep/' + encodeURIComponent(date), record);
    },
    deleteSleepRecord(date) {
      return this._request('DELETE', '/sleep/' + encodeURIComponent(date));
    },

    // ---- 健康分析 / Health Connect ----
    getHealthConnection() {
      return this._request('GET', '/health/connection');
    },
    createHealthConnection(connection) {
      return this._request('POST', '/health/connections', connection);
    },
    updateHealthDevicePreference(preference) {
      return this._request('PUT', '/health/device-preference', preference);
    },
    disconnectHealthConnection(id) {
      return this._request('DELETE', '/health/connections/' + encodeURIComponent(id));
    },
    syncHealthData(payload) {
      return this._request('POST', '/health/sync', payload);
    },
    syncEsp32Environment(payload) {
      return this._request('POST', '/health/environment-sync', payload);
    },
    getHealthAnalysis(range) {
      return this._request('GET', '/health/analysis?range=' + encodeURIComponent(range || 30));
    },

    // ---- Tips 广场 ----
    getTips() {
      return this._request('GET', '/tips');
    },
    getTip(id) {
      return this._request('GET', '/tips/' + id);
    },
    publishTip(data) {
      return this._request('POST', '/tips', data);
    },
    getComments(tipId) {
      return this._request('GET', '/tips/' + tipId + '/comments');
    },
    addComment(tipId, content) {
      return this._request('POST', '/tips/' + tipId + '/comments', { content });
    },
    likeTip(tipId) {
      return this._request('POST', '/tips/' + tipId + '/like');
    },

    // ---- AI 助手 ----
    chat(message, history) {
      return this._request('POST', '/ai/chat', { message, history: history || [] });
    },
    chatHistory() {
      return this._request('GET', '/ai/history');
    }
  };

  // 尝试从 localStorage 恢复 token
  ApiClient.getToken();
  // 启动时探测后端可用性
  ApiClient.health();

  global.ApiClient = ApiClient;
})(window);
