/* QORPO measurement for qorpo.world and aneemate.com (one GA4 property, one web stream).
   qorpo.world loads it from assets/ui.js, aneemate.com from assets/footer.html.

   What it records (no wallet addresses, no personal data):
     download_game      click to the Epic Games Store (AneeMate)
     buy_qorpo          click to an exchange (MEXC, KuCoin, Gate, Uniswap, PancakeSwap) or the buy guide
     buy_packs          click that leads to the pack store (/open, /packs) from anywhere
     pack_buy_start     the buy dialog opens for a pack tier
     wallet_connect     a wallet approved the connection
     pack_quote         a price quote came back for a pack purchase
     purchase           a pack was paid on chain (value in USD, item = tier)
     pack_open          a real pack opening played (paid or free from points)
     pack_demo_open     someone opened a free demo pack on /open
     free_pack_claim    game points turned into a free pack
     account_link       a wallet was linked to a game account
     stake_tx / bridge_tx / claim_tx / spin   transactions and spins on qorpo.world
     go_aneemate        click from qorpo.world to aneemate.com
   Consent mode v2: nothing is stored until the visitor accepts (one choice per domain). */
(function () {
  if (window.__qtrack) return; window.__qtrack = 1;
  var ID = "G-3FC4S7B8EN", KEY = "q_consent";
  var host = location.hostname.replace(/^www\./, "");
  if (host !== "qorpo.world" && host !== "aneemate.com") return; // never on previews or localhost

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  gtag("consent", "default", {
    ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    analytics_storage: saved === "yes" ? "granted" : "denied", wait_for_update: 500
  });
  gtag("js", new Date());
  gtag("config", ID, { linker: { domains: ["qorpo.world", "aneemate.com"] } });
  var s = document.createElement("script"); s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID; document.head.appendChild(s);

  function path() { return location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/"; }
  function send(name, p) { p = p || {}; p.site = host; p.page_path = path(); try { gtag("event", name, p); } catch (e) {} }
  window.qtrack = send;
  var once = {};
  function sendOnce(k, name, p) { if (once[k]) return; once[k] = 1; send(name, p); }

  // ---- clicks: Epic, exchanges, pack store, AneeMate, pack tiers, demo packs
  var EX = { "mexc.com": "mexc", "kucoin.com": "kucoin", "gate.io": "gate", "gate.com": "gate", "pancakeswap.finance": "pancakeswap", "app.uniswap.org": "uniswap" };
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var b = t.closest("[data-buy]");
    if (b) return send("pack_buy_start", { tier: b.getAttribute("data-buy") });
    var pk = t.closest(".pick");
    if (pk && host === "aneemate.com" && !(window.AneeBuy && window.AneeBuy.state && window.AneeBuy.state.voucher)) {
      var cl = document.querySelector("#countLine");
      return send("pack_demo_open", { label: cl ? cl.textContent.trim().slice(0, 60) : "" });
    }
    var tr = t.closest("[data-track]");
    if (tr) return send(tr.getAttribute("data-track"), { label: (tr.textContent || "").trim().slice(0, 60) });
    var a = t.closest("a[href]"); if (!a) return;
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    var h = u.hostname.replace(/^www\./, ""), p = u.pathname.replace(/\.html$/, "").replace(/\/$/, "");
    var label = (a.textContent || "").trim().slice(0, 60);
    if (h === "store.epicgames.com" || h.slice(-14) === "epicgames.com") return send("download_game", { store: "epic", label: label });
    for (var k in EX) if (h === k || h.slice(-k.length - 1) === "." + k) return send("buy_qorpo", { exchange: EX[k], label: label });
    if ((h === "qorpo.world") && /^\/(how-to-buy-qorpo|token)$/.test(p) && /buy/i.test(label + u.hash)) return send("buy_qorpo", { exchange: "guide", label: label });
    if (h === "aneemate.com" && /^\/(open|packs)$/.test(p) && !(host === "aneemate.com" && path() === p)) return send("buy_packs", { step: p.slice(1), label: label });
    if (host === "qorpo.world" && h === "aneemate.com") return send("go_aneemate", { label: label });
  }, true);

  // ---- wallets: connections and transactions (both sites), without addresses
  function txName() {
    var p = path();
    if (/staking/.test(p)) return "stake_tx";
    if (/bridge/.test(p)) return "bridge_tx";
    if (/claim/.test(p)) return "claim_tx";
    if (/^\/(open|packs|mint|market)/.test(p)) return "pack_tx";
    return "wallet_tx";
  }
  function wrap(w, wallet) {
    if (!w || !w.request || w.__qwrapped) return; w.__qwrapped = 1;
    var orig = w.request.bind(w);
    w.request = function (args) {
      var m = args && args.method, r = orig(args);
      if (m === "eth_requestAccounts") r.then(function () { sendOnce("wc", "wallet_connect", { wallet: wallet }); }, function () {});
      if (m === "eth_sendTransaction") r.then(function () { send(txName(), { wallet: wallet }); }, function () {});
      return r;
    };
  }
  function wrapAll() {
    try { wrap(window.ethereum, window.ethereum && window.ethereum.isMetaMask ? "metamask" : "injected"); } catch (e) {}
    try { wrap(window.okxwallet, "okx"); } catch (e) {}
  }
  wrapAll(); window.addEventListener("ethereum#initialized", wrapAll); setTimeout(wrapAll, 1500);

  // ---- backend answers that mean progress (aneemate.com API), read from fetch
  if (window.fetch && host === "aneemate.com") {
    var of = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "", r = of.apply(this, arguments);
      try {
        var m = ((init && init.method) || "GET").toUpperCase();
        if (m === "POST" && /\/v1\/(packs|packs\/eth)\/quote/.test(url)) r.then(function (x) { if (x.ok) send("pack_quote", { chain: /\/eth\//.test(url) ? "eth" : "bsc" }); }, function () {});
        if (m === "POST" && /\/v1\/(game-points|game\/points)\/redeem/.test(url)) r.then(function (x) { if (x.ok) send("free_pack_claim", {}); }, function () {});
        if (m === "POST" && /\/v1\/link\/confirm/.test(url)) r.then(function (x) { if (x.ok) send("account_link", {}); }, function () {});
        if (m === "POST" && /\/v1\/nft\/creatures\/quote/.test(url)) r.then(function (x) { if (x.ok) send("mint_start", {}); }, function () {});
      } catch (e) {}
      return r;
    };
  }

  // ---- a paid pack (buy.js fires q:burn-added once per paid purchase)
  document.addEventListener("q:burn-added", function () {
    var st = (window.AneeBuy && window.AneeBuy.state) || {}, tk = window.ANEE_TOKENOMICS || { tiers: [] };
    var t = tk.tiers.filter(function (x) { return x.id === st.tier; })[0] || {}, qty = st.qty || 1, price = Number(t.priceUsd) || 0;
    send("purchase", { currency: "USD", value: price * qty, chain: st.chain || "bsc",
      items: [{ item_id: "pack_" + (st.tier || "unknown"), item_name: (t.name || st.tier || "Pack") + " pack", price: price, quantity: qty }] });
  });

  // ---- a real opening (paid, or free from points): wrap the player once it exists
  (function hookOpening(n) {
    var o = window.AneePackOpening;
    if (o && o.play && !o.__q) {
      o.__q = 1; var play = o.play;
      o.play = function (real) {
        var st = (window.AneeBuy && window.AneeBuy.state) || {};
        send("pack_open", { type: st.voucher ? "free" : "paid", tier: st.tier || "", rarity: real && real.rarity || "" });
        return play.apply(this, arguments);
      };
      return;
    }
    if (n < 40) setTimeout(function () { hookOpening(n + 1); }, 500);
  })(0);

  // ---- consent banner, shown once per domain
  if (saved) return;
  function banner() {
    var b = document.createElement("div");
    b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "Cookies");
    b.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;max-width:420px;z-index:2147483000;background:#14121c;color:#f2f0f7;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px 18px;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.4)";
    b.innerHTML = '<div style="margin-bottom:12px">We use analytics cookies to see which pages help players and holders. No ads. <a href="https://qorpo.world/privacy" style="color:#c9b6ff">Privacy</a></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-c="no" style="min-height:40px;padding:8px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font:inherit;cursor:pointer">Decline</button>' +
      '<button type="button" data-c="yes" style="min-height:40px;padding:8px 16px;border-radius:10px;border:0;background:#f2f0f7;color:#14121c;font:inherit;font-weight:700;cursor:pointer">Accept</button></div>';
    b.addEventListener("click", function (e) {
      var c = e.target.getAttribute && e.target.getAttribute("data-c"); if (!c) return;
      try { localStorage.setItem(KEY, c); } catch (x) {}
      if (c === "yes") gtag("consent", "update", { analytics_storage: "granted" });
      send("consent_choice", { choice: c });
      b.remove();
    });
    document.body.appendChild(b);
  }
  if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner);
})();
