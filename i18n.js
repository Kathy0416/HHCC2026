(function (global) {
  'use strict';

  const catalog = global.MigraineLocales;
  if (!catalog) throw new Error('locales.js must be loaded before i18n.js');

  const STORAGE_KEY = 'migraineSignal.locale';
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();

  function normalizeLanguage(value, fallback) {
    const language = String(value || '').toLowerCase();
    if (language === 'zh-cn' || language.startsWith('zh')) return 'zh-CN';
    if (language === 'en' || language.startsWith('en')) return 'en';
    return fallback || null;
  }

  function resolveLanguage() {
    const stored = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (const language of browserLanguages) {
      const normalized = normalizeLanguage(language);
      if (normalized) return normalized;
    }
    return 'en';
  }

  let currentLanguage = resolveLanguage();

  function interpolate(value, variables) {
    return String(value == null ? '' : value).replace(/\{\{\s*([^}\s]+)\s*\}\}/g, function (_, name) {
      return variables && variables[name] != null ? String(variables[name]) : '';
    });
  }

  function t(key, variables) {
    const localized = catalog.keys[currentLanguage] || catalog.keys.en;
    const fallback = catalog.keys.en || {};
    return interpolate(localized[key] != null ? localized[key] : (fallback[key] != null ? fallback[key] : key), variables);
  }

  function translateSource(value) {
    if (value == null || currentLanguage === 'zh-CN') return value;
    const input = String(value);
    const trimmed = input.trim();
    const translated = catalog.sourceToEnglish[trimmed];
    if (!translated) return value;
    return input.replace(trimmed, translated);
  }

  function rememberAttribute(element, attribute) {
    let values = originalAttributes.get(element);
    if (!values) {
      values = {};
      originalAttributes.set(element, values);
    }
    if (!(attribute in values)) values[attribute] = element.getAttribute(attribute);
    return values[attribute];
  }

  function applyElement(element) {
    if (!(element instanceof Element) || element.closest('[data-i18n-skip]')) return;

    const key = element.getAttribute('data-i18n');
    if (key) element.textContent = t(key);

    const attributeKeys = {
      placeholder: 'data-i18n-placeholder',
      title: 'data-i18n-title',
      'aria-label': 'data-i18n-aria-label'
    };
    Object.keys(attributeKeys).forEach(function (attribute) {
      const translationKey = element.getAttribute(attributeKeys[attribute]);
      if (translationKey) element.setAttribute(attribute, t(translationKey));
    });

    ['placeholder', 'title', 'aria-label', 'data-text'].forEach(function (attribute) {
      if (!element.hasAttribute(attribute)) return;
      const source = rememberAttribute(element, attribute);
      element.setAttribute(attribute, currentLanguage === 'zh-CN' ? source : translateSource(source));
    });
  }

  function applyTextNode(node) {
    if (node.parentElement && node.parentElement.closest('script, style, textarea, [data-i18n-skip], [data-i18n]')) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const source = originalText.get(node);
    node.nodeValue = currentLanguage === 'zh-CN' ? source : translateSource(source);
  }

  function applyTranslations(root) {
    const scope = root || document;
    if (scope.nodeType === Node.ELEMENT_NODE) applyElement(scope);
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) applyElement(node);
      else applyTextNode(node);
    }
    document.documentElement.lang = currentLanguage;
  }

  function formatDate(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '');
    return new Intl.DateTimeFormat(currentLanguage, options || { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  }

  function setLanguage(language, options) {
    const normalized = normalizeLanguage(language, 'en');
    if (normalized === currentLanguage && !(options && options.force)) {
      if (!options || options.persist !== false) localStorage.setItem(STORAGE_KEY, currentLanguage);
      syncSelector();
      return;
    }
    currentLanguage = normalized;
    if (!options || options.persist !== false) localStorage.setItem(STORAGE_KEY, currentLanguage);
    applyTranslations(document);
    syncSelector();
    global.dispatchEvent(new CustomEvent('migraine:languagechange', { detail: { language: currentLanguage } }));
  }

  function syncSelector() {
    document.querySelectorAll('[data-language-selector]').forEach(function (selector) {
      selector.value = currentLanguage;
      selector.setAttribute('aria-label', t('language.label'));
      selector.title = t('language.label');
    });
  }

  function addSelector() {
    if (document.querySelector('[data-language-selector]')) return;
    const headerTarget = document.querySelector('.user-auth-section') || document.querySelector('.header-content') || document.querySelector('.header') || document.querySelector('.chat-header');
    if (!headerTarget) return;
    const wrapper = document.createElement('label');
    wrapper.className = 'language-switcher';
    wrapper.setAttribute('data-i18n-skip', '');
    const selector = document.createElement('select');
    selector.setAttribute('data-language-selector', '');
    selector.innerHTML = '<option value="en">English</option><option value="zh-CN">简体中文</option>';
    selector.value = currentLanguage;
    selector.setAttribute('aria-label', t('language.label'));
    selector.title = t('language.label');
    selector.addEventListener('change', function () { setLanguage(selector.value); });
    wrapper.appendChild(selector);
    headerTarget.insertBefore(wrapper, headerTarget.firstChild);
  }

  function addStyles() {
    if (document.getElementById('i18n-styles')) return;
    const style = document.createElement('style');
    style.id = 'i18n-styles';
    style.textContent = '.language-switcher{display:inline-flex;align-items:center;margin-right:.65rem}.language-switcher select{appearance:auto;background:rgba(255,255,255,.1);color:var(--text-primary,#fff);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:.4rem .65rem;font:inherit;font-size:.78rem;cursor:pointer;max-width:8.5rem}.language-switcher select option{color:#111;background:#fff}@media(max-width:600px){.language-switcher{margin-right:.25rem}.language-switcher select{max-width:6.8rem;padding:.32rem .45rem;font-size:.72rem}}';
    document.head.appendChild(style);
  }

  // Existing pages contain alerts in inline scripts. Translating them here keeps
  // those messages consistent while the pages are gradually moved to semantic keys.
  const nativeAlert = global.alert && global.alert.bind(global);
  const nativeConfirm = global.confirm && global.confirm.bind(global);
  if (nativeAlert) global.alert = function (message) { return nativeAlert(translateSource(message)); };
  if (nativeConfirm) global.confirm = function (message) { return nativeConfirm(translateSource(message)); };

  function initialize() {
    addStyles();
    addSelector();
    applyTranslations(document);
    syncSelector();
    global.dispatchEvent(new CustomEvent('migraine:i18nready', { detail: { language: currentLanguage } }));
  }

  global.I18n = {
    t,
    translate: translateSource,
    getLanguage: function () { return currentLanguage; },
    setLanguage,
    formatDate,
    applyTranslations,
    normalizeLanguage
  };

  document.documentElement.lang = currentLanguage;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
