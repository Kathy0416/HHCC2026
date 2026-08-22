(function () {
  'use strict';

  function renderSiteHeader() {
    const mount = document.querySelector('[data-site-header]');
    if (!mount || mount.dataset.rendered === 'true') return;

    const pageTitle = mount.dataset.pageTitle || '';
    const header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML = `
      <div class="site-header__inner">
        <div class="site-header__title-group">
          <a class="site-header__brand" href="index.html" aria-label="Migraine Signal home">Migraine Signal</a>
          <span class="site-header__divider" aria-hidden="true"></span>
          <h1 class="site-header__page-title" data-text="${pageTitle}"></h1>
        </div>
        <div class="user-auth-section">
          <div id="userStatus" class="user-status" style="display: none;">
            <span id="usernameDisplay"></span>
            <button id="logoutBtn" class="logout-btn" type="button">退出登录</button>
          </div>
          <div id="authBtns" class="auth-buttons">
            <button id="loginBtn" class="auth-btn" type="button">登录</button>
            <button id="registerBtn" class="auth-btn" type="button">注册</button>
          </div>
        </div>
      </div>
    `;

    header.querySelector('.site-header__page-title').textContent = pageTitle;
    mount.appendChild(header);
    mount.dataset.rendered = 'true';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSiteHeader, { once: true });
  } else {
    renderSiteHeader();
  }
})();
