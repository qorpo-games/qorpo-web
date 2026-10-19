/* Latest article discovery. Same-origin editorial content only; no third-party scripts. */
(function () {
  'use strict';
  var COOLDOWN = 72 * 60 * 60 * 1000;
  function safeArticle(href, origin) {
    try {
      var u = new URL(href, origin + '/');
      if (u.origin !== origin || !/^\/[a-z0-9][a-z0-9/-]*$/i.test(u.pathname) || /\/(?:admin|auth|login)(?:\/|$)/.test(u.pathname)) return null;
      if (u.pathname === '/blog' || u.pathname === '/') return null;
      return u.pathname.replace(/\/$/, '');
    } catch (e) { return null; }
  }
  function eligible(state, now, path) {
    return !!path && (!state.lastAt || now - state.lastAt >= COOLDOWN) && (state.seen || []).indexOf(path) < 0;
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { safeArticle: safeArticle, eligible: eligible, cooldown: COOLDOWN }; return; }
  if (document.getElementById('bd-popup') || !window.fetch) return;
  var band = document.querySelector('[data-blog-discovery]');
  if (!band) return;
  var brand = band.getAttribute('data-blog-discovery');
  var name = brand === 'aneemate' ? 'AneeMate' : 'QORPO';
  var origin = location.origin, path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  if (/^\/(?:admin|auth|login)(?:\/|$)/.test(path)) return;
  var key = 'blog-discovery-v1', state = {}, storageOK = true;
  try { state = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { storageOK = false; }
  if (typeof state !== 'object' || Array.isArray(state)) state = {};
  if (typeof state.lastAt !== 'number' || !isFinite(state.lastAt)) state.lastAt = 0;
  if (!Array.isArray(state.seen)) state.seen = [];
  state.seen = state.seen.filter(function (x) { return typeof x === 'string'; }).slice(-30);
  function remember(article) {
    if (state.seen.indexOf(article.path) < 0) state.seen.push(article.path);
    state.seen = state.seen.slice(-30); state.lastAt = Date.now();
    try { localStorage.setItem(key, JSON.stringify(state)); return true; } catch (e) { storageOK = false; return false; }
  }
  function track(event, article, placement) {
    (window.dataLayer = window.dataLayer || []).push({ event: event, article_path: article.path, article_brand: brand, placement: placement });
  }
  function safeImage(src) {
    try { var u = new URL(src, origin + '/'); return u.origin === origin && u.pathname.indexOf('/assets/') === 0 ? u.pathname : ''; } catch (e) { return ''; }
  }
  function articles(doc) {
    var selector = brand === 'aneemate' ? '.j-grid .j-card' : '.bgrid .bp';
    var found = [], seen = {};
    Array.prototype.forEach.call(doc.querySelectorAll(selector), function (card) {
      var articlePath = safeArticle(card.getAttribute('href'), origin), title = card.querySelector('h2'), img = card.querySelector('img');
      if (!articlePath || seen[articlePath] || !title || !title.textContent.trim()) return;
      seen[articlePath] = true;
      found.push({ path: articlePath, title: title.textContent.trim().slice(0, 220), image: img ? safeImage(img.getAttribute('src') || '') : '' });
    });
    return found;
  }
  function image(article, lazy) {
    if (!article.image) return null;
    var img = document.createElement('img'); img.src = article.image; img.alt = ''; img.width = 640; img.height = 360;
    img.decoding = 'async'; if (lazy) img.loading = 'lazy';
    img.addEventListener('error', function () { img.remove(); }, { once: true }); return img;
  }
  function card(article) {
    var a = document.createElement('a'); a.className = 'bd-card'; a.href = article.path;
    var img = image(article, true); if (img) a.appendChild(img);
    var title = document.createElement('span'); title.className = 'bd-card-title'; title.textContent = article.title; a.appendChild(title);
    var cta = document.createElement('span'); cta.className = 'bd-card-cta'; cta.textContent = 'Read article'; a.appendChild(cta);
    a.addEventListener('click', function () { remember(article); track('blog_article_click', article, 'footer'); }); return a;
  }
  var latest = [], lastFocus = null, popup = null, shown = false;
  function close() {
    if (!popup) return;
    var restore = popup.contains(document.activeElement), old = popup; popup = null; old.remove();
    if (restore && lastFocus && lastFocus.isConnected && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
    document.removeEventListener('keydown', escape);
  }
  function escape(e) { if (e.key === 'Escape' && popup && !blocked()) close(); }
  function blocked() {
    if (document.hidden || document.documentElement.matches('.q-in-on,.q-in-pre,.q-promo-on,.q-lock,.drawer-open')) return true;
    if (document.body.classList.contains('menu-open')) return true;
    return Array.prototype.some.call(document.querySelectorAll('dialog[open],.qp.open,[aria-modal="true"],.lt.open,.lt-card.in'), function (el) {
      var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
  }
  function offset() {
    if (!popup) return;
    var bottom = 16;
    document.querySelectorAll('.q-bar.on,.lt').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width && r.height && r.top < innerHeight && (innerWidth <= 680 || el.classList.contains('q-bar'))) bottom = Math.max(bottom, innerHeight - r.top + 12);
    });
    popup.style.setProperty('--bd-bottom', bottom + 'px');
  }
  function show(article) {
    if (shown || !storageOK || blocked() || !eligible(state, Date.now(), article.path)) return false;
    if (!remember(article)) return false;
    shown = true; lastFocus = document.activeElement;
    popup = document.createElement('aside'); popup.className = 'bd-popup'; popup.id = 'bd-popup'; popup.setAttribute('data-brand', brand); popup.setAttribute('aria-labelledby', 'bd-popup-title');
    var x = document.createElement('button'); x.type = 'button'; x.className = 'bd-close'; x.setAttribute('aria-label', 'Dismiss article recommendation'); x.textContent = '×'; x.addEventListener('click', function () { track('blog_promo_dismiss', article, 'popup'); close(); }); popup.appendChild(x);
    var link = document.createElement('a'); link.className = 'bd-popup-link'; link.href = article.path;
    var img = image(article, false); if (img) link.appendChild(img);
    var copy = document.createElement('div'); copy.className = 'bd-popup-copy';
    var label = document.createElement('span'); label.className = 'bd-eyebrow'; label.textContent = 'From the ' + name + ' blog'; copy.appendChild(label);
    var h = document.createElement('h2'); h.id = 'bd-popup-title'; h.textContent = article.title; copy.appendChild(h);
    var cta = document.createElement('span'); cta.className = 'bd-popup-cta'; cta.textContent = 'Read the story'; copy.appendChild(cta); link.appendChild(copy);
    link.addEventListener('click', function () { track('blog_article_click', article, 'popup'); }); popup.appendChild(link); document.body.appendChild(popup); offset();
    document.addEventListener('keydown', escape); track('blog_promo_view', article, 'popup'); return true;
  }
  function render(list) {
    if (!list.length) return;
    latest = list;
    var posts = band.querySelector('.bd-posts');
    if (posts) { var fragment = document.createDocumentFragment(); list.slice(0, 3).forEach(function (a) { fragment.appendChild(card(a)); }); posts.replaceChildren(fragment); }
    band.querySelectorAll('a[href="/blog"]').forEach(function (a) { a.addEventListener('click', function () { track('blog_index_click', { path: '/blog' }, 'footer'); }); });
  }
  if (path === '/blog') render(articles(document));
  else fetch('/blog', { credentials: 'same-origin', cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('Blog unavailable'); return r.text(); }).then(function (text) { render(articles(new DOMParser().parseFromString(text, 'text/html'))); }).catch(function () { /* The static footer remains useful offline. */ });
  var reading = path === '/blog' || !!document.querySelector('meta[property="og:type"][content="article"]');
  var sensitive = /^\/(?:admin|auth|login|open|packs|claim|staking|spin|link|profile|buy|checkout|wallet|bridge)(?:\/|$)/.test(path);
  if (!storageOK || reading || sensitive || !eligible(state, Date.now(), '/new-article')) return;
  var started = Date.now(), engaged = false, attempts = 0, timer = null;
  function attempt() {
    timer = null;
    if (shown || ++attempts > 30) return;
    var next = latest.filter(function (a) { return a.path !== path && eligible(state, Date.now(), a.path); })[0];
    if (engaged && next && Date.now() - started >= 25000 && show(next)) return;
    timer = setTimeout(attempt, 4000);
  }
  window.addEventListener('scroll', function () { if (scrollY > Math.min(300, innerHeight * 0.3)) engaged = true; offset(); }, { passive: true });
  window.addEventListener('resize', offset, { passive: true });
  window.addEventListener('pagehide', function () { if (timer) clearTimeout(timer); close(); }, { once: true });
  timer = setTimeout(attempt, 25000);
})();
