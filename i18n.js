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
    document.querySelectorAll('[data-language-selector]').forEach(function (trigger) {
      const wrapper = trigger.closest('.language-switcher');
      const languageName = currentLanguage === 'en' ? t('language.english') : t('language.chinese');
      trigger.querySelectorAll('.language-current-name, .language-chevron').forEach(function (legacyElement) {
        legacyElement.remove();
      });
      const currentCode = trigger.querySelector('.language-current-code');
      if (currentCode) currentCode.textContent = currentLanguage === 'en' ? 'EN' : '中';
      trigger.setAttribute('aria-label', t('language.current', { language: languageName }));
      trigger.title = t('language.current', { language: languageName });

      if (!wrapper) return;
      const menu = wrapper.querySelector('.language-menu');
      if (menu) menu.setAttribute('aria-label', t('language.label'));
      wrapper.querySelectorAll('[data-language-option]').forEach(function (option) {
        const selected = option.dataset.languageOption === currentLanguage;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-checked', String(selected));
        option.tabIndex = wrapper.classList.contains('is-open') && selected ? 0 : -1;
        const name = option.querySelector('.language-option-name');
        if (name) name.textContent = option.dataset.languageOption === 'en' ? t('language.english') : t('language.chinese');
      });
    });
  }

  function setLanguageMenuOpen(wrapper, shouldOpen, focusOption) {
    if (!wrapper) return;
    const trigger = wrapper.querySelector('[data-language-selector]');
    const menu = wrapper.querySelector('.language-menu');
    const options = Array.from(wrapper.querySelectorAll('[data-language-option]'));
    wrapper.classList.toggle('is-open', shouldOpen);
    trigger.setAttribute('aria-expanded', String(shouldOpen));
    menu.setAttribute('aria-hidden', String(!shouldOpen));
    options.forEach(function (option) { option.tabIndex = -1; });
    if (shouldOpen) {
      const selected = options.find(function (option) { return option.dataset.languageOption === currentLanguage; }) || options[0];
      if (selected) {
        selected.tabIndex = 0;
        if (focusOption) selected.focus();
      }
    } else if (focusOption) {
      trigger.focus();
    }
  }

  function addSelector() {
    if (document.querySelector('[data-language-selector]')) return;
    const headerTarget = document.querySelector('.user-auth-section') || document.querySelector('.header-content') || document.querySelector('.header') || document.querySelector('.chat-header');
    if (!headerTarget) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'language-switcher';
    wrapper.setAttribute('data-i18n-skip', '');
    wrapper.innerHTML = `
      <button class="language-trigger" type="button" data-language-selector aria-haspopup="menu" aria-expanded="false" aria-controls="language-menu">
        <span class="language-globe-wrap" aria-hidden="true">
          <svg class="language-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8.5"></circle>
            <path d="M3.8 12h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5S14.1 18.2 12 20.5M12 3.5C9.9 5.8 8.8 8.6 8.8 12s1.1 6.2 3.2 8.5"></path>
          </svg>
          <span class="language-current-code"></span>
        </span>
      </button>
      <div class="language-menu" id="language-menu" role="menu" aria-hidden="true">
        <button class="language-option" type="button" role="menuitemradio" data-language-option="en" aria-checked="false" tabindex="-1">
          <span class="language-option-code" aria-hidden="true">EN</span>
          <span class="language-option-name">English</span>
          <svg class="language-option-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 8.5 3 3 7-7"></path></svg>
        </button>
        <button class="language-option" type="button" role="menuitemradio" data-language-option="zh-CN" aria-checked="false" tabindex="-1">
          <span class="language-option-code" aria-hidden="true">中</span>
          <span class="language-option-name">简体中文</span>
          <svg class="language-option-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 8.5 3 3 7-7"></path></svg>
        </button>
      </div>
    `;

    const trigger = wrapper.querySelector('[data-language-selector]');
    const menu = wrapper.querySelector('.language-menu');
    const options = Array.from(wrapper.querySelectorAll('[data-language-option]'));

    trigger.addEventListener('click', function () {
      setLanguageMenuOpen(wrapper, !wrapper.classList.contains('is-open'), false);
    });
    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        setLanguageMenuOpen(wrapper, !wrapper.classList.contains('is-open'), true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setLanguageMenuOpen(wrapper, true, true);
      } else if (event.key === 'Escape') {
        setLanguageMenuOpen(wrapper, false, false);
      }
    });
    menu.addEventListener('keydown', function (event) {
      const currentIndex = options.indexOf(document.activeElement);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + options.length) % options.length;
      else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = options.length - 1;
      else if (event.key === 'Escape') {
        event.preventDefault();
        setLanguageMenuOpen(wrapper, false, true);
        return;
      } else if (event.key === 'Tab') {
        setLanguageMenuOpen(wrapper, false, false);
        return;
      } else {
        return;
      }
      event.preventDefault();
      options.forEach(function (option) { option.tabIndex = -1; });
      options[nextIndex].tabIndex = 0;
      options[nextIndex].focus();
    });
    options.forEach(function (option) {
      option.addEventListener('click', function () {
        setLanguage(option.dataset.languageOption);
        setLanguageMenuOpen(wrapper, false, true);
      });
    });
    document.addEventListener('pointerdown', function (event) {
      if (wrapper.classList.contains('is-open') && !wrapper.contains(event.target)) {
        setLanguageMenuOpen(wrapper, false, false);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && wrapper.classList.contains('is-open')) {
        event.preventDefault();
        setLanguageMenuOpen(wrapper, false, true);
      }
    });

    headerTarget.insertBefore(wrapper, headerTarget.firstChild);
    syncSelector();
  }

  function addStyles() {
    if (document.getElementById('i18n-styles')) return;
    const style = document.createElement('style');
    style.id = 'i18n-styles';
    style.textContent = `
      .language-switcher{position:relative;display:inline-flex;align-items:center;flex:0 0 auto;z-index:40}
      .language-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;padding:0;border:1px solid rgba(137,166,255,.28);border-radius:14px;background:linear-gradient(145deg,rgba(50,65,96,.72),rgba(24,31,49,.78));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 5px 18px rgba(0,0,0,.16);color:var(--text-primary,#f4f7ff);font:inherit;cursor:pointer;transition:transform .18s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease}
      .language-trigger:hover{transform:translateY(-1px);border-color:rgba(112,151,255,.58);background:linear-gradient(145deg,rgba(60,80,124,.82),rgba(27,36,58,.88));box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 7px 22px rgba(20,49,123,.24)}
      .language-trigger:focus-visible,.language-option:focus-visible{outline:2px solid rgba(120,158,255,.95);outline-offset:2px}
      .language-globe-wrap{position:relative;display:grid;place-items:center;width:25px;height:25px;border-radius:9px;background:linear-gradient(145deg,rgba(78,116,224,.38),rgba(54,78,157,.22));color:#a9c1ff;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}
      .language-globe{width:18px;height:18px}
      .language-current-code{position:absolute;top:-7px;right:-8px;display:grid;place-items:center;min-width:18px;height:16px;padding:0 3px;border:2px solid #182033;border-radius:7px;background:#5d82ee;color:#fff;font-size:8px;font-weight:800;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,.28)}
      .language-trigger .language-current-name,.language-trigger .language-chevron{display:none!important}
      .language-switcher.is-open .language-trigger{border-color:rgba(112,151,255,.68);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 0 0 3px rgba(65,105,225,.13),0 8px 24px rgba(0,0,0,.22)}
      .language-menu{position:absolute;top:calc(100% + 10px);right:0;width:190px;padding:6px;border:1px solid rgba(119,149,231,.3);border-radius:15px;background:linear-gradient(160deg,rgba(35,45,68,.97),rgba(20,26,41,.98));backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 18px 45px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-6px) scale(.97);transform-origin:top right;transition:opacity .16s ease,visibility .16s ease,transform .16s ease;z-index:2000}
      .language-menu::before{content:"";position:absolute;top:-5px;right:18px;width:9px;height:9px;border-left:1px solid rgba(119,149,231,.3);border-top:1px solid rgba(119,149,231,.3);background:rgba(35,45,68,.97);transform:rotate(45deg)}
      .language-switcher.is-open .language-menu{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1)}
      .language-option{position:relative;display:grid;grid-template-columns:32px 1fr 18px;align-items:center;gap:9px;width:100%;min-height:44px;padding:6px 9px;border:0;border-radius:10px;background:transparent;color:var(--text-primary,#f4f7ff);font:inherit;font-size:.8rem;text-align:left;cursor:pointer;transition:background .15s ease,color .15s ease}
      .language-option:hover,.language-option:focus-visible{background:rgba(91,128,226,.14)}
      .language-option.is-selected{background:linear-gradient(90deg,rgba(72,111,220,.24),rgba(72,111,220,.09));color:#cbd9ff}
      .language-option-code{display:grid;place-items:center;width:30px;height:30px;border:1px solid rgba(141,167,240,.22);border-radius:9px;background:rgba(255,255,255,.045);font-size:.67rem;font-weight:800;color:#b7c8f8}
      .language-option-name{font-weight:600}
      .language-option-check{width:16px;height:16px;color:#7da2ff;opacity:0;transform:scale(.7);transition:opacity .15s ease,transform .15s ease}
      .language-option.is-selected .language-option-check{opacity:1;transform:scale(1)}
      @media(max-width:600px){.language-globe-wrap{width:27px;height:27px}.language-menu{left:0;right:auto;transform-origin:top left}.language-menu::before{left:16px;right:auto}}
      @media(prefers-reduced-motion:reduce){.language-trigger,.language-menu,.language-option,.language-option-check{transition:none!important}}
    `;
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
