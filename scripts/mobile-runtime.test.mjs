import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const rootUrl = new URL('../', import.meta.url);

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

async function evaluate(file, context) {
  const source = await readFile(new URL(file, rootUrl), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

test('native wrappers call the registered secure-auth and Health Connect methods', async () => {
  const calls = [];
  const plugins = {
    SecureAuth: {
      getToken: async () => ({ token: 'secure-token' }),
      setToken: async (value) => calls.push(['setToken', value]),
      clear: async () => calls.push(['clear'])
    },
    HealthConnect: {
      requestHealthPermissions: async (value) => calls.push(['permissions', value]),
      readDailyData: async (value) => calls.push(['read', value])
    }
  };
  const context = vm.createContext({ console });
  context.window = context;
  context.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    registerPlugin: (name) => plugins[name]
  };

  await evaluate('native-auth.js', context);
  await evaluate('mobile-health.js', context);
  assert.equal((await context.NativeAuth.getToken()).token, 'secure-token');
  await context.NativeAuth.setToken('next-token');
  await context.MobileHealth.requestPermissions({ includeHistory: true });
  await context.MobileHealth.readDailyData({ sourcePackage: 'com.xiaomi.wearable', days: 30 });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['setToken', { token: 'next-token' }],
    ['permissions', { includeHistory: true }],
    ['read', { sourcePackage: 'com.xiaomi.wearable', days: 30 }]
  ]);
});

test('Android API requests restore the Keystore token and never retain it in localStorage', async () => {
  const requests = [];
  const secureWrites = [];
  const localStorage = storage({ authToken: 'legacy-token' });
  const context = vm.createContext({
    console,
    localStorage,
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  });
  context.window = context;
  context.location = { protocol: 'https:', origin: 'https://localhost' };
  context.MIGRAINE_APP_CONFIG = { apiBaseUrl: 'https://api.example.test' };
  context.NativeAuth = {
    isAvailable: () => true,
    getToken: async () => ({ token: 'keystore-token' }),
    setToken: async (token) => secureWrites.push(token),
    clear: async () => secureWrites.push('cleared')
  };

  await evaluate('api.js', context);
  await context.ApiClient.ready();
  await context.ApiClient.getHealthConnection();
  const authenticated = requests.find((request) => request.url.endsWith('/api/health/connection'));
  assert.equal(authenticated.options.headers.Authorization, 'Bearer keystore-token');
  assert.equal(localStorage.getItem('authToken'), null);

  context.ApiClient.setToken('replacement-token');
  assert.equal(context.ApiClient.getToken(), 'replacement-token');
  assert.equal(localStorage.getItem('authToken'), null);
  assert.deepEqual(secureWrites, ['replacement-token']);
});

test('browser API sessions continue to use localStorage', async () => {
  const localStorage = storage({ authToken: 'browser-token' });
  const context = vm.createContext({
    console,
    localStorage,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  });
  context.window = context;
  context.location = { protocol: 'https:', origin: 'https://app.example.test' };

  await evaluate('api.js', context);
  await context.ApiClient.ready();
  assert.equal(context.ApiClient.getToken(), 'browser-token');
  context.ApiClient.setToken('updated-browser-token');
  assert.equal(localStorage.getItem('authToken'), 'updated-browser-token');
});
