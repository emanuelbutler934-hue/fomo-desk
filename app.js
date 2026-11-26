/* Desk · STEP 10 app. Static PWA.
   Plan B (GitHub Pages): reads the JSON the desk publishes under d/{DATA_PATH}/. DATA_PATH arrives ONCE as #d=... and
   lives in localStorage only. Local (served by api.py on 127.0.0.1 at /app/): calls /api/* with APP_TOKEN from #t=...
   No secret is ever in this file. Every FOMO link shown here comes from the data (links.py on the desk). */
(function () {
  "use strict";
  const LS = window.localStorage;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const POLL_S = 15;            // Plan B data is published every 60s; the app looks every 15s
  const STALE_S = 600;          // published state older than this = the desk is offline
  const MINT_RX = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;
  const KEY_RX = /^[A-Za-z0-9_-]{24,200}$/;
  const BOT_TITLE = { scanner: "Scanner", analyst: "Analyst", brain: "Brain", executor: "Executor", risk: "Risk" };
  const BOT_COLOR = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  const BOTS = ["scanner", "analyst", "brain", "executor", "risk"];
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];

  // ---------- the one-time keys from the URL fragment ----------
  (function takeKeys() {
    const h = location.hash.replace(/^#/, "");
    if (!/(^|&)(d|t)=/.test(h)) return;
    const p = new URLSearchParams(h);
    const d = p.get("d"), t = p.get("t");
    if (d && KEY_RX.test(d)) LS.setItem("desk.d", d);
    if (t && KEY_RX.test(t)) LS.setItem("desk.t", t);
    history.replaceState(null, "", location.pathname + location.search + "#/home");   // the key leaves the address bar
  })();
  const API = /^\/app(\/|$)/.test(location.pathname) && ["127.0.0.1", "localhost"].includes(location.hostname);
  const hasKey = () => !!(API ? LS.getItem("desk.t") : LS.getItem("desk.d"));

  // ---------- data ----------
  async function http(url, opts) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; try { e.body = await r.json(); } catch (_) {} throw e; }
    return r;
  }
  const authH = () => ({ Authorization: "Bearer " + (LS.getItem("desk.t") || "") });
  const api = async (path, opts) => (await http(path, Object.assign({ headers: authH() }, opts || {}))).json();
  const stat = async file => {
    const d = LS.getItem("desk.d");
    if (!d) { const e = new Error("no data link"); e.status = 0; throw e; }
    return (await http("d/" + encodeURIComponent(d) + "/" + file + "?_=" + Date.now())).json();
  };
  const enc = encodeURIComponent;
  const src = {
    state: () => API ? api("/api/state") : stat("state.json"),
    chartAll: () => API ? Promise.all(RANGES.map(r => api("/api/chart?range=" + r))).then(a => ({ ranges: Object.fromEntries(a.map(c => [c.range, c])) }))
                        : stat("chart.json"),
    chart: r => API ? api("/api/chart?range=" + r) : stat("chart.json").then(c => c.ranges[r]),
    activity: cur => API ? api("/api/activity" + (cur ? "?before=" + enc(cur) : "")) : stat(cur || "activity.json"),
    orders: () => API ? api("/api/orders") : stat("orders.json"),
    account: () => API ? api("/api/account") : stat("account.json"),
    coin: m => API ? api("/api/coin/" + enc(m)) : stat("coin/" + enc(m) + ".json"),
    audit: m => API ? api("/api/audit/" + enc(m)) : stat("audit/" + enc(m) + ".json"),
    bot: async n => {
      if (!API) return stat("bots/" + n + ".json");
      const [st, d] = await Promise.all([api("/api/state"), api("/api/bots/" + n + "/decisions")]);
      return { card: st.bots.find(b => b.name === n), decisions: d.decisions };
    },
  };
  const nextCursor = page => API ? page.next : page.nextFile;

  // ---------- state ----------
  const S = { state: null, chart: null, activity: null, orders: null, account: null, bots: {}, err: null, errAt: 0,
              nextTry: 0, range: RANGES.includes(LS.getItem("desk.range")) ? LS.getItem("desk.range") : "LIVE",
              known: new Map(), pollN: 0, frameUrl: null, frameTs: null, polling: false };

  function remember(rows) {
    (rows || []).forEach(r => { if (r && r.mint && MINT_RX.test(r.mint) && !S.known.has(r.mint))
      S.known.set(r.mint, { mint: r.mint, symbol: r.symbol, name: r.name, link: r.link }); });
  }

  async function poll() {
    if (S.polling) return;
    S.polling = true;
    try {
      if (!hasKey()) throw Object.assign(new Error("no key"), { status: 0, nokey: true });
      const st = await src.state();
      const [ch, act, ord] = await Promise.all([src.chartAll().catch(() => null), src.activity().catch(() => null),
                                                src.orders().catch(() => null)]);
      S.state = st; if (ch) S.chart = ch; if (act) S.activity = act; if (ord) S.orders = ord;
      remember(st.positions); (st.bots || []).forEach(b => { remember(b.feed); remember(b.waiting); if (b.last) remember([b.last]); });
      if (act) remember(act.rows); if (ord) remember(ord.rows);
      const age = Date.now() / 1000 - st.ts;
      S.err = (!API && age > STALE_S) ? "stale" : null;
      if (!S.account || (++S.pollN % 4) === 0) src.account().then(a => { S.account = a; if (route().name === "account") renderAccount(); }).catch(() => {});
    } catch (e) {
      S.err = e.nokey ? "nokey" : (e.status === 401 ? "auth" : "offline");
    } finally {
      S.polling = false; S.nextTry = Date.now() + POLL_S * 1000;
      update();
    }
  }

  // ---------- formatting ----------
  const money = (x, dp) => x == null ? "" : (x < 0 ? "-" : "") + "$" + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
  const short = x => x == null ? null : x >= 1e9 ? "$" + (x / 1e9).toFixed(2) + "B" : x >= 1e6 ? "$" + (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? "$" + (x / 1e3).toFixed(1) + "K" : "$" + x.toFixed(0);
  const pct = x => x == null ? "" : (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
  const price = p => { if (p == null) return null; if (p >= 1) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 4 });
    const d = Math.min(12, 3 - Math.floor(Math.log10(p))); return "$" + p.toFixed(d); };
  const hhmm = ts => ts == null ? "—" : new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const age = h => h == null ? null : h >= 1 ? Math.round(h) + "h old" : Math.max(1, Math.round(h * 60)) + "m old";
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  // ---------- icons ----------
  const I = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    dash: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    bought: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    sold: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    stopped: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    rejected: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  const fomoA = (link, text) => link ? `<a class="fomo" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-stop>${esc(text || "Open on FOMO")}</a>` : "";

  // ---------- shared bits ----------
  function errRow() { return `<div id="errrow" class="errrow"></div>`; }
  function errText() {
    if (!S.err) return "";
    if (S.err === "nokey") return "No data link on this device · open your personal link once";
    if (S.err === "auth") return "Desk offline · token refused (401) · open your local link again";
    const n = Math.max(0, Math.ceil((S.nextTry - Date.now()) / 1000));
    return `Desk offline · retrying in ${n}s · last update ${S.state ? hhmm(S.state.ts) : "—"}`;
  }
  function paintErr() { const e = $("#errrow"); if (!e) return; const t = errText(); e.textContent = t; e.classList.toggle("on", !!t); }
  const sk = (w, h, extra) => `<div class="sk" style="width:${w};height:${h}px;${extra || ""}"></div>`;

  // odometer: changed digits roll 600ms ease-out, 30ms stagger; reduced motion: values swap
  function odo(el, text) {
    const old = el.dataset.v;
    if (old === text) return;
    el.dataset.v = text;
    const build = () => { el.innerHTML = `<span class="odo">${[...text].map(ch => /\d/.test(ch)
      ? `<span class="col"><span class="strip" style="transform:translateY(${-ch * 1.05}em)">${"0123456789".split("").map(d => `<span>${d}</span>`).join("")}</span></span>`
      : `<span class="ch">${esc(ch)}</span>`).join("")}</span>`; };
    if (!old || old.length !== text.length || reduced()) return build();
    const cols = $$(".odo > *", el);
    let k = 0;
    [...text].forEach((ch, i) => {
      if (ch === old[i]) return;
      const strip = cols[i] && cols[i].querySelector(".strip");
      if (!strip || !/\d/.test(ch)) { build(); k = -1; return; }
      if (k < 0) return;
      strip.style.transitionDelay = (k++ * 30) + "ms";
      strip.style.transform = `translateY(${-ch * 1.05}em)`;
    });
  }

  function actRow(r) {
    const v = r.value || "", cls = r.kind === "rejected" ? "skip" : v.startsWith("+") ? "pos" : v.startsWith("-") ? "neg" : "";
    const go = r.mint ? (r.tap === "audit" ? "#/audit/" : "#/coin/") + enc(r.mint) : "";
    return `<div class="row" ${go ? `data-go="${go}"` : ""}><div class="ic ${esc(r.kind)}">${I[r.kind] || ""}</div>
      <div class="rmain"><div class="rt">${esc(r.title)}</div><div class="rs">${esc(r.subtitle)}</div>${fomoA(r.link)}</div>
      <div class="rv ${cls}">${esc(v)}</div></div>`;
  }

  function checksHTML(c) {
    const one = (v, name) => `<span class="chk ${v === true ? "ok" : v === false ? "bad" : "na"}" title="${name}">${v === true ? I.check : v === false ? I.cross : I.dash}</span>`;
    return `<span class="checks">${one(c.screen, "screen")}${one(c.api, "api")}${one(c.chain, "chain")}</span>`;
  }

  function botBody(c) {
    if (!c) return sk("100%", 90);
    if (c.name === "scanner") {
      const feed = (c.feed || []).slice(0, 4);
      return `<div class="btitle" style="color:${c.color}">${esc(c.title)}</div><div class="feed">${feed.length ? feed.map(f =>
        `<div class="fr ${f.verdict === "pass" ? "pass" : "kill"}"><span class="s">${esc(f.symbol)}</span><span class="r">${f.verdict === "pass" ? "→ Analyst" : esc(f.reason || "killed")}</span></div>`).join("")
        : '<div class="small muted">No pools yet tonight</div>'}</div>`;
    }
    if (c.name === "analyst") {
      const l = c.last;
      return `<div class="btitle" style="color:${c.color}">${esc(c.title)}</div>` + (l ? `<div class="row-flex">
        <div class="strips">${(l.layers || []).concat(Array(8).fill(null)).slice(0, 8).map(x => `<i class="${x === true ? "ok" : x === false ? "bad" : ""}"></i>`).join("")}</div>
        ${DeskCharts.ring(l.score)}</div><div class="small" style="margin-top:8px"><b>${esc(l.symbol)}</b> <span class="muted">· ${esc(l.social)}</span></div>`
        : '<div class="small muted">Nothing taken apart yet</div>');
    }
    if (c.name === "brain") {
      return `<div class="btitle" style="color:${c.color}">${esc(c.title)}</div>` +
        (c.last ? `<div style="font-size:20px;font-weight:600">${esc(c.last.text)}</div><div class="small muted">${esc(c.last.symbol || "")}</div>` : '<div class="small muted">Nothing sized yet</div>') +
        `<div class="small muted" style="margin-top:6px">${esc(c.hint || "")}</div>`;
    }
    if (c.name === "executor") return `<div class="btitle" style="color:${c.color}">${esc(c.title)}</div><div class="bar">${esc(c.bar || "Idle")}</div>`;
    if (c.name === "risk") return `<div class="btitle" style="color:${c.color}">${esc(c.title)}</div><div style="display:flex;gap:6px;flex-wrap:wrap">${(c.pills || []).map(p =>
      `<span class="mpill ${p.color === "green" ? "green" : "red"}">${esc(p.text)}</span>`).join("")}</div>`;
    return "";
  }
  const statusDot = c => `<span class="dot" style="background:${c.status === "ok" ? "var(--green)" : c.status === "paused" ? "var(--orange)" : "var(--red)"}"></span>`;

  // ---------- router ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, arg] = h.split("/");
    return { name: ["home", "bots", "activity", "account", "coin", "audit"].includes(name) ? name : "home", arg: arg ? decodeURIComponent(arg) : null };
  }
  let current = null;
  function go() {
    const r = route();
    closeSheet();
    $$(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === (r.name === "coin" || r.name === "audit" ? "" : r.name)));
    current = r.name + ":" + (r.arg || "");
    window.scrollTo(0, 0);
    ({ home: renderHome, bots: renderBots, activity: renderActivity, account: renderAccount, coin: renderCoin, audit: renderAudit }[r.name])(r.arg);
  }
  function update() {
    const r = route();
    paintErr();
    if (r.name === "home") updateHome();
    else if (r.name === "bots") updateBots();
    else if (r.name === "activity") updateActivity();
    else if (r.name === "account" && !S.account) src.account().then(a => { S.account = a; renderAccount(); }).catch(() => {});
    bellDot();
  }

  // ---------- HOME ----------
  let chart = null;
  function renderHome() {
    $("#view").innerHTML = `
      <header class="navbar"><a href="#/account" class="iconbtn" aria-label="Account"><span class="avatar">D</span></a>
        <a href="#/account" class="title">Grok Bot <span class="chev">›</span></a>
        <button class="iconbtn" id="btn-search" aria-label="Search">${I.search}</button>
        <a class="iconbtn" href="#/activity" aria-label="Activity">${I.bell}<span class="bell-dot" id="belldot" hidden></span></a></header>
      ${errRow()}
      <section class="bal"><div class="bal-line"><div id="balnum" class="bal-num">${sk("210px", 72)}</div><span id="paperpill"></span></div>
        <div class="sub-line" id="today">${sk("150px", 22, "margin-top:8px")}</div></section>
      <div class="chart-wrap" id="chartwrap"><canvas id="chart"></canvas><div class="chart-empty" id="chartempty" hidden>Waiting for the first trade</div><div id="chartsk" style="position:absolute;inset:0 16px">${sk("100%", 210)}</div></div>
      <div class="ranges" id="ranges">${RANGES.map(r => `<button data-range="${r}" class="${r === S.range ? "on" : ""}"><span>${r}</span></button>`).join("")}</div>
      <div class="screen" id="screen"><img alt="" id="f0"><img alt="" id="f1"><div class="empty" id="screenempty"></div>
        <div class="tl" id="screentl"></div><div class="tr" id="screentr"></div></div>
      <div class="lastorder" id="lastorder">${sk("70%", 18)}</div>
      <div class="sh"><h2 id="botshead">Bots</h2></div>
      <div class="carousel" id="carousel">${BOTS.map(() => `<div class="bcard">${sk("50%", 18)}<div style="height:12px"></div>${sk("100%", 90)}</div>`).join("")}</div>
      <div class="sh"><h2>Activity</h2><a href="#/activity">See all</a></div>
      <div id="homeact">${[0, 1, 2].map(() => sk("100%", 60, "margin-bottom:6px")).join("")}</div>`;
    chart = new DeskCharts.LineChart($("#chart"));
    $("#btn-search").onclick = openSearch;
    $("#ranges").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.range = b.dataset.range; LS.setItem("desk.range", S.range);
      $$("#ranges button").forEach(x => x.classList.toggle("on", x === b)); drawChart(true); };
    $("#screen").onclick = openFullscreen;
    $("#homeact").dataset.sig = ""; $("#carousel").dataset.sig = "";
    updateHome();
  }
  function drawChart(force) {
    if (!chart || !S.chart || !S.chart.ranges) return;
    const c = S.chart.ranges[S.range];
    if (!c) return;
    $("#chartsk") && ($("#chartsk").style.display = "none");
    chart.set(c, force ? S.range + Math.random() : S.range);
  }
  function updateHome() {
    if (route().name !== "home" || !$("#balnum")) return;
    paintErr();
    const st = S.state;
    if (!st) return;      // still loading: skeleton stays
    if (!$("#balnum .odo")) $("#balnum").innerHTML = "";
    const bt = money(st.balance);
    $("#balnum").classList.toggle("long", bt.length > 8);
    odo($("#balnum"), bt);
    $("#paperpill").innerHTML = st.paper ? '<span class="pill paper">PAPER</span>' : "";
    const neg = st.todayPct != null && st.todayPct < 0;
    $("#today").innerHTML = st.todayPct == null ? sk("150px", 22) :
      `<span class="${neg ? "down" : "up"}">${pct(st.todayPct)}</span><span class="pill mult ${neg ? "neg" : ""}">${st.multiplier != null ? st.multiplier.toFixed(2) + "×" : ""}</span><span class="ter" style="font-size:15px">today</span>`;
    drawChart(false);
    updateScreen();
    // last order
    const o = S.orders && (S.orders.rows || []).find(x => x.status !== "skipped");
    $("#lastorder").innerHTML = !S.orders ? sk("70%", 18) : !o ? '<span class="t muted">No orders yet tonight</span>' :
      `<span class="t">${esc(orderLine(o))}</span>${checksHTML(o.checks || {})}`;
    // bots
    const running = (st.bots || []).filter(b => b.status === "ok").length;
    $("#botshead").textContent = `Bots · ${running} running`;
    const sig = JSON.stringify(st.bots);
    if ($("#carousel").dataset.sig !== sig) {
      $("#carousel").dataset.sig = sig;
      $("#carousel").innerHTML = (st.bots || []).map(c => `<a class="bcard" href="#/bots" data-bot="${c.name}"><div class="bhead">${statusDot(c)}<span class="bname">${BOT_TITLE[c.name]}</span></div>${botBody(c)}</a>`).join("");
    }
    // activity: last 5
    if (S.activity) {
      const none = !(S.activity.rows || []).length && !(S.orders && (S.orders.rows || []).length);
      $("#chartempty").hidden = !none;
      const rows = (S.activity.rows || []).slice(0, 5), s2 = JSON.stringify(rows);
      if ($("#homeact").dataset.sig !== s2) { $("#homeact").dataset.sig = s2;
        $("#homeact").innerHTML = rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>` : '<div class="empty-state">Waiting for the first trade</div>'; }
    }
  }
  function orderLine(o) {
    const sym = o.symbol || (o.mint || "").slice(0, 6), usd = o.fillUsd != null ? o.fillUsd : o.usd;
    const verb = o.status === "done" ? (o.side === "buy" ? "Bought" : "Sold") : (o.side === "buy" ? "Buy" : "Sell");
    const st = o.paper ? "PAPER" : o.status === "done" ? "verified" : o.status;
    return `${verb} ${sym}${usd != null ? " · " + money(usd) : o.pct ? " · " + o.pct + "%" : ""} · ${st}`;
  }

  // LIVE SCREEN card: double buffered, never flashes; never an invented frame
  let screenTimer = null, flip = 0;
  function updateScreen() {
    const sc = (S.state && S.state.screen) || {};
    const tr = $("#screentr"); if (!tr) return;
    const lane = sc.lane || (S.state && S.state.lane);
    tr.innerHTML = lane && lane.bot ? `<span style="color:${BOT_COLOR[lane.bot] || "#fff"}">${esc(BOT_TITLE[lane.bot] || lane.bot)} · ${lane.side === "sell" ? "selling" : "buying"}</span>` : "Idle";
    if (!sc.available) { $("#screenempty").textContent = "No frame yet"; S.frameTs = null; paintBadge(); return; }
    $("#screenempty").textContent = "";
    if (!API) loadFrame("d/" + enc(LS.getItem("desk.d")) + "/screen.jpg?v=" + enc(sc.frameId || sc.ts), sc.ts);
    else if (!screenTimer) { const t = () => { if (route().name !== "home") { clearInterval(screenTimer); screenTimer = null; return; } apiFrame(); }; screenTimer = setInterval(t, 1000); t(); }
    paintBadge();
  }
  async function apiFrame() {
    try { const r = await http("/api/screen.jpg", { headers: authH() }); const b = await r.blob();
      const url = URL.createObjectURL(b); loadFrame(url, parseFloat(r.headers.get("X-Frame-Ts")) || null, true); } catch (_) {}
  }
  function loadFrame(url, ts, revoke) {
    if (!revoke && S.frameUrl === url) { S.frameTs = ts; return; }
    const imgs = [$("#f0"), $("#f1")]; if (!imgs[0]) return;
    const back = imgs[1 - flip], front = imgs[flip];
    back.onload = () => { back.classList.add("front"); front.classList.remove("front"); flip = 1 - flip;
      if (revoke && front.dataset.blob) URL.revokeObjectURL(front.src); S.frameTs = ts; paintBadge(); };
    back.onerror = () => {};
    if (revoke) back.dataset.blob = "1";
    back.src = url; S.frameUrl = url;
  }
  function paintBadge() {
    const tl = $("#screentl"); if (!tl) return;
    const ts = S.frameTs;
    const live = ts && (Date.now() / 1000 - ts) < 5;
    tl.innerHTML = live ? '<span class="dot live"></span>Live · Bot\'s computer'
      : `<span class="dot grey"></span>Last frame ${ts ? hhmm(ts) : "· none yet"}`;
  }

  // full screen frame: landscape allowed, pinch to zoom, "Open on FOMO" for the coin on screen
  function openFullscreen() {
    const img = $("#screen img.front");
    const sc = (S.state && S.state.screen) || {};
    const d = document.createElement("div"); d.className = "fs";
    d.innerHTML = `<div class="fsbar"><span class="sec">${img ? "Last frame " + hhmm(S.frameTs) : "No frame yet"}</span><button class="iconbtn" aria-label="Close">${I.cross.replace("<svg", '<svg style="stroke:#fff;fill:none;stroke-width:2"')}</button></div>
      <div class="stage">${img ? `<img src="${esc(img.src)}" alt="Bot's computer">` : '<div class="empty-state">No frame yet</div>'}</div>
      <div class="fsfoot">${sc.link ? `<a class="btn primary" href="${esc(sc.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}</div>`;
    document.body.appendChild(d);
    $(".fsbar button", d).onclick = () => d.remove();
    const im = $(".stage img", d); if (!im) return;
    let sc0 = 1, s = 1, x = 0, y = 0, d0 = 0, p0 = null, lastTap = 0;
    const apply = () => im.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${s})`;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const st = $(".stage", d);
    st.addEventListener("touchstart", e => { if (e.touches.length === 2) { d0 = dist(e.touches); sc0 = s; }
      else { p0 = [e.touches[0].clientX - x, e.touches[0].clientY - y]; const n = Date.now(); if (n - lastTap < 300) { s = s > 1 ? 1 : 2.5; x = y = 0; apply(); } lastTap = n; } }, { passive: true });
    st.addEventListener("touchmove", e => { e.preventDefault(); if (e.touches.length === 2) { s = Math.min(6, Math.max(1, sc0 * dist(e.touches) / d0)); }
      else if (p0 && s > 1) { x = e.touches[0].clientX - p0[0]; y = e.touches[0].clientY - p0[1]; } apply(); }, { passive: false });
    st.addEventListener("wheel", e => { e.preventDefault(); s = Math.min(6, Math.max(1, s * (e.deltaY < 0 ? 1.1 : 0.9))); apply(); }, { passive: false });
  }

  // ---------- BOTS ----------
  function renderBots() {
    $("#view").innerHTML = `<header class="navbar"><div class="center">Bots</div></header>${errRow()}
      <div id="botlist">${BOTS.map(() => `<div class="bcard full">${sk("40%", 20)}<div style="height:10px"></div>${sk("100%", 120)}</div>`).join("")}</div>`;
    loadBots();
  }
  function loadBots() { BOTS.forEach(n => src.bot(n).then(b => { S.bots[n] = b; remember(b.decisions); paintBots(); }).catch(() => paintBots())); }
  let botsTick = 0;
  function updateBots() { paintErr(); if (++botsTick % 1 === 0) loadBots(); }
  function paintBots() {
    if (route().name !== "bots") return;
    const st = S.state, have = BOTS.map(n => S.bots[n] || (st && { card: (st.bots || []).find(b => b.name === n), decisions: null }));
    if (have.some(x => !x || !x.card)) return;      // keep the skeleton until all 5 are in
    $("#botlist").innerHTML = have.map(b => {
      const c = b.card, dec = b.decisions;
      const lock = c.name === "risk" && c.locked;
      return `<div class="bcard full"><div class="bhead">${statusDot(c)}<span class="bname">${BOT_TITLE[c.name]}</span>
          <span class="small muted">${c.status === "ok" ? "running" : esc(c.status)} · ${c.count != null ? c.count : "—"} today</span>
          <span class="swwrap"><button class="switch ${c.paused ? "" : "on"}" data-pause="${c.name}" ${lock ? "disabled" : ""} aria-label="Pause ${BOT_TITLE[c.name]}"></button></span></div>
        ${lock ? '<div class="small muted" style="margin-bottom:6px">Locked while a position is open</div>' : ""}
        ${botBody(c)}
        <div class="sh" style="margin:16px 0 6px"><span class="small muted">Last 20 decisions</span><a href="#/account/${c.name}" class="small">Settings</a></div>
        ${dec == null ? sk("100%", 40) : dec.length ? `<div class="list plain" style="background:#000">${dec.slice(0, 20).map(x => decRow(c.name, x)).join("")}</div>` : '<div class="small muted">No decisions yet tonight</div>'}
      </div>`;
    }).join("");
  }
  function decRow(bot, x) {
    const go = x.mint ? (bot === "analyst" || bot === "scanner" ? "#/audit/" : "#/coin/") + enc(x.mint) : "";
    return `<div class="row" style="min-height:52px;padding:8px 4px" ${go ? `data-go="${go}"` : ""}><div class="rmain">
      <div class="rt" style="font-size:15px">${esc(x.symbol || (x.mint || "").slice(0, 6))} <span class="muted" style="font-weight:400">· ${esc(x.summary || x.reason || "")}</span></div>
      <div class="rs" style="font-size:13px">${hhmm(x.ts)}</div>${fomoA(x.link)}</div></div>`;
  }

  // ---------- ACTIVITY ----------
  let actPages = null;
  function renderActivity() {
    $("#view").innerHTML = `<header class="navbar"><div class="center">Activity</div></header>${errRow()}<div id="actlist">${[0, 1, 2, 3, 4, 5].map(() => sk("100%", 60, "margin-bottom:6px")).join("")}</div>`;
    actPages = null; updateActivity();
  }
  function updateActivity() {
    paintErr();
    if (!S.activity) return;
    if (!actPages) actPages = { rows: S.activity.rows.slice(), next: nextCursor(S.activity) };
    else if (actPages.rows.length <= 30) actPages = { rows: S.activity.rows.slice(), next: nextCursor(S.activity) };
    const rows = actPages.rows;
    if (rows.length) LS.setItem("desk.seenAct", String(rows[0].id));
    $("#actlist").innerHTML = rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>${actPages.next ? '<button class="more" id="more">Load more</button>' : ""}`
      : '<div class="empty-state">Nothing yet tonight</div>';
    const m = $("#more"); if (m) m.onclick = async () => { m.textContent = "Loading…";
      try { const p = await src.activity(actPages.next); actPages.rows = actPages.rows.concat(p.rows); actPages.next = nextCursor(p); remember(p.rows); updateActivity(); }
      catch (_) { m.textContent = "Couldn't load · tap to retry"; } };
    bellDot();
  }
  function bellDot() { const b = $("#belldot"); if (!b || !S.activity) return; const top = (S.activity.rows || [])[0];
    b.hidden = !(top && String(top.id) !== LS.getItem("desk.seenAct")); }

  // ---------- COIN ----------
  function renderCoin(mint) {
    if (!mint || !MINT_RX.test(mint)) { location.hash = "#/home"; return; }
    $("#view").innerHTML = `<header class="navbar"><a class="back" href="javascript:history.back()">‹ Back</a><div class="center" id="cointitle"></div><span id="coinpaper" style="min-width:60px;text-align:right"></span></header>${errRow()}
      <div id="coin">${sk("60%", 30, "margin-top:8px")}${sk("40%", 18, "margin-top:10px")}${sk("80%", 70, "margin-top:14px")}${sk("100%", 220, "margin-top:14px")}
      <div class="stats">${sk("100%", 54)}${sk("100%", 54)}${sk("100%", 54)}</div>${sk("100%", 50, "margin-top:12px")}</div>`;
    paintErr();
    src.coin(mint).then(c => paintCoin(c)).catch(e => {
      if (e.status === 404) { const k = S.known.get(mint) || {};
        $("#coin").innerHTML = `<div class="empty-state">${esc(k.symbol || mint.slice(0, 6))} isn't in tonight's published coin data.</div>
          <div class="btns">${k.link ? `<a class="btn" href="${esc(k.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}<a class="btn" href="#/audit/${enc(mint)}">See the audit</a></div>`; }
      else { S.err = S.err || "offline"; paintErr(); }
    });
  }
  function paintCoin(c) {
    if (route().name !== "coin") return;
    remember([c]);
    $("#cointitle").textContent = c.symbol || "";
    $("#coinpaper").innerHTML = c.paper ? '<span class="pill paper">PAPER</span>' : "";
    const sh = c.shield, good = sh === "8/8";
    const since = c.sinceEntryPct;
    const exit = c.exitLine != null ? c.exitLine : c.stopLine;
    const pos = c.position;
    $("#coin").innerHTML = `
      <div class="coin-h"><span class="coin-name">${esc(c.name || c.symbol)}</span>${sh ? `<a class="chip ${good ? "good" : "badc"}" href="#/audit/${enc(c.mint)}">🛡 ${esc(sh)}</a>` : ""}</div>
      <div class="sec" style="margin-top:2px">${esc(c.symbol)} · ${esc(c.chain || "Solana")}${c.ageHours != null ? " · " + age(c.ageHours) : ""}</div>
      <div class="price">${c.price != null ? esc(price(c.price)) : sk("70%", 64)}</div>
      ${since != null ? `<div class="${since >= 0 ? "up" : "down"}" style="font-weight:600">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% since entry</div>` : ""}
      <div class="chart-wrap" style="height:220px;margin-top:12px"><canvas id="candles"></canvas></div>
      ${c.candles && c.candles.length ? "" : '<div class="small muted">No 1-minute prices yet</div>'}
      <div class="stats"><div class="stat"><div class="l">Market cap</div><div class="v">${esc(short(c.marketCap) || "n/a")}</div></div>
        <div class="stat"><div class="l">Liquidity</div><div class="v">${esc(short(c.liquidityUsd) || "n/a")}</div></div>
        <div class="stat"><div class="l">Holders</div><div class="v">${c.holders != null ? Number(c.holders).toLocaleString("en-US") : "n/a"}</div></div></div>
      ${pos ? `<div class="poscard">${esc(pos.label)}${pos.valueUsd != null ? `<div class="small muted" style="margin-top:4px">Now ${money(pos.valueUsd)}${pos.closedAt ? "" : ""}</div>` : ""}${pos.closedAt ? `<div class="small muted" style="margin-top:4px">Closed ${hhmm(pos.closedAt)} · ${esc(pos.exitReason || "")}${pos.pnlUsd != null ? " · " + (pos.pnlUsd >= 0 ? "+" : "") + money(pos.pnlUsd) : ""}</div>` : ""}</div>` : ""}
      <div class="btns"><a class="btn" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>
        <button class="btn danger ${c.canSell ? "" : "off"}" id="sellnow">Sell now</button></div>`;
    requestAnimationFrame(() => DeskCharts.candles($("#candles"), c.candles, exit, c.exitLine != null ? "exit " + price(exit) : exit != null ? "stop " + price(exit) : null));
    $("#sellnow").onclick = () => sellSheet(c);
  }
  function sellSheet(c) {
    let p = 100;
    const body = `<h4>Sell ${esc(c.symbol)}</h4><p>Executor clicks it, then it's verified.</p>
      <div class="seg" id="sellseg">${(c.sellSteps || [25, 50, 100]).map(x => `<button data-p="${x}" class="${x === 100 ? "on" : ""}">${x}%</button>`).join("")}</div>
      <button class="btn danger" id="confirmsell">Confirm sell</button>`;
    const sh = openSheet(body);
    $("#sellseg", sh).onclick = e => { const b = e.target.closest("button"); if (!b) return; p = +b.dataset.p; $$("#sellseg button", sh).forEach(x => x.classList.toggle("on", x === b)); };
    $("#confirmsell", sh).onclick = () => act({ kind: "sell", mint: c.mint, symbol: c.symbol, pct: p });
  }

  // ---------- AUDIT ----------
  function renderAudit(mint) {
    if (!mint || !MINT_RX.test(mint)) { location.hash = "#/home"; return; }
    $("#view").innerHTML = `<header class="navbar"><a class="back" href="javascript:history.back()">‹ Back</a><div class="center" id="audtitle">Audit</div><span style="min-width:60px"></span></header>${errRow()}
      <div id="audit">${sk("50%", 28, "margin-top:8px")}<div class="audit"><div class="stack">${sk("64px", 400)}</div><div class="layers">${Array(8).fill(sk("100%", 40, "margin:6px 0")).join("")}</div></div></div>`;
    paintErr();
    src.audit(mint).then(paintAudit).catch(e => {
      if (e.status === 404) $("#audit").innerHTML = '<div class="empty-state">Analyst hasn\'t taken this coin apart.</div>';
      else { S.err = S.err || "offline"; paintErr(); }
    });
  }
  function paintAudit(a) {
    if (route().name !== "audit") return;
    remember([a]);
    $("#audtitle").textContent = a.symbol || "Audit";
    const L = a.layers.slice(0, 8);
    while (L.length < 8) L.push({ n: L.length + 1, name: "Layer " + (L.length + 1), pass: null, value: "not read" });
    const H = 52;
    $("#audit").innerHTML = `
      <div class="coin-h"><span class="coin-name">${esc(a.name || a.symbol)}</span><span class="chip ${a.green === 8 ? "good" : "badc"}">🛡 ${a.green}/8</span></div>
      ${a.score != null ? `<div class="sec" style="margin-top:2px">Score ${esc(a.score)} · ${a.passed ? "passed" : "rejected"}${a.reason ? " · " + esc(a.reason) : ""}</div>` : ""}
      <div class="audit"><div class="stack" style="height:${H * 8}px">${L.map((l, i) => `<div class="disc" data-i="${i}" style="top:${i * H + 13}px"></div>`).join("")}<div class="beam" id="beam"></div></div>
        <div class="layers">${L.map((l, i) => `<div class="layer ${l.pass === true ? "ok" : l.pass === false ? "bad" : "na"}" data-i="${i}"><div class="nm"><div class="a">${esc(l.name)}</div><div class="b">${esc(l.value)}</div></div>
          <span class="mk">${l.pass === true ? I.check : l.pass === false ? I.cross : I.dash}</span></div>`).join("")}</div></div>
      <div class="list plain" style="margin-top:14px"><div class="row" style="cursor:default"><div class="rmain"><div class="rt" style="font-size:15px">${esc(socialLine(a))}</div></div></div></div>
      <div class="btns">${a.link ? `<a class="btn" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}<a class="btn" href="#/coin/${enc(a.mint)}">Coin</a></div>`;
    const discs = $$(".disc"), rows = $$(".layer"), beam = $("#beam");
    const mark = i => { rows[i].classList.add("done"); discs[i].classList.add(L[i].pass === true ? "ok" : L[i].pass === false ? "bad" : "na"); };
    if (reduced()) { L.forEach((_, i) => mark(i)); return; }
    beam.style.opacity = 1; let i = 0;
    const step = () => { if (route().name !== "audit") return; if (i >= 8) { beam.style.opacity = 0; return; }
      beam.style.top = (i * H + 25) + "px"; const k = i; setTimeout(() => mark(k), 220); i++; setTimeout(step, 320); };
    step();
  }
  function socialLine(a) {
    if (!a.social || a.social === "Social: off") return "Social: off";
    const parts = [a.social];
    if (a.u15 != null) parts.push(`${a.u15} accounts in 15m`);
    if (a.smart != null) parts.push(`${a.smart} top traders hold`);
    return parts.join(" · ");
  }

  // ---------- ACCOUNT ----------
  function renderAccount(group) {
    if (route().name !== "account") return;
    if (typeof group !== "string") group = route().arg;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#view input")) return;
    const a = S.account;
    const head = `<header class="navbar"><div class="center">Account</div></header>${errRow()}`;
    if (!a) { $("#view").innerHTML = head + `${sk("100%", 44, "margin-top:12px")}${sk("100%", 100, "margin-top:22px")}${sk("100%", 150, "margin-top:22px")}${sk("100%", 300, "margin-top:22px")}`;
      paintErr(); if (hasKey()) src.account().then(x => { S.account = x; renderAccount(); }).catch(() => {}); return; }
    const groups = a.settings || {};
    const GN = { scanner: "Scanner", analyst: "Analyst", social: "Social", brain: "Brain", executor: "Executor", risk: "Risk", desk: "Desk" };
    const setRow = s => {
      if (s.key === "mode") return "";
      const v = s.value;
      if (s.type === "number") {
        const span = s.max - s.min, stepv = span <= 1 ? 0.01 : (span <= 20 || (v != null && v % 1)) ? 0.1 : 1;
        return `<div class="set"><div class="top"><span class="k">${esc(s.key)}</span><button class="v" data-edit="${esc(s.key)}">${v == null ? "—" : esc(+v)}</button></div>
          <input type="range" min="${s.min}" max="${s.max}" step="${stepv}" value="${v == null ? s.min : v}" data-key="${esc(s.key)}" data-orig="${v == null ? "" : v}" aria-label="${esc(s.key)}"></div>`;
      }
      if (s.type === "enum") return `<div class="set"><div class="top"><span class="k">${esc(s.key)}</span></div><div class="seg small" style="margin:6px 0 4px">${s.options.map(o =>
        `<button data-enum="${esc(s.key)}" data-val="${esc(o)}" class="${String(v) === o ? "on" : ""}">${esc(o)}</button>`).join("")}</div></div>`;
      const ro = s.key === "withdraw_address" || s.key === "rpc_url";
      return `<div class="lrow" ${ro ? "" : `data-edit="${esc(s.key)}"`}><span class="l" style="font-size:15px">${esc(s.key)}</span><span class="r mono">${esc(v === "" || v == null ? "not set" : v)}</span>${ro ? "" : '<span class="chev">›</span>'}</div>`;
    };
    $("#view").innerHTML = head + `
      <div class="group" style="margin-top:12px"><div class="seg" id="modeseg"><button data-mode="PAPER" class="${a.mode === "PAPER" ? "on" : ""}">PAPER</button><button data-mode="LIVE" class="${a.mode === "LIVE" ? "on" : ""}">LIVE</button></div>
        <div class="note">${a.liveLocked ? "LIVE is locked until the desk allows it (secrets/live_allowed). Switching to LIVE needs you to type LIVE." : "Switching to LIVE needs you to type LIVE."}</div></div>
      <div class="group"><div class="list plain">
        <div class="lrow" style="cursor:default"><span class="l">Cash</span><span class="r num" style="color:#fff;font-weight:600">${a.cash != null ? money(a.cash) : "—"}</span></div>
        <div class="lrow" data-edit="paper_start_cash"><span class="l">Night start cash (PAPER)</span><span class="r num">${a.startBalance != null ? money(a.startBalance) : "—"}</span><span class="chev">›</span></div>
      </div></div>
      <div class="group"><div class="list plain">
        ${a.profileUrl ? `<a class="lrow" href="${esc(a.profileUrl)}" target="_blank" rel="noopener noreferrer"><span class="l">Your FOMO profile</span><span class="r">${esc(a.fomoHandle || "")}</span><span class="chev">›</span></a>`
          : `<div class="lrow" data-edit="fomo_handle"><span class="l">Your FOMO profile</span><span class="r">not set</span><span class="chev">›</span></div>`}
        <div class="lrow" id="invite"><span class="l">Invite a friend</span><span class="chev">›</span></div>
      </div></div>
      <div class="group"><h3>Copy picks</h3><div class="list plain"><div class="set"><div class="seg small" style="opacity:.4;pointer-events:none">${["off", "every 24h", "12h", "6h"].map(x => `<button class="${x === "off" ? "on" : ""}">${x}</button>`).join("")}</div></div></div>
        <div class="note">${esc((a.copyPicks && a.copyPicks.note) || "")}</div></div>
      <div class="group"><h3>Pushes</h3><div class="list plain">
        <div class="lrow" style="cursor:default"><span class="l">Telegram</span><span class="r">${esc((a.pushes && a.pushes.telegram) || "not connected")}</span></div>
        <div class="lrow" style="cursor:default"><span class="l">Web push</span><span class="r">${API ? "not set up" : "Telegram only"}</span></div>
        <div class="lrow" id="testpush"><span class="l" style="color:var(--blue)">Send test push</span></div>
      </div><div class="note">Plan B: Telegram only. Every push has an Open on FOMO button.</div></div>
      <div class="group"><div class="list plain"><div class="lrow" id="watch"><span class="l">Watch in Grok Bot</span><span class="chev">›</span></div></div></div>
      ${Object.keys(groups).map(g => `<div class="group" id="g-${g}"><h3>${BOT_COLOR[g] ? `<span class="dot" style="background:${BOT_COLOR[g]}"></span>` : ""}${GN[g] || g}</h3><div class="list plain">${groups[g].map(setRow).join("")}</div></div>`).join("")}
      <div class="group"><div class="list plain"><div class="lrow" style="cursor:default"><span class="l">Data</span><span class="r">${API ? "Local API" : "Plan B · published every 60s"} · ${S.state ? "last update " + hhmm(S.state.ts) : "—"}</span></div>
        <div class="lrow" id="forget"><span class="l" style="color:var(--red)">Forget this device</span></div></div>
        <div class="note">${API ? "Changes go straight to the desk." : "This page can't change the desk by itself: every switch gives you the command to send to Grok Bot (Telegram after STEP 11)."}</div></div>`;
    paintErr();
    if (group && $("#g-" + group)) setTimeout(() => $("#g-" + group).scrollIntoView({ block: "start" }), 50);
    const v = $("#view");
    $("#modeseg").onclick = e => { const b = e.target.closest("button"); if (!b || b.classList.contains("on")) return; modeSheet(b.dataset.mode); };
    $$("input[type=range]", v).forEach(r => {
      r.oninput = () => { const b = $(`[data-edit="${r.dataset.key}"]`, v); if (b) b.textContent = +r.value; };
      r.onchange = () => { const val = +r.value; act({ kind: "set", key: r.dataset.key, value: val, revert: () => { r.value = r.dataset.orig; const b = $(`[data-edit="${r.dataset.key}"]`, v); if (b) b.textContent = r.dataset.orig; } }); };
    });
    $$("[data-enum]", v).forEach(b => b.onclick = () => { if (!b.classList.contains("on")) act({ kind: "set", key: b.dataset.enum, value: b.dataset.val }); });
    $$("[data-edit]", v).forEach(b => { if (b.tagName === "INPUT") return; b.onclick = () => editSheet(b.dataset.edit); });
    $("#invite").onclick = () => share(a.inviteUrl);
    $("#testpush").onclick = () => (a.pushes && a.pushes.telegram === "connected") ? act({ kind: "cmd", cmd: "status" })
      : openSheet(`<h4>Send test push</h4><p>Telegram is ${esc((a.pushes && a.pushes.telegram) || "not connected")}. Nothing was sent.</p><button class="btn" data-close>OK</button>`);
    $("#watch").onclick = () => openSheet(`<h4>Watch in Grok Bot</h4><p>Your bot's own computer is shown in the Grok Bot app: open this bot's chat and tap its computer to watch live. The card on Home shows the newest frame the desk published.</p><button class="btn" data-close>OK</button>`);
    $("#forget").onclick = () => { LS.removeItem("desk.d"); LS.removeItem("desk.t"); S.state = null; S.account = null; toast("Data link removed"); poll(); renderAccount(); };
  }
  function findSetting(key) { const g = (S.account && S.account.settings) || {}; for (const k in g) { const s = g[k].find(x => x.key === key); if (s) return s; } return { key, type: "text" }; }
  function editSheet(key) {
    const s = findSetting(key);
    const t = s.type === "number" ? "number" : s.type === "time" ? "time" : "text";
    const sh = openSheet(`<h4>${esc(key)}</h4>${s.type === "number" ? `<p>Range ${s.min} to ${s.max}</p>` : ""}
      <input class="txt" id="edv" type="${t}" ${t === "number" ? `inputmode="decimal" min="${s.min}" max="${s.max}" step="any"` : ""} value="${esc(s.value == null ? "" : s.value)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="small down" id="ederr" style="margin-top:6px"></div><button class="btn primary" id="edok">Continue</button>`);
    $("#edok", sh).onclick = () => { const val = $("#edv", sh).value.trim();
      if (s.type === "number") { const x = Number(val); if (val === "" || !isFinite(x) || x < s.min || x > s.max) { $("#ederr", sh).textContent = `Out of range: ${s.min} to ${s.max}`; return; } }
      act({ kind: "set", key, value: s.type === "number" ? Number(val) : val }); };
  }
  function modeSheet(m) {
    if (m === "PAPER") return act({ kind: "mode", mode: "PAPER" });
    const sh = openSheet(`<h4>Switch to LIVE</h4><p>Real money. Type LIVE to continue.${S.account && S.account.liveLocked ? " LIVE is locked right now: the desk will refuse until it's unlocked." : ""}</p>
      <input class="txt" id="livein" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="LIVE"><button class="btn danger off" id="liveok">Switch to LIVE</button>`);
    const inp = $("#livein", sh), ok = $("#liveok", sh);
    inp.oninput = () => ok.classList.toggle("off", inp.value !== "LIVE");
    ok.onclick = () => { if (inp.value === "LIVE") act({ kind: "mode", mode: "LIVE", confirm: "LIVE" }); };
  }

  // ---------- write actions: local API directly, Plan B = the chat/Telegram command ----------
  function command(x) {
    if (x.kind === "sell") return `sell ${x.symbol} ${x.pct}`;
    if (x.kind === "pause") return `${x.pause ? "pause" : "resume"} ${BOT_TITLE[x.bot]}`;
    if (x.kind === "mode") return x.mode === "LIVE" ? "live" : "paper";
    if (x.kind === "cmd") return x.cmd;
    if (x.kind === "set") return x.key === "stop_pct" ? `set stop to -${x.value}%` : `set ${x.key} to ${x.value}`;
    return "";
  }
  async function act(x) {
    if (!API || x.kind === "cmd") {
      if (x.revert) x.revert();
      const cmd = command(x);
      const extra = x.kind === "mode" && x.mode === "LIVE" ? " Grok Bot will ask you to type LIVE again." : "";
      const sh = openSheet(`<h4>Send this to Grok Bot</h4><p>This page is read-only (Plan B). Paste the command in your Grok Bot chat${" "}(or Telegram once STEP 11 is set up).${extra}</p>
        <div class="cmd" id="cmdtext">${esc(cmd)}</div><button class="btn primary" id="copycmd">Copy command</button><button class="btn" data-close>Cancel</button>`);
      $("#copycmd", sh).onclick = async () => { await copy(cmd); toast("Command copied"); closeSheet(); };
      return;
    }
    try {
      let r;
      if (x.kind === "sell") r = await api("/api/sell/" + enc(x.mint), { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authH()), body: JSON.stringify({ pct: x.pct, confirm: true }) });
      else if (x.kind === "pause") r = await api(`/api/bots/${x.bot}/${x.pause ? "pause" : "resume"}`, { method: "POST", headers: authH() });
      else if (x.kind === "mode") r = await api("/api/mode", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authH()), body: JSON.stringify({ mode: x.mode, confirm: x.confirm || null }) });
      else if (x.kind === "set") r = await api("/api/settings", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authH()), body: JSON.stringify({ key: x.key, value: x.value }) });
      closeSheet();
      toast(x.kind === "sell" ? "Sell queued · Executor clicks it" : x.kind === "set" ? `${x.key} → ${x.value}` : "Done");
      S.account = null; poll();
    } catch (e) {
      if (x.revert) x.revert();
      const msg = (e.body && (e.body.error === "refused" ? Object.values(e.body.details || {}).join("; ") : e.body.error)) || e.message;
      closeSheet(); openSheet(`<h4>Refused</h4><p>${esc(msg)}</p><button class="btn" data-close>OK</button>`);
    }
  }

  // ---------- sheets, toast, share, search ----------
  function openSheet(html) {
    closeSheet();
    const root = $("#sheet-root");
    root.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
    const sh = $(".sheet", root);
    requestAnimationFrame(() => { $(".scrim", root).classList.add("on"); sh.classList.add("on"); });
    root.onclick = e => { if (e.target.closest("[data-close]")) closeSheet(); };
    return sh;
  }
  function closeSheet() { const r = $("#sheet-root"); if (r) r.innerHTML = ""; }
  let toastT = null;
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 1800); }
  async function copy(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (_) {
      const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {} ta.remove(); return true; }
  }
  async function share(url) {
    if (!url) return;
    if (navigator.share) { try { await navigator.share({ url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    await copy(url); toast("Link copied");
  }
  function openSearch() {
    const sh = openSheet(`<h4>Search</h4><div class="search"><input class="txt" id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off" spellcheck="false"></div><div id="qres" style="margin-top:10px"></div>`);
    const q = $("#q", sh), out = $("#qres", sh);
    const run = () => { const s = q.value.trim().toLowerCase(); if (!s) { out.innerHTML = ""; return; }
      const hits = [...S.known.values()].filter(k => (k.symbol || "").toLowerCase().includes(s) || (k.name || "").toLowerCase().includes(s) || k.mint.toLowerCase().startsWith(s)).slice(0, 20);
      out.innerHTML = hits.length ? `<div class="list plain" style="background:#000">${hits.map(k => `<div class="row" data-go="#/coin/${enc(k.mint)}"><div class="rmain"><div class="rt">${esc(k.symbol || k.mint.slice(0, 6))}</div><div class="rs">${esc(k.name || "")} · ${esc(k.mint.slice(0, 4))}…${esc(k.mint.slice(-4))}</div>${fomoA(k.link)}</div></div>`).join("")}</div>`
        : `<div class="small muted">${MINT_RX.test(q.value.trim()) ? `<a class="fomo" href="#/coin/${enc(q.value.trim())}">Look up this mint</a>` : "Not in tonight's data. Paste the mint to look it up."}</div>`; };
    q.oninput = run; setTimeout(() => q.focus(), 300);
  }

  // ---------- global wiring ----------
  document.addEventListener("click", e => {
    if (e.target.closest("[data-stop]")) return;          // FOMO links open on their own
    const p = e.target.closest("[data-pause]");
    if (p) { e.preventDefault(); if (p.disabled) return; const n = p.dataset.pause; const c = (S.bots[n] && S.bots[n].card) || {};
      act({ kind: "pause", bot: n, pause: !c.paused }); return; }
    const g = e.target.closest("[data-go]");
    if (g) { closeSheet(); location.hash = g.dataset.go; }
  });
  window.addEventListener("hashchange", go);
  setInterval(() => { paintErr(); paintBadge(); }, 1000);
  setInterval(poll, POLL_S * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || API)) navigator.serviceWorker.register("sw.js").catch(() => {});
  go();
  poll();
})();
