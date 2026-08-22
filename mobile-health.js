(function (global) {
  'use strict';

  const capacitor = global.Capacitor;
  const isAndroid = !!(
    capacitor &&
    typeof capacitor.isNativePlatform === 'function' &&
    capacitor.isNativePlatform() &&
    typeof capacitor.getPlatform === 'function' &&
    capacitor.getPlatform() === 'android'
  );
  const plugin = isAndroid && typeof capacitor.registerPlugin === 'function'
    ? capacitor.registerPlugin('HealthConnect')
    : null;

  global.MobileHealth = Object.freeze({
    isAndroid,
    isAvailable: () => !!plugin,
    getAvailability: (options) => plugin?.getAvailability(options),
    getPermissionState: (options) => plugin?.getPermissionState(options),
    requestPermissions: (options) => plugin?.requestHealthPermissions(options || {}),
    discoverOrigins: (options) => plugin?.discoverOrigins(options || {}),
    readDailyData: (options) => plugin?.readDailyData(options || {}),
    openHealthConnectSettings: () => plugin?.openHealthConnectSettings()
  });
}(window));
