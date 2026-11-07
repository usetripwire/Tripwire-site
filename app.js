/* Tripwire Quick Scan: runs entirely in the visitor's browser.
 * Data: Solana JSON-RPC (config.rpcUrl) + DexScreener public API.
 * All API text is rendered with textContent, never innerHTML. */
(function () {
  "use strict";

  var CFG = window.TRIPWIRE_CONFIG || {};
  var RPC = CFG.rpcUrl || "https://api.mainnet-beta.solana.com";
  var HANDLE = CFG.xHandle || "usetripwire";
  var SITE = (CFG.siteUrl || location.origin).replace(/\/$/, "");

  var TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  var TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  var API = (CFG.apiUrl || "").replace(/\/$/, "");
  var SYSTEM = "11111111111111111111111111111111";
  var BURN_OWNERS = { "1nc1nerator11111111111111111111111111111111": true };
  // Shared pool authorities that hold reserves (not real holders)
  var POOL_OWNERS = {
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": true, // Raydium AMM v4
    "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL": true, // Raydium CPMM
    "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh": true,  // Raydium LaunchLab
    "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC": true  // Meteora DAMM v2
  };
  var B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  // Thresholds (tune here)
  var T = {
    top10Pct: 30,        // top 10 non-pool holders own more than this % -> trip
    singlePct: 10,       // any single non-pool holder above this % -> trip
    minLiqUsd: 10000,    // pool liquidity below this -> trip
    sellUsd: 1000,       // test sell size for the exit estimate
    maxSlipPct: 10       // estimated slippage at sellUsd above this -> trip
  };

  /* ---------- tiny DOM helper ---------- */
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
    (kids || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  /* ---------- formatting ---------- */
  var usdC = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
  function usd(n) { return n == null || isNaN(n) ? "—" : usdC.format(n); }
  function price(n) {
    n = Number(n);
    if (!n || isNaN(n)) return "—";
    if (n >= 1) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    if (n >= 0.01) return "$" + n.toFixed(4);
    return "$" + n.toPrecision(3);
  }
  function pct(n, d) { return (n == null || isNaN(n)) ? "—" : n.toFixed(d == null ? 1 : d) + "%"; }
  function short(a) { return a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a; }
  function age(ms) {
    if (!ms) return "—";
    var m = Math.max(0, (Date.now() - ms) / 60000);
    if (m < 60) return Math.round(m) + " min";
    if (m < 2880) return Math.round(m / 60) + " h";
    return Math.round(m / 1440) + " days";
  }

  /* ---------- network ---------- */
  function withTimeout(ms) {
    var c = new AbortController();
    setTimeout(function () { c.abort(); }, ms);
    return c.signal;
  }
  function rpc(method, params) {
    return fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      signal: withTimeout(15000)
    }).then(function (r) {
      if (r.status === 429) throw new Error("rate_limited");
      if (!r.ok) throw new Error("rpc_http_" + r.status);
      return r.json();
    }).then(function (j) {
      if (j.error) throw new Error(j.error.message || "rpc_error");
      return j.result;
    });
  }
  function dex(mint) {
    return fetch("https://api.dexscreener.com/latest/dex/tokens/" + mint, { signal: withTimeout(15000) })
      .then(function (r) { if (!r.ok) throw new Error("dex_http_" + r.status); return r.json(); })
      .then(function (j) {
        return (j.pairs || []).filter(function (p) {
          return p.chainId === "solana" && p.baseToken && p.baseToken.address === mint;
        }).sort(function (a, b) {
          return ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0);
        });
      });
  }

  /* ---------- checks ---------- */
  function checkAuthority(mintAcc) {
    var info = mintAcc.data.parsed.info;
    var items = [], tripped = false;
    var BURN = "11111111111111111111111111111111";
    if (info.mintAuthority === BURN) items.push("Mint authority set to the system program (burned): supply is fixed.");
    else if (info.mintAuthority) { tripped = true; items.push("Mint authority is active: more supply can be created (" + short(info.mintAuthority) + ")."); }
    else items.push("Mint authority revoked: supply is fixed.");
    if (info.freezeAuthority === BURN) items.push("Freeze authority set to the system program (burned).");
    else if (info.freezeAuthority) { tripped = true; items.push("Freeze authority is active: holder wallets can be frozen (" + short(info.freezeAuthority) + ")."); }
    else items.push("Freeze authority revoked.");
    if (mintAcc.owner === TOKEN_2022) {
      (info.extensions || []).forEach(function (ext) {
        var s = ext.state || {};
        if (ext.extension === "transferFeeConfig") {
          var bps = ((s.newerTransferFee || {}).transferFeeBasisPoints) || ((s.olderTransferFee || {}).transferFeeBasisPoints) || 0;
          if (bps > 0) { tripped = true; items.push("Transfer fee of " + (bps / 100) + "% on every transfer."); }
        }
        if (ext.extension === "permanentDelegate" && s.delegate) { tripped = true; items.push("Permanent delegate set: one wallet can move or burn anyone's tokens."); }
        if (ext.extension === "transferHook" && s.programId) { tripped = true; items.push("Transfer hook set: custom code runs on every transfer."); }
        if (ext.extension === "pausableConfig" && s.authority) { tripped = true; items.push("Pausable: transfers can be paused."); }
      });
    }
    return { name: "Authority", tripped: tripped, items: items };
  }

  // kinds: owner -> "program" when the owner account belongs to a program (pool, locker, vault)
  function checkHolders(largest, owners, supplyRaw, poolSet, kinds) {
    var supply = Number(supplyRaw);
    if (!supply) return { name: "Holders", na: true, items: ["Supply is zero, so concentration can't be measured."] };
    kinds = kinds || {};
    var rows = largest.map(function (acc, i) {
      var owner = owners[i] || "";
      var share = Number(acc.amount) / supply * 100;
      var kind = poolSet[owner] || poolSet[acc.address] || POOL_OWNERS[owner] ? "Pool"
        : BURN_OWNERS[owner] ? "Burned"
        : kinds[owner] === "program" ? "Program" : "Holder";
      return { address: acc.address, owner: owner, share: share, kind: kind };
    });
    var sumKind = function (k) { return rows.filter(function (r) { return r.kind === k; }).reduce(function (s, r) { return s + r.share; }, 0); };
    var holders = rows.filter(function (r) { return r.kind === "Holder"; });
    var top10 = holders.slice(0, 10).reduce(function (s, r) { return s + r.share; }, 0);
    var top1 = holders.length ? holders[0].share : 0;
    var tripped = top10 > T.top10Pct || top1 > T.singlePct;
    var items = [
      "Top 10 wallets hold " + pct(top10) + " of supply (pools and programs excluded).",
      "Largest single wallet holds " + pct(top1) + "."
    ];
    if (sumKind("Pool") > 0) items.push(pct(sumKind("Pool")) + " of supply sits in trading pools.");
    if (sumKind("Program") > 0) items.push(pct(sumKind("Program")) + " is held by programs such as lockers or vaults.");
    return { name: "Holders", tripped: tripped, items: items, rows: rows };
  }

  function checkExit(pairs) {
    if (!pairs.length) return { name: "Exit", tripped: true, items: ["No trading pool found on DexScreener. You may not be able to sell."] };
    var p = pairs[0];
    var liq = (p.liquidity && p.liquidity.usd) || 0;
    if (!liq) {
      var where = p.dexId === "pumpfun" ? "the pump.fun bonding curve" : p.dexId ? "a " + p.dexId + " launch curve" : "a launch curve";
      return { name: "Exit", na: true, items: ["Still on " + where + ", which doesn't report pool liquidity, so sells go back into the curve. Pool depth is checked after it graduates."] };
    }
    // Constant-product estimate: the quote side is about half the pool's USD value.
    var q = liq / 2;
    var slip = q > 0 ? (T.sellUsd / (q + T.sellUsd)) * 100 : 100;
    var tripped = liq < T.minLiqUsd || slip > T.maxSlipPct;
    return {
      name: "Exit", tripped: tripped, items: [
        "Deepest pool: " + usd(liq) + " liquidity on " + (p.dexId || "a DEX") + ".",
        "Selling " + usd(T.sellUsd) + " would move the price " + (slip < 0.1 ? "less than 0.1%" : "about " + pct(slip)) + " (estimate)."
      ]
    };
  }

  /* ---------- rendering ---------- */
  var resultEl, btn, input, errEl;

  function setLoading(mint) {
    resultEl.setAttribute("aria-busy", "true");
    resultEl.replaceChildren(h("div", { class: "loading" }, [
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("span", { text: "Tripping the wires on " + short(mint) + "… A full scan reads the whole launch, so it can take a minute or two." })
    ]));
  }

  function renderError(msg) {
    resultEl.setAttribute("aria-busy", "false");
    resultEl.replaceChildren(h("div", { class: "placeholder" }, [
      h("p", { style: "margin:0;font-weight:600;color:var(--text)", text: "Scan didn't finish" }),
      h("p", { style: "margin:8px 0 0", text: msg })
    ]));
  }

  function copyBtn(text, label) {
    return h("button", {
      class: "copy", type: "button", "aria-label": label || "Copy", text: "Copy",
      onclick: function (e) {
        var b = e.currentTarget;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
          b.textContent = "Copied";
        }, function () { b.textContent = "Copy failed"; });
        setTimeout(function () { b.textContent = "Copy"; }, 1600);
      }
    });
  }

  function renderResult(mint, meta, checks, pair, full) {
    resultEl.setAttribute("aria-busy", "false");
    var ran = checks.filter(function (c) { return !c.na; });
    var trips = ran.filter(function (c) { return c.tripped; }).length;
    var verdict = trips
      ? h("span", { class: "pill trip", text: "TRIPPED · " + trips + " OF " + ran.length })
      : h("span", { class: "pill live", text: "CLEAR · " + ran.length + " OF " + ran.length });

    var img = meta.image ? h("img", { src: meta.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "ph", "aria-hidden": "true" });
    var head = h("div", { class: "r-head" }, [
      h("div", { class: "r-token" }, [img, h("div", { style: "min-width:0" }, [
        h("div", { class: "r-name", text: meta.name + (meta.symbol ? " ($" + meta.symbol + ")" : "") }),
        h("div", { class: "r-ca" }, [h("span", { text: short(mint) }), copyBtn(mint, "Copy contract address")])
      ])]),
      verdict
    ]);

    var body = h("div", { class: "r-body" }, checks.map(function (c) {
      var st = c.na ? h("span", { class: "status na", text: "UNAVAILABLE" })
        : c.tripped ? h("span", { class: "status trip", text: "TRIPPED" })
        : h("span", { class: "status clear", text: "CLEAR" });
      return h("div", { class: "check" }, [
        h("div", { class: "check-top" }, [h("span", { class: "check-name", text: c.name + " wire" }), st]),
        h("ul", null, c.items.map(function (t) { return h("li", { text: t }); }))
      ]);
    }));

    var kids = [head, body];

    var hc = checks.filter(function (c) { return c.rows; })[0];
    if (hc) {
      var d = h("details", { class: "holders" }, [h("summary", { text: "Top holders" })]);
      hc.rows.slice(0, 10).forEach(function (r) {
        d.appendChild(h("div", { class: "holder-row" }, [
          h("a", { href: "https://solscan.io/account/" + (r.owner || r.address), target: "_blank", rel: "noopener", text: short(r.owner || r.address) + (r.kind !== "Holder" ? " · " + r.kind : "") }),
          h("span", { text: pct(r.share, 2) })
        ]));
      });
      kids.push(d);
    }

    if (pair) {
      var tx = (pair.txns && pair.txns.h24) || {};
      var cells = [
        ["Price", price(pair.priceUsd)],
        ["Market cap", usd(pair.marketCap || pair.fdv)],
        ["Liquidity", usd(pair.liquidity && pair.liquidity.usd)],
        ["24h volume", usd(pair.volume && pair.volume.h24)],
        ["24h buys / sells", (tx.buys != null ? tx.buys : "—") + " / " + (tx.sells != null ? tx.sells : "—")],
        ["Pool age", age(pair.pairCreatedAt)]
      ];
      kids.push(h("dl", { class: "r-market" }, cells.map(function (c) {
        return h("div", null, [h("dt", { text: c[0] }), h("dd", { text: String(c[1]) })]);
      })));
    }

    var link = SITE + "/?ca=" + mint;
    var shareText = "Ran " + (meta.symbol ? "$" + meta.symbol : short(mint)) + " through @" + HANDLE + ": " +
      (trips ? trips + " of " + ran.length + " wires tripped." : "all " + ran.length + " wires clear.");
    kids.push(h("div", { class: "r-foot" }, [
      h("p", { text: full === "full"
        ? "Automated estimates from on-chain data. A clear result is not a guarantee."
        : full === "fallback"
          ? "Quick Scan only: the full scan service didn't answer, so only these checks ran. A clear result is not a guarantee."
          : "Quick Scan only: the full scan isn't connected, so only these checks ran. A clear result is not a guarantee." }),
      h("div", { class: "r-actions" }, [
        h("a", { class: "btn btn-primary btn-sm", target: "_blank", rel: "noopener", href: "https://x.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(link), text: "Share on X" }),
        pair && pair.url ? h("a", { class: "btn btn-ghost btn-sm", target: "_blank", rel: "noopener", href: pair.url, text: "Chart" }) : null,
        h("a", { class: "btn btn-ghost btn-sm", target: "_blank", rel: "noopener", href: "https://solscan.io/token/" + mint, text: "Solscan" })
      ])
    ]));

    resultEl.replaceChildren.apply(resultEl, kids);
  }

  /* ---------- main scan ---------- */
  var busy = false;
  function scan(mint) {
    if (busy) return;
    errEl.textContent = "";
    mint = (mint || "").trim();
    if (!B58.test(mint)) {
      errEl.textContent = "That doesn't look like a Solana address. Paste the token's contract address (mint).";
      input.focus();
      return;
    }
    busy = true; btn.disabled = true; btn.textContent = "Scanning…";
    setLoading(mint);
    try { history.replaceState(null, "", "?ca=" + mint + location.hash); } catch (e) {}

    var run = API
      ? fullScan(mint).catch(function (e) { if (e && e.final) throw e; return quickScan(mint, "fallback"); })
      : quickScan(mint, "quick");
    run.catch(function (e) {
      renderError(e && e.message && !/^(rpc|dex|api)_/.test(e.message) ? e.message : "Something went wrong while scanning. Try again in a moment.");
    }).then(function () {
      busy = false; btn.disabled = false; btn.textContent = "Trip it";
    });
  }

  // Full eight-wire scan from the Tripwire server (config.apiUrl)
  function fullScan(mint) {
    return fetch(API + "/api/scan?ca=" + encodeURIComponent(mint), { signal: withTimeout(180000) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 400 || r.status === 422) { var e = new Error(j.message || "That address isn't a token mint."); e.final = true; throw e; }
        if (!r.ok || !j.checks) throw new Error("api_" + r.status);
        renderResult(mint, j.token || { name: "Unknown token", symbol: "" }, j.checks, j.pair, "full");
      });
    });
  }

  // Three-wire scan straight from the browser
  function quickScan(mint, mode) {
    var mintP = rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
    var dexP = dex(mint);
    var largestP = rpc("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);

    return Promise.allSettled([mintP, dexP, largestP]).then(function (res) {
      var mintR = res[0], dexR = res[1], largestR = res[2];
      if (mintR.status === "rejected") {
        throw new Error(mintR.reason && mintR.reason.message === "rate_limited"
          ? "The Solana RPC is rate limiting requests. Wait a few seconds and try again."
          : "Couldn't reach the Solana network. Check your connection and try again.");
      }
      var acc = mintR.value && mintR.value.value;
      if (!acc) throw new Error("No account exists at that address on Solana mainnet.");
      var parsed = acc.data && acc.data.parsed;
      if (!(acc.owner === TOKEN_PROGRAM || acc.owner === TOKEN_2022) || !parsed || parsed.type !== "mint") {
        throw new Error("That address isn't a token mint. Paste the token's contract address, not a wallet or pool.");
      }

      var pairs = dexR.status === "fulfilled" ? dexR.value : null;
      var poolSet = {};
      (pairs || []).forEach(function (p) { if (p.pairAddress) poolSet[p.pairAddress] = true; });

      var checks = [checkAuthority(acc)];

      var holdersP;
      if (largestR.status === "fulfilled" && largestR.value && largestR.value.value) {
        var largest = largestR.value.value;
        holdersP = rpc("getMultipleAccounts", [largest.map(function (a) { return a.address; }), { encoding: "jsonParsed" }])
          .then(function (m) {
            var owners = (m.value || []).map(function (a) { return a && a.data && a.data.parsed ? a.data.parsed.info.owner : ""; });
            var uniq = owners.filter(function (o, i) { return o && owners.indexOf(o) === i; });
            return rpc("getMultipleAccounts", [uniq, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]).then(function (oa) {
              var kinds = {};
              uniq.forEach(function (o, i) {
                var a = oa && oa.value ? oa.value[i] : null;
                kinds[o] = a && a.owner && a.owner !== SYSTEM ? "program" : "wallet";
              });
              return checkHolders(largest, owners, parsed.info.supply, poolSet, kinds);
            }, function () {
              return checkHolders(largest, owners, parsed.info.supply, poolSet);
            });
          }, function () {
            return checkHolders(largest, [], parsed.info.supply, poolSet);
          });
      } else {
        holdersP = Promise.resolve({ name: "Holders", na: true, items: ["The RPC refused the holder lookup (common on the free public endpoint). Try again in a moment."] });
      }

      return holdersP.then(function (hc) {
        checks.push(hc);
        if (pairs) checks.push(checkExit(pairs));
        else checks.push({ name: "Exit", na: true, items: ["DexScreener didn't respond, so pool depth couldn't be checked."] });
        var p0 = pairs && pairs[0];
        var meta = {
          name: (p0 && p0.baseToken.name) || "Unknown token",
          symbol: (p0 && p0.baseToken.symbol) || "",
          image: p0 && p0.info && /^https:\/\//.test(p0.info.imageUrl || "") ? p0.info.imageUrl : ""
        };
        renderResult(mint, meta, checks, p0, mode);
      });
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    // X links + CA from config
    document.querySelectorAll("[data-x-link]").forEach(function (a) { a.href = "https://x.com/" + HANDLE; });
    var foot = document.getElementById("foot-ca");
    if (foot && CFG.tokenCA) {
      foot.replaceChildren(document.createTextNode("$TRIP CA: "), h("span", { text: CFG.tokenCA }), document.createTextNode(" "), copyBtn(CFG.tokenCA, "Copy $TRIP contract address"));
    }

    // status labels follow what is actually connected
    var livePill = function (p, label) { p.className = "pill live"; p.replaceChildren(h("span", { class: "dot" }), document.createTextNode(label)); };
    if (API) {
      var note = document.getElementById("ca-note");
      if (note) note.textContent = "Free and no wallet needed. Scans read public on-chain and DEX data and usually take under a minute.";
      document.querySelectorAll("[data-full-pill]").forEach(function (p) { livePill(p, "Live now"); });
      var ph = document.querySelector("#result .placeholder");
      if (ph) ph.replaceChildren(
        h("p", { style: "margin:0;font-weight:600;color:var(--text)", text: "Eight wires, one read" }),
        h("p", { style: "margin:8px 0 0", text: "Paste a Solana token address to check bundles, snipers, dev history, agents, wash volume, exit liquidity, authority and holders." })
      );
    }

    // mobile menu
    var mb = document.querySelector(".menu-btn"), nl = document.getElementById("nav-links");
    if (mb && nl) {
      mb.addEventListener("click", function () {
        var open = nl.classList.toggle("open");
        mb.setAttribute("aria-expanded", open ? "true" : "false");
        mb.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      });
      nl.addEventListener("click", function (e) {
        if (e.target.closest("a")) { nl.classList.remove("open"); mb.setAttribute("aria-expanded", "false"); }
      });
    }

    resultEl = document.getElementById("result");
    btn = document.getElementById("scan-btn");
    input = document.getElementById("ca");
    errEl = document.getElementById("ca-error");
    var form = document.getElementById("scan-form");
    if (!form) return;
    form.addEventListener("submit", function (e) { e.preventDefault(); scan(input.value); });
    input.addEventListener("paste", function () {
      setTimeout(function () { if (B58.test(input.value.trim())) scan(input.value); }, 0);
    });
    // let other scripts (Radar) open a full scan
    window.tripwireScan = function (mint) {
      input.value = mint;
      var top = document.getElementById("scan");
      if (top) top.scrollIntoView({ behavior: "smooth" });
      scan(mint);
    };
    var q = new URLSearchParams(location.search).get("ca");
    if (q) { input.value = q; scan(q); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
