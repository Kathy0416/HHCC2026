const catalog = require('../locales');

function normalizeLocale(value, fallback = 'zh-CN') {
  const language = String(value || '').split(',')[0].trim().toLowerCase();
  if (language === 'zh-cn' || language.startsWith('zh')) return 'zh-CN';
  if (language === 'en' || language.startsWith('en')) return 'en';
  return fallback;
}

function interpolate(value, variables) {
  return String(value == null ? '' : value).replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, key) => (
    variables && variables[key] != null ? String(variables[key]) : ''
  ));
}

function apiMessage(locale, key, variables) {
  const language = normalizeLocale(locale);
  const messages = catalog.api[language] || catalog.api['zh-CN'];
  return interpolate(messages[key] || catalog.api['zh-CN'][key] || key, variables);
}

function localeMiddleware(req, res, next) {
  req.locale = normalizeLocale(req.headers['accept-language']);
  req.t = (key, variables) => apiMessage(req.locale, key, variables);
  next();
}

module.exports = { normalizeLocale, interpolate, apiMessage, localeMiddleware };
