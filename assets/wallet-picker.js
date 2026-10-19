/* wallet-picker.js: the person always chooses WHICH wallet app and WHICH account.

   Why: a browser can have several wallets (MetaMask, Rabby, Coinbase, OKX, Trust, Brave...)
   and one wallet can hold many accounts. Asking window.ethereum for eth_requestAccounts
   silently takes whatever account MetaMask has selected, which is often the wrong one.

   How:
   1. Wallet apps are found with EIP-6963 (eip6963:requestProvider / announceProvider).
      With more than one, a small sheet lists them (icon and name). Without any announcement
      the old window.ethereum (and window.okxwallet) is used.
   2. Every explicit Connect, and Switch account, calls wallet_requestPermissions first, so
      the wallet shows its own account picker. If the wallet then shares several accounts,
      our own list asks which one to use here.
   3. WalletPicker.eth is an EIP-1193 provider for the page code: it talks to the chosen
      wallet and answers eth_accounts / eth_requestAccounts with the chosen account only,
      so ethers' getSigner() and every "from" use that account. Its accountsChanged event
      carries the chosen account too.
   4. The last choice (wallet and account) is remembered per site in localStorage. It is
      restored silently only while the wallet still shares that exact account.

   Bars: any element with [data-wallet-bar] shows the connected address with Copy, Switch
   account, Change wallet (when there is more than one) and Disconnect. With
   data-wallet-expect="0x..." it warns when the connected account is not that one.
   Nothing here holds a key or sends a transaction by itself. */
(function () {
  'use strict';
  if (window.WalletPicker) return;

  var KEY = 'walletPicker.v1';
  var script = document.currentScript;
  var ACCENT = (script && script.getAttribute('data-accent')) || '';
  var SYMBOL = { 1: 'ETH', 56: 'BNB', 97: 'tBNB', 11155111: 'ETH', 8453: 'ETH', 137: 'POL' };

  var announced = [];        // EIP-6963 details: { info: { uuid, name, icon, rdns }, provider }
  var legacy = null;         // fallback list built from window.ethereum / window.okxwallet
  var active = null;         // the chosen wallet detail
  var account = null;        // the chosen account, as the wallet spelled it
  var confirmed = false;     // chosen by the person during this page load
  var lastFirst = null;      // first account of the wallet's own list when we last looked
  var quietUntil = 0;        // ignore the echo of our own permission request for a moment
  var pending = null;        // one connect at a time
  var restoring = null;
  var listeners = {};        // EIP-1193 listeners on the proxy
  var subs = [];             // WalletPicker.on callbacks
  var bound = null;          // the provider our wallet listeners sit on

  function lc(a) { return String(a || '').toLowerCase(); }
  function has(list, a) { a = lc(a); return (list || []).some(function (x) { return lc(x) === a; }); }
  function short(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 6) + '...' + a.slice(-4) : a; }
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function rejected(e) { return !!e && (e.code === 4001 || e.code === 'ACTION_REJECTED' || /user rejected|user denied/i.test(e.message || '')); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeIcon(u) { u = String(u || ''); return /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/i.test(u) || /^https:\/\//i.test(u) ? u : ''; }

  // ── finding wallets ──────────────────────────────────────────────────
  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e && e.detail;
    if (!d || !d.info || !d.provider || typeof d.provider.request !== 'function') return;
    for (var i = 0; i < announced.length; i++) {
      if (announced[i].info.uuid === d.info.uuid || announced[i].provider === d.provider) return;
    }
    announced.push({ info: { uuid: String(d.info.uuid || ''), name: String(d.info.name || 'Wallet'), icon: safeIcon(d.info.icon), rdns: String(d.info.rdns || d.info.name || '') }, provider: d.provider });
    if (sheet && sheet.kind === 'wallet') sheet.redraw();
  });
  function ask() { try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {} }

  function guessName(p) {
    if (p.isRabby) return 'Rabby';
    if (p.isOkxWallet || p.isOKExWallet || p === window.okxwallet) return 'OKX Wallet';
    if (p.isCoinbaseWallet) return 'Coinbase Wallet';
    if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
    if (p.isBraveWallet) return 'Brave Wallet';
    if (p.isPhantom) return 'Phantom';
    if (p.isMetaMask) return 'MetaMask';
    return 'Browser wallet';
  }
  function legacyList() {
    var out = [], seen = [];
    function add(p) {
      if (!p || typeof p.request !== 'function' || seen.indexOf(p) >= 0) return;
      seen.push(p);
      var n = guessName(p);
      out.push({ info: { uuid: 'legacy-' + out.length, name: n, icon: '', rdns: 'legacy.' + n.toLowerCase().replace(/\s+/g, '') }, provider: p });
    }
    var eth = window.ethereum;
    if (eth && eth.providers && eth.providers.length) eth.providers.forEach(add);
    add(eth);
    add(window.okxwallet);
    return out;
  }
  function wallets() {
    if (!announced.length) ask();
    if (announced.length) return announced.slice();
    if (!legacy || !legacy.length) legacy = legacyList();
    return legacy.slice();
  }
  function byRdns(rdns) { var w = wallets(); for (var i = 0; i < w.length; i++) if (w[i].info.rdns === rdns) return w[i]; return null; }

  // ── wallet events ────────────────────────────────────────────────────
  function emit(ev, arg) { (listeners[ev] || []).slice().forEach(function (fn) { try { fn(arg); } catch (e) { setTimeout(function () { throw e; }); } }); }
  function notify() {
    var info = active ? active.info : null;
    subs.slice().forEach(function (fn) { try { fn(account, info); } catch (e) { setTimeout(function () { throw e; }); } });
    drawBars();
  }
  function onAccounts(accs) {
    accs = accs || [];
    if (!account) return;
    if (!accs.length) { account = null; confirmed = false; lastFirst = null; emit('accountsChanged', []); notify(); return; }
    // Our own permission request echoes back here: keep what the person picked.
    if (Date.now() < quietUntil && has(accs, account)) { lastFirst = accs[0]; return; }
    // The wallet still shares our account and nobody switched inside the wallet: keep it.
    if (has(accs, account) && lc(accs[0]) === lc(lastFirst)) return;
    // The person switched accounts inside the wallet itself: follow that choice.
    lastFirst = accs[0];
    if (lc(accs[0]) === lc(account)) return;
    account = accs[0];
    remember();
    emit('accountsChanged', [account]);
    notify();
  }
  function onChain(id) { emit('chainChanged', id); }
  function onDisconnect(e) { emit('disconnect', e); }
  function bind(d) {
    var p = d && d.provider;
    if (bound === p) return;
    if (bound && bound.removeListener) {
      try { bound.removeListener('accountsChanged', onAccounts); bound.removeListener('chainChanged', onChain); bound.removeListener('disconnect', onDisconnect); } catch (e) {}
    }
    bound = p || null;
    if (p && p.on) {
      try { p.on('accountsChanged', onAccounts); p.on('chainChanged', onChain); p.on('disconnect', onDisconnect); } catch (e) {}
    }
  }
  function remember() { if (active && account) save({ rdns: active.info.rdns, name: active.info.name, account: account }); }

  // ── restoring the last choice, silently ──────────────────────────────
  function restore() {
    if (active && account) return Promise.resolve(account);
    if (restoring) return restoring;
    var s = load();
    var d = s && s.rdns ? byRdns(s.rdns) : null;
    if (!d || !s.account) return Promise.resolve(null);
    restoring = Promise.resolve().then(function () { return d.provider.request({ method: 'eth_accounts' }); }).then(function (accs) {
      if (!has(accs, s.account) || account) return account;
      active = d; account = accs.filter(function (x) { return lc(x) === lc(s.account); })[0];
      lastFirst = accs[0];
      bind(d);
      notify();
      return account;
    }, function () { return null; }).then(function (a) { restoring = null; return a; });
    return restoring;
  }

  // ── connecting ───────────────────────────────────────────────────────
  function connect(opts) {
    if (pending) return pending;
    opts = opts || {};
    pending = (async function () {
      // The wallet list shows once per page load (and on Change wallet); the account picker every time.
      var d = active && !opts.pickWallet && (opts.keepWallet || confirmed) ? active : await chooseWallet(!!opts.pickWallet);
      var p = d.provider;
      try {
        await p.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      } catch (e) {
        if (rejected(e)) throw e;
        if (e && e.code === -32002) throw err(-32002, 'Your wallet is already asking you something. Open the wallet, answer it, then try again.');
        // Wallets without wallet_requestPermissions: eth_requestAccounts below still asks.
      }
      quietUntil = Date.now() + 2000;
      var accs = await p.request({ method: 'eth_requestAccounts' });
      if (!accs || !accs.length) throw err(4001, 'User rejected: no account was shared.');
      var s = load();
      var pick = accs.length === 1 ? accs[0] : await chooseAccount(d, accs, s && s.account);
      active = d; account = pick; confirmed = true; lastFirst = accs[0];
      quietUntil = Date.now() + 1500;
      bind(d);
      remember();
      emit('accountsChanged', [account]);
      notify();
      return account;
    })();
    var clear = function () { pending = null; };
    pending.then(clear, clear);
    return pending;
  }

  // The account this page load already agreed on, or a fresh choice.
  async function ensure() {
    if (confirmed && active && account) {
      var accs = await active.provider.request({ method: 'eth_accounts' }).catch(function () { return []; });
      if (has(accs, account)) return account;
    }
    return connect();
  }

  async function disconnect() {
    var d = active;
    account = null; active = null; confirmed = false; lastFirst = null;
    save(null);
    bind(null);
    if (d) { try { await d.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch (e) {} }
    emit('accountsChanged', []);
    notify();
  }

  async function chooseWallet(pickAlways) {
    var list = wallets();
    if (!list.length) throw err('NO_WALLET', 'No wallet found. Install MetaMask (or open this page in your wallet app\'s browser) and try again.');
    if (list.length === 1 && !pickAlways) return list[0];
    return openSheet('wallet', { list: list });
  }
  function chooseAccount(d, accs, last) { return openSheet('account', { wallet: d, list: accs, last: last }); }

  // ── the proxy the page code talks to ─────────────────────────────────
  function provider() {
    if (active) return active;
    var s = load();
    return (s && s.rdns && byRdns(s.rdns)) || wallets()[0] || null;
  }
  var proxy = {
    isWalletPicker: true,
    request: async function (args) {
      var m = args && args.method;
      if (m === 'eth_requestAccounts') return [await ensure()];
      if (m === 'eth_accounts') {
        if (!account) await restore();
        if (!active || !account) return [];
        var accs = await active.provider.request({ method: 'eth_accounts' }).catch(function () { return []; });
        if (has(accs, account)) return [account];
        // The wallet no longer shares the chosen account: never fall back to another one.
        account = null; confirmed = false; notify();
        return [];
      }
      var d = provider();
      if (!d) throw err(4900, 'No wallet found.');
      return d.provider.request(args);
    },
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return proxy; },
    addListener: function (ev, fn) { return proxy.on(ev, fn); },
    removeListener: function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); return proxy; },
    off: function (ev, fn) { return proxy.removeListener(ev, fn); },
    removeAllListeners: function (ev) { if (ev) listeners[ev] = []; else listeners = {}; return proxy; }
  };

  // ── the sheet (wallet list or account list) ──────────────────────────
  var sheet = null;
  var CSS = '' +
    '.wp-dlg{border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:0;margin:auto;width:min(420px,calc(100% - 32px));max-height:min(560px,calc(100% - 32px));' +
      'background:#12141c;color:#f4f5f8;box-shadow:0 24px 80px rgba(0,0,0,.6);font:500 15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:auto}' +
    '.wp-dlg::backdrop{background:rgba(5,6,10,.72)}' +
    '.wp-dlg.wp-fallback{position:fixed;inset:0;z-index:2147483646;display:block}' +
    '.wp-in{padding:20px 18px 16px}' +
    '.wp-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 4px}' +
    '.wp-h h2{margin:0;font-size:18px;line-height:1.25;font-weight:700;color:#fff}' +
    '.wp-x{appearance:none;border:0;background:rgba(255,255,255,.08);color:#fff;width:32px;height:32px;border-radius:50%;font-size:18px;line-height:1;cursor:pointer;flex:none}' +
    '.wp-sub{margin:0 0 14px;color:#aab0bf;font-size:13.5px}' +
    '.wp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}' +
    '.wp-opt{appearance:none;width:100%;display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);' +
      'background:rgba(255,255,255,.04);color:#fff;font:inherit;text-align:left;cursor:pointer}' +
    '.wp-opt:hover,.wp-opt:focus-visible{border-color:var(--wp-accent,#FDCA4B);background:rgba(255,255,255,.08);outline:none}' +
    '.wp-ic{width:32px;height:32px;border-radius:8px;flex:none;background:rgba(255,255,255,.1);display:grid;place-items:center;font-weight:700;overflow:hidden}' +
    '.wp-ic img{width:100%;height:100%;object-fit:contain}' +
    '.wp-t{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '.wp-t b{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.wp-t small{color:#9097a8;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}' +
    '.wp-tag{flex:none;font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:99px;background:var(--wp-accent,#FDCA4B);color:#111}' +
    '.wp-bal{flex:none;color:#cfd3dc;font-size:12.5px;white-space:nowrap}' +
    '.wp-foot{margin:12px 0 0;color:#8a90a0;font-size:12.5px}' +
    '[data-wallet-bar]:empty{display:none}' +
    '.wp-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:8px 0;font-size:13.5px;line-height:1.35;color:inherit}' +
    '.wp-bar__who{display:inline-flex;align-items:center;gap:8px;min-width:0;padding:5px 10px;border-radius:99px;background:rgba(127,127,127,.14);border:1px solid rgba(127,127,127,.35)}' +
    '.wp-bar__who img{width:18px;height:18px;border-radius:4px}' +
    '.wp-bar__who b{font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0}' +
    '.wp-bar__dot{width:8px;height:8px;border-radius:50%;background:#3ddc97;flex:none}' +
    '.wp-bar button{appearance:none;border:0;background:none;color:inherit;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:6px 2px;min-height:32px;opacity:.9}' +
    '.wp-bar button:hover{opacity:1}' +
    '.wp-bar__note{flex-basis:100%;margin:0;padding:8px 10px;border-radius:10px;font-weight:600}' +
    '.wp-bar__note.is-bad{background:#b42318;color:#fff}' +
    '.wp-bar__note.is-ok{background:#067647;color:#fff}' +
    '.wp-bar__note.is-muted{background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.3)}';

  function style() {
    if (document.getElementById('wp-style')) return;
    var s = document.createElement('style');
    s.id = 'wp-style';
    s.textContent = CSS + (ACCENT ? ':root{--wp-accent:' + ACCENT.replace(/[^#a-zA-Z0-9(),.% ]/g, '') + '}' : '');
    (document.head || document.documentElement).appendChild(s);
  }

  function openSheet(kind, data) {
    style();
    if (sheet) sheet.cancel();
    return new Promise(function (resolve, reject) {
      var dlg = document.createElement('dialog');
      dlg.className = 'wp-dlg';
      dlg.setAttribute('aria-labelledby', 'wpTitle');
      var done = false;
      function finish(v, e) {
        if (done) return; done = true;
        sheet = null;
        try { if (dlg.open && dlg.close) dlg.close(); } catch (x) {}
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        if (e) reject(e); else resolve(v);
      }
      var cancelErr = function () { return err(4001, kind === 'wallet' ? 'User rejected: the wallet list was closed.' : 'User rejected: no account was picked.'); };
      sheet = { kind: kind, cancel: function () { finish(null, cancelErr()); }, redraw: function () { if (kind === 'wallet') { data.list = wallets(); draw(); } } };

      function draw() {
        var s = load(), html = '<div class="wp-in"><div class="wp-h"><h2 id="wpTitle">' +
          (kind === 'wallet' ? 'Choose a wallet' : 'Choose an account') + '</h2><button type="button" class="wp-x" data-wp-x aria-label="Close">&times;</button></div>';
        if (kind === 'wallet') {
          html += '<p class="wp-sub">Several wallets are installed in this browser. Pick the one to use here.</p><ul class="wp-list">';
          data.list.forEach(function (w, i) {
            var last = s && s.rdns === w.info.rdns;
            html += '<li><button type="button" class="wp-opt" data-wp="' + i + '">' +
              '<span class="wp-ic">' + (w.info.icon ? '<img alt="" src="' + esc(w.info.icon) + '">' : esc(w.info.name.charAt(0))) + '</span>' +
              '<span class="wp-t"><b>' + esc(w.info.name) + '</b></span>' + (last ? '<span class="wp-tag">Last used</span>' : '') + '</button></li>';
          });
          html += '</ul><p class="wp-foot">Next, your wallet asks which account to share.</p>';
        } else {
          html += '<p class="wp-sub">' + esc(data.wallet.info.name) + ' shared ' + data.list.length + ' accounts. Pick the one to use on this site.</p><ul class="wp-list">';
          data.list.forEach(function (a, i) {
            var last = lc(a) === lc(data.last);
            html += '<li><button type="button" class="wp-opt" data-wp="' + i + '">' +
              '<span class="wp-t"><b>' + esc(short(a)) + '</b><small>' + esc(a) + '</small></span>' +
              '<span class="wp-bal" data-wp-bal="' + i + '"></span>' + (last ? '<span class="wp-tag">Last used</span>' : '') + '</button></li>';
          });
          html += '</ul><p class="wp-foot">You can switch account at any time.</p>';
        }
        dlg.innerHTML = html + '</div>';
        [].forEach.call(dlg.querySelectorAll('[data-wp]'), function (b) {
          b.addEventListener('click', function () { var i = +b.getAttribute('data-wp'); finish(data.list[i]); });
        });
        dlg.querySelector('[data-wp-x]').addEventListener('click', function () { finish(null, cancelErr()); });
        var focus = dlg.querySelector('.wp-tag');
        focus = focus ? focus.parentNode : dlg.querySelector('[data-wp]');
        if (focus) setTimeout(function () { try { focus.focus(); } catch (e) {} }, 30);
      }
      draw();
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(null, cancelErr()); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) finish(null, cancelErr()); });
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') { try { dlg.showModal(); } catch (e) { dlg.classList.add('wp-fallback'); dlg.setAttribute('open', ''); } }
      else { dlg.classList.add('wp-fallback'); dlg.setAttribute('open', ''); }
      if (kind === 'account') balances(dlg, data);
    });
  }

  // Optional: what each account holds on the wallet's current chain.
  function balances(dlg, data) {
    var p = data.wallet.provider;
    Promise.resolve().then(function () { return p.request({ method: 'eth_chainId' }); }).then(function (cid) {
      var sym = SYMBOL[parseInt(cid, 16)] || '';
      data.list.forEach(function (a, i) {
        p.request({ method: 'eth_getBalance', params: [a, 'latest'] }).then(function (hex) {
          var wei = BigInt(hex), whole = wei / 10n ** 18n, frac = Number((wei % 10n ** 18n) / 10n ** 14n) / 1e4;
          var n = Number(whole) + frac;
          var el = dlg.querySelector('[data-wp-bal="' + i + '"]');
          if (el) el.textContent = n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 }) + (sym ? ' ' + sym : '');
        }).catch(function () {});
      });
    }).catch(function () {});
  }

  // ── bars: who is connected, copy, switch, disconnect ─────────────────
  function drawBars() {
    var bars = document.querySelectorAll('[data-wallet-bar]');
    if (!bars.length) return;
    style();
    var many = wallets().length > 1;
    [].forEach.call(bars, function (el) {
      var expect = el.getAttribute('data-wallet-expect') || '';
      var html = '';
      if (account) {
        var icon = active && active.info.icon;
        html = '<div class="wp-bar" role="group" aria-label="Connected wallet">' +
          '<span class="wp-bar__who" title="' + esc(account) + '">' + (icon ? '<img alt="" src="' + esc(icon) + '">' : '<span class="wp-bar__dot"></span>') +
          '<span class="wp-bar__lbl">' + esc(active ? active.info.name : 'Wallet') + '</span><b>' + esc(short(account)) + '</b></span>' +
          '<button type="button" data-wp-act="copy">Copy</button>' +
          '<button type="button" data-wp-act="switch">Switch account</button>' +
          (many ? '<button type="button" data-wp-act="wallet">Change wallet</button>' : '') +
          '<button type="button" data-wp-act="out">Disconnect</button>';
        if (expect) {
          html += lc(expect) === lc(account)
            ? '<p class="wp-bar__note is-ok">This is the owner wallet ' + esc(short(expect)) + '.</p>'
            : '<p class="wp-bar__note is-bad" role="alert">This is NOT the owner wallet. Expected ' + esc(expect) + '. Press Switch account and pick it before you sign anything.</p>';
        }
        html += '</div>';
      } else if (expect) {
        html = '<div class="wp-bar"><p class="wp-bar__note is-muted">Not connected. Connect with the owner wallet ' + esc(expect) + '.</p></div>';
      }
      if (el.__wpHtml === html) return;
      el.__wpHtml = html;
      el.innerHTML = html;
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-wp-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-wp-act');
    if (act === 'copy' && account) {
      var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(account).then(done, function () {});
    } else if (act === 'switch') {
      connect({ keepWallet: true }).catch(function () {});
    } else if (act === 'wallet') {
      connect({ pickWallet: true }).catch(function () {});
    } else if (act === 'out') {
      disconnect();
    }
  });

  // ── public API ───────────────────────────────────────────────────────
  window.WalletPicker = {
    get eth() { return wallets().length ? proxy : null; },
    get account() { return account; },
    get wallet() { return active ? active.info : null; },
    wallets: function () { return wallets().map(function (w) { return w.info; }); },
    connect: function (opts) { return connect(opts); },
    ensure: ensure,
    restore: restore,
    switchAccount: function () { return connect({ keepWallet: true }); },
    changeWallet: function () { return connect({ pickWallet: true }); },
    disconnect: disconnect,
    on: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    refresh: drawBars,
    short: short
  };

  ask();
  restore();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawBars);
  else drawBars();
})();
