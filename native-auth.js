(function (global) {
  'use strict';

  const capacitor = global.Capacitor;
  const isNative = !!(
    capacitor &&
    typeof capacitor.isNativePlatform === 'function' &&
    capacitor.isNativePlatform() &&
    typeof capacitor.registerPlugin === 'function'
  );
  const plugin = isNative ? capacitor.registerPlugin('SecureAuth') : null;

  global.NativeAuth = Object.freeze({
    isAvailable: () => !!plugin,
    getToken: () => plugin?.getToken(),
    setToken: (token) => plugin?.setToken({ token: token || '' }),
    clear: () => plugin?.clear()
  });
}(window));
