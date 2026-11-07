/* Tripwire Radar: the holder feed.
 * Wallet sign-in signs a free text message (no transaction). The server checks
 * the wallet's $TRIP balance and returns a 24-hour session kept in this browser.
 * All feed text is rendered with textContent, never innerHTML. */
(function () {
  "use strict";
  var CFG = window.TRIPWIRE_CONFIG || {};
  var API = (CFG.apiUrl || "").replace(/\/$/, "");
  var KEY = "tw_radar_session";
  var session = null, lastFeed = null, timer = null, lastMode = null;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  var $ = function (id) { return document.getElementById(id); };
  var usdC = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  var usd = function (n) { return n == null || isNaN(n) ? "—" : usdC.format(n); };
  var num = function (n) { return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 }); };
  var short = function (a) { return a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a || ""; };
  function ago(ms) {
    var m = Math.max(0, (Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return Math.round(m) + " min ago";
    if (m < 1440) return Math.round(m / 60) + " h ago";
    return Math.round(m / 1440) + " d ago";
  }

  /* ---------- session storage (per browser) ---------- */
  function loadSession() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.exp > Date.now()) return s; } catch (e) {}
    return null;
  }
  function saveSession(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) {} }

  /* ---------- wallet ---------- */
  function provider() {
    var w = window;
    return (w.phantom && w.phantom.solana) || w.solflare || (w.backpack && w.backpack.solana) || w.solana || null;
  }
  var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  function b64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function signIn() {
    var p = provider();
    var btn = $("radar-connect");
    if (!p) return renderNoWallet();
    if (btn) { btn.disabled = true; btn.textContent = "Check your wallet…"; }
    var wallet;
    Promise.resolve(p.connect ? p.connect() : null).then(function (res) {
      var pk = (res && res.publicKey) || p.publicKey;
      if (!pk) throw new Error("No wallet address was shared.");
      wallet = pk.toString();
      return fetch(API + "/api/radar/nonce?wallet=" + encodeURIComponent(wallet)).then(function (r) { return r.json(); });
    }).then(function (n) {
      if (!n.message) throw new Error(n.message || "Couldn't start sign-in.");
      var bytes = new TextEncoder().encode(n.message);
      return Promise.resolve(p.signMessage(bytes, "utf8")).then(function (out) {
        var sig = out && out.signature ? out.signature : out;
        return fetch(API + "/api/radar/session", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: wallet, nonce: n.nonce, signature: b64(new Uint8Array(sig)) })
        });
      });
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || "Sign-in failed."); return j; });
    }).then(function (j) {
      session = { token: j.token, wallet: j.wallet, exp: j.exp };
      saveSession(session);
      refresh();
    }).catch(function (e) {
      var msg = e && e.message ? e.message : "Sign-in was cancelled.";
      if (/reject|cancel|denied|declined/i.test(msg)) msg = "Sign-in was cancelled in your wallet.";
      setGate("Couldn't sign in", msg, [connectButton()]);
    });
  }

  function signOut() {
    session = null; saveSession(null);
    try { var p = provider(); if (p && p.disconnect) p.disconnect(); } catch (e) {}
    refresh();
  }

  /* ---------- gate box ---------- */
  function connectButton(label) {
    return h("button", { class: "btn btn-primary btn-sm", id: "radar-connect", type: "button", text: label || "Connect wallet", onclick: signIn });
  }
  function setGate(title, sub, actions, live) {
    $("radar-gate-title").textContent = title;
    $("radar-gate-sub").textContent = sub;
    $("radar-gate-actions").replaceChildren.apply($("radar-gate-actions"), actions || []);
    $("radar-gate").classList.toggle("live", !!live);
  }
  function renderNoWallet() {
    var here = location.href.split("#")[0];
    if (isMobile) {
      setGate("Open in your wallet app", "Mobile browsers can't talk to wallets directly. Open this page inside Phantom or Solflare to sign in.", [
        h("a", { class: "btn btn-primary btn-sm", href: "https://phantom.app/ul/browse/" + encodeURIComponent(here) + "?ref=" + encodeURIComponent(location.origin), text: "Open in Phantom" }),
        h("a", { class: "btn btn-ghost btn-sm", href: "https://solflare.com/ul/v1/browse/" + encodeURIComponent(here) + "?ref=" + encodeURIComponent(location.origin), text: "Open in Solflare" })
      ]);
    } else {
      setGate("No Solana wallet found", "Install a wallet such as Phantom, Solflare or Backpack, then reload this page.", [
        h("a", { class: "btn btn-primary btn-sm", href: "https://phantom.app/download", target: "_blank", rel: "noopener", text: "Get Phantom" })
      ]);
    }
  }

  function renderGate(g, mode) {
    var min = num(g.minHold || 100000);
    var pill = $("radar-pill");
    if (pill) {
      if (mode === "live") { pill.className = "pill live"; pill.replaceChildren(h("span", { class: "dot" }), document.createTextNode("Live")); }
      else if (g.tokenLive) { pill.className = "pill soon"; pill.textContent = "Holders: " + min + " $TRIP"; }
      else { pill.className = "pill soon"; pill.textContent = "Opens at $TRIP launch"; }
    }
    var out = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Disconnect", onclick: signOut });
    if (g.signedIn && g.holder) {
      setGate("Live feed unlocked", short(g.wallet) + (g.tester ? " · tester access" : " · " + num(g.balance) + " $TRIP"), [out], true);
    } else if (g.signedIn) {
      setGate("Not enough $TRIP yet",
        g.tokenLive ? short(g.wallet) + " holds " + num(g.balance) + " $TRIP. Real-time Radar needs " + min + "." : "Real-time access opens when $TRIP launches. You're seeing the preview.",
        [out]);
    } else {
      setGate("Preview mode",
        g.tokenLive ? "Connect a wallet holding " + min + " $TRIP to unlock the live feed." : "Real-time access opens to holders of " + min + " $TRIP at launch. Until then, everyone sees the preview.",
        [connectButton()]);
    }
  }

  /* ---------- feed ---------- */
  function chip(w) {
    var cls = w.na ? "wire-chip" : w.tripped ? "wire-chip trip" : "wire-chip clear";
    var label = { bundle: "Bundle", sniper: "Sniper", dev: "Dev", agent: "Agent", wash: "Wash", exit: "Exit", authority: "Authority", holders: "Holders" }[w.key] || w.name;
    return h("span", { class: cls, title: w.brief || "", text: (w.na ? "– " : w.tripped ? "✕ " : "✓ ") + label });
  }
  function item(e) {
    var img = e.image && /^https:\/\//.test(e.image) ? h("img", { src: e.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "ph", "aria-hidden": "true" });
    var verdict = e.clean ? h("span", { class: "pill live", text: "CLEAR · " + e.ran + " OF " + e.ran }) : h("span", { class: "pill trip", text: "TRIPPED · " + e.trips + " OF " + e.ran });
    return h("article", { class: "radar-item" }, [
      h("div", { class: "radar-top" }, [
        img,
        h("div", { class: "radar-name" }, [h("b", { text: (e.name || "Unknown") + (e.symbol ? " ($" + e.symbol + ")" : "") }), h("span", { text: short(e.mint) + " · scanned " + ago(e.scannedAt) })]),
        verdict
      ]),
      h("div", { class: "radar-wires" }, (e.wires || []).map(chip)),
      h("div", { class: "radar-meta" }, [
        h("span", null, ["Liquidity ", h("strong", { text: usd(e.liquidity) })]),
        h("span", null, ["Market cap ", h("strong", { text: usd(e.marketCap) })]),
        h("div", { class: "radar-actions" }, [
          h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Full scan", onclick: function () { if (window.tripwireScan) window.tripwireScan(e.mint); } }),
          e.url ? h("a", { class: "btn btn-ghost btn-sm", href: e.url, target: "_blank", rel: "noopener", text: "Chart" }) : null
        ])
      ])
    ]);
  }

  function renderFeed() {
    var f = lastFeed, box = $("radar-feed");
    if (!f) return;
    var live = f.mode === "live";
    var cleanBox = $("radar-clean"), label = cleanBox && cleanBox.parentNode;
    if (cleanBox) {
      cleanBox.disabled = !live;
      if (!live) cleanBox.checked = true;
      else if (lastMode !== "live") cleanBox.checked = false; // holders start with everything shown
    }
    lastMode = f.mode;
    if (label) label.classList.toggle("disabled", !live);
    var entries = (f.entries || []).filter(function (e) { return !(cleanBox && cleanBox.checked) || e.clean; });
    var kids = entries.map(item);
    if (!kids.length) {
      kids.push(h("p", { class: "radar-empty", text: live
        ? "Radar is listening. New pump.fun graduations show up here a few minutes after they launch."
        : "No clean results in the preview window yet. Check back soon." }));
    }
    if (!live && f.lockedCount > 0) {
      kids.push(h("div", { class: "radar-lock" }, [
        h("p", { text: num(f.lockedCount) + " more result" + (f.lockedCount === 1 ? " is" : "s are") + " in the live feed." }),
        h("span", { class: "dim", text: "Holders of " + num(f.gate && f.gate.minHold || 100000) + " $TRIP see them as they land." })
      ]));
    }
    box.replaceChildren.apply(box, kids);
    $("radar-updated").textContent = live ? "Live · updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Preview · " + (f.delayMinutes || 15) + " min delay";
  }

  function refresh() {
    if (!API) {
      $("radar-feed").replaceChildren(h("p", { class: "radar-empty", text: "Radar is offline right now." }));
      return;
    }
    var headers = session ? { authorization: "Bearer " + session.token } : {};
    fetch(API + "/api/radar/feed", { headers: headers }).then(function (r) { return r.json(); }).then(function (f) {
      if (!f || !f.gate || !Array.isArray(f.entries)) throw new Error("bad feed");
      if (session && !f.gate.signedIn) { session = null; saveSession(null); }
      lastFeed = f;
      renderGate(f.gate, f.mode);
      renderFeed();
    }).catch(function () {
      if (!lastFeed) $("radar-feed").replaceChildren(h("p", { class: "radar-empty", text: "Radar couldn't load. It will retry in a moment." }));
    });
  }

  function boot() {
    if (!$("radar")) return;
    session = loadSession();
    var c = $("radar-connect");
    if (c) c.addEventListener("click", signIn);
    var cb = $("radar-clean");
    if (cb) cb.addEventListener("change", renderFeed);
    refresh();
    timer = setInterval(function () { if (document.visibilityState !== "hidden") refresh(); }, 20000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
