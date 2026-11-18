/* Estreou Hoje: feed por dia, calendário, filtro por região e modo teatro
   com player embutido (YouTube e Vimeo). Os dados vêm de campaigns.json. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var ALL = "Todas";
  var TZ = "America/Sao_Paulo";

  /* ---------- Dados ---------- */
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function safeUrl(u) { return /^https?:\/\//i.test(u) ? u : ""; }
  function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (x) {
      return {
        id: str(x.id), date: str(x.date), brand: str(x.brand), title: str(x.title),
        agency: str(x.agency), source: str(x.source), url: safeUrl(str(x.url)),
        region: str(x.region), cc: str(x.cc).toUpperCase(), summary: str(x.summary),
        yt: Array.isArray(x.yt) ? x.yt.map(str).filter(function (s) { return /^[\w-]{11}$/.test(s); }) : [],
        video: safeUrl(str(x.video)), addedAt: str(x.addedAt)
      };
    }).filter(function (c) { return isDay(c.date) && c.title; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.addedAt === b.addedAt) return 0;
        return a.addedAt < b.addedAt ? 1 : -1;
      });
  }

  /* ---------- Datas (o "hoje" é sempre o de São Paulo) ---------- */
  function todayYmd() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function toDate(s) { var p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function shift(s, n) { var p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  function utc(o) { o.timeZone = "UTC"; return new Intl.DateTimeFormat("pt-BR", o); }
  var fmtWd = utc({ weekday: "short" });
  var fmtLong = utc({ weekday: "long", day: "numeric", month: "long" });
  var fmtFull = utc({ day: "numeric", month: "long", year: "numeric" });
  var fmtMonth = utc({ month: "long", year: "numeric" });
  var fmtMonthShort = utc({ month: "short" });
  var fmtStamp = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function weekday(s) { return fmtWd.format(toDate(s)).replace(".", ""); }
  function longDay(s) { return fmtLong.format(toDate(s)); }
  function fullDay(s) { return fmtFull.format(toDate(s)); }
  function monthName(ym) { return fmtMonth.format(toDate(ym + "-01")).replace(" de ", " "); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function plural(n) { return n === 1 ? "1 campanha" : n + " campanhas"; }

  function flagOf(cc) {
    if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
    return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65);
  }
  function vimeoOf(u) { var m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i); return m ? { id: m[1], url: u } : null; }
  function isPlayable(c) { return c.yt.length > 0 || vimeoOf(c.video) !== null; }
  function outsideFilm(c) { return !isPlayable(c) && c.video ? c.video : ""; }
  function hostName(u) {
    if (/instagram\.com/i.test(u)) return "Instagram";
    if (/vimeo\.com/i.test(u)) return "Vimeo";
    if (/youtu/i.test(u)) return "YouTube";
    return "site";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(cls, text, href) {
    var a = el("a", cls, text);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    return a;
  }

  /* ---------- Estado ---------- */
  var state = { items: [], today: todayYmd(), sel: null, month: todayYmd().slice(0, 7), region: ALL, loaded: false };

  function visible() {
    return state.region === ALL ? state.items : state.items.filter(function (c) { return c.region === state.region; });
  }
  function byDay(list) {
    var m = {};
    list.forEach(function (c) { (m[c.date] = m[c.date] || []).push(c); });
    return m;
  }
  function viewItems() {
    var list = visible();
    if (state.sel) return list.filter(function (c) { return c.date === state.sel; });
    var from = shift(state.today, -5);
    return list.filter(function (c) { return c.date >= from && c.date <= state.today; });
  }
  function heading() { return state.sel ? fullDay(state.sel) : "Hoje e os últimos 5 dias"; }

  /* ---------- Feed ---------- */
  function renderStrip(map) {
    var strip = $("strip");
    strip.textContent = "";
    for (var i = 0; i < 6; i++) {
      (function (day, i) {
        var n = (map[day] || []).length;
        var b = el("button", n ? "eh-day" : "eh-day eh-day-zero");
        b.type = "button";
        b.setAttribute("aria-pressed", state.sel === day ? "true" : "false");
        b.appendChild(el("span", "eh-day-wd", i === 0 ? "Hoje" : weekday(day)));
        b.appendChild(el("span", "eh-day-num", day.slice(8)));
        b.appendChild(el("span", "eh-day-cnt", n ? plural(n) : "nada ainda"));
        b.addEventListener("click", function () { go(state.sel === day ? null : day); });
        strip.appendChild(b);
      })(shift(state.today, -i), i);
    }
  }

  function renderCal(map) {
    var month = state.month;
    var first = toDate(month + "-01");
    var y = first.getUTCFullYear(), m = first.getUTCMonth();
    var count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    $("cal-title").textContent = monthName(month);
    var g = $("cal");
    g.textContent = "";
    ["D", "S", "T", "Q", "Q", "S", "S"].forEach(function (d) { g.appendChild(el("div", "eh-dow", d)); });
    for (var k = 0; k < first.getUTCDay(); k++) g.appendChild(el("div"));
    for (var d = 1; d <= count; d++) {
      (function (day, d) {
        var n = (map[day] || []).length;
        var c = el("button", "eh-cell" + (n ? " eh-has" : "") + (day === state.today ? " eh-today" : ""), String(d));
        c.type = "button";
        c.disabled = day > state.today;
        c.setAttribute("aria-pressed", state.sel === day ? "true" : "false");
        c.setAttribute("aria-label", fullDay(day) + (n ? ", " + plural(n) : ""));
        c.addEventListener("click", function () { go(day); });
        g.appendChild(c);
      })(month + "-" + pad(d), d);
    }
    var next = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 7);
    $("next").disabled = next + "-01" > state.today;
  }

  function renderChips() {
    var seen = {}, list = [];
    state.items.forEach(function (c) { if (c.region && !seen[c.region]) { seen[c.region] = 1; list.push(c.region); } });
    list.sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
    var regions = [ALL].concat(list);
    if (regions.indexOf(state.region) < 0) state.region = ALL;
    var box = $("chips");
    box.textContent = "";
    regions.forEach(function (r) {
      var b = el("button", "eh-chip", r);
      b.type = "button";
      b.setAttribute("aria-pressed", state.region === r ? "true" : "false");
      b.addEventListener("click", function () { state.region = r; render(); });
      box.appendChild(b);
    });
  }

  function card(c) {
    var a = el("article", "eh-card");
    var top = el("div", "eh-card-top");
    var f = el("span", "eh-flag", flagOf(c.cc));
    f.setAttribute("role", "img");
    f.setAttribute("aria-label", c.region || "Vários países");
    f.title = c.region || "Vários países";
    top.appendChild(f);
    if (c.brand) top.appendChild(el("span", "eh-brand", c.brand));
    a.appendChild(top);
    a.appendChild(el("h4", null, c.title));
    if (c.summary) a.appendChild(el("p", "eh-sum", c.summary));
    var meta = el("div", "eh-meta");
    if (c.agency) { var s = el("span", null, "Agência: "); s.appendChild(el("b", null, c.agency)); meta.appendChild(s); }
    if (c.region) meta.appendChild(el("span", null, c.region));
    if (meta.childNodes.length) a.appendChild(meta);
    var links = el("div", "eh-links");
    if (isPlayable(c)) {
      var w = el("button", "eh-watch", "▶ Assistir aqui");
      w.type = "button";
      w.addEventListener("click", function () { openTheater(c.id); });
      links.appendChild(w);
    }
    var out = outsideFilm(c);
    if (out) links.appendChild(link("eh-go", "Ver o filme no " + hostName(out) + " ↗", out));
    if (c.url) links.appendChild(link("eh-go", "Abrir em " + (c.source || "fonte") + " ↗", c.url));
    if (links.childNodes.length) a.appendChild(links);
    return a;
  }

  function group(day, list, single) {
    var s = el("section", "eh-group");
    var h = el("div", "eh-group-head");
    h.appendChild(el("h3", null, longDay(day)));
    if (day === state.today) h.appendChild(el("span", "eh-tag", "hoje"));
    h.appendChild(el("span", "eh-group-n", list.length ? plural(list.length) : ""));
    s.appendChild(h);
    if (!list.length) {
      s.appendChild(el("p", "eh-none", single
        ? "Nenhuma campanha registrada neste dia" + (state.region !== ALL ? " para " + state.region : "") + "."
        : "Nada registrado."));
    } else {
      var box = el("div", "eh-cards");
      list.forEach(function (c) { box.appendChild(card(c)); });
      s.appendChild(box);
    }
    return s;
  }

  function render() {
    var map = byDay(visible());
    renderStrip(map);
    renderCal(map);
    renderChips();
    $("view-title").textContent = heading();
    $("back").hidden = !state.sel;
    var feed = $("feed");
    feed.textContent = "";
    if (!state.loaded) return;
    if (state.sel) feed.appendChild(group(state.sel, map[state.sel] || [], true));
    else for (var i = 0; i < 6; i++) { var day = shift(state.today, -i); feed.appendChild(group(day, map[day] || [], false)); }
  }

  function go(day) {
    state.sel = day;
    if (day) state.month = day.slice(0, 7);
    var h = "#" + (day ? "dia-" + day : "ultimos");
    if (location.hash !== h) location.hash = h;
    render();
  }
  function fromHash() {
    state.today = todayYmd();
    var m = /^#dia-(\d{4}-\d{2}-\d{2})$/.exec(location.hash || "");
    var day = m && isDay(m[1]) && m[1] <= state.today ? m[1] : null;
    state.sel = day;
    if (day) state.month = day.slice(0, 7);
    render();
  }

  $("back").addEventListener("click", function () { go(null); });
  $("prev").addEventListener("click", function () {
    var f = toDate(state.month + "-01");
    state.month = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    render();
  });
  $("next").addEventListener("click", function () {
    var f = toDate(state.month + "-01");
    state.month = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    render();
  });
  $("open-theater").addEventListener("click", function () { openTheater(null); });
  window.addEventListener("hashchange", fromHash);

  /* ---------- Players externos ---------- */
  var ytPromise = null, vimeoPromise = null;
  function loadYouTube() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (!ytPromise) {
      ytPromise = new Promise(function (resolve, reject) {
        var prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () { if (prev) prev(); resolve(window.YT); };
        var s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.async = true;
        s.onerror = function () { ytPromise = null; reject(new Error("youtube")); };
        document.head.appendChild(s);
      });
    }
    return ytPromise;
  }
  function loadVimeo() {
    if (window.Vimeo && window.Vimeo.Player) return Promise.resolve(window.Vimeo);
    if (!vimeoPromise) {
      vimeoPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://player.vimeo.com/api/player.js";
        s.async = true;
        s.onload = function () { window.Vimeo ? resolve(window.Vimeo) : reject(new Error("vimeo")); };
        s.onerror = function () { vimeoPromise = null; reject(new Error("vimeo")); };
        document.head.appendChild(s);
      });
    }
    return vimeoPromise;
  }


  /* ---------- Popularidade: views e likes do YouTube, ao vivo ---------- */
  var popCache = {};
  function fmtNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " mi";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(".", ",") + " mil";
    return String(n);
  }
  function popOf(id) {
    if (!popCache[id]) {
      var key = "eh-pop-" + id, saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(key)); } catch (err) { saved = null; }
      popCache[id] = saved ? Promise.resolve(saved) :
        fetch("https://returnyoutubedislikeapi.com/votes?videoId=" + encodeURIComponent(id))
          .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .then(function (j) {
            var v = { views: +j.viewCount || 0, likes: +j.likes || 0 };
            if (v.views) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch (err) { /* sem storage */ } }
            return v;
          })
          .catch(function () { return { views: 0, likes: 0 }; });
    }
    return popCache[id];
  }
  function popText(v, date) {
    if (!v || !v.views) return "";
    var days = Math.max(1, Math.round((toDate(state.today) - toDate(date)) / 864e5) + 1);
    var t = "👁 " + fmtNum(v.views) + " views";
    if (v.likes) t += " · 👍 " + fmtNum(v.likes);
    if (v.views / days >= 50000) t = "🔥 " + t;
    return t;
  }
  // Preenche um elemento com a popularidade do filme do YouTube (se houver dado).
  function fillPop(node, e) {
    node.hidden = true;
    if (!e || e.kind !== "yt") return;
    popOf(e.id).then(function (v) {
      var t = popText(v, e.c.date);
      if (t) { node.textContent = t; node.hidden = false; }
    });
  }

  /* ---------- Modo teatro ---------- */
  // A timeline tem filmes (tocam aqui) e notícias sem filme (aparecem como card).
  function entriesFor(items) {
    var out = [];
    items.forEach(function (c) {
      if (c.yt.length) {
        c.yt.forEach(function (id, i) {
          out.push({ key: c.id + "-" + i, kind: "yt", id: id, url: "https://www.youtube.com/watch?v=" + id, c: c, part: i + 1, parts: c.yt.length });
        });
        return;
      }
      var v = vimeoOf(c.video);
      if (v) out.push({ key: c.id + "-v", kind: "vimeo", id: v.id, url: v.url, c: c, part: 1, parts: 1 });
      else out.push({ key: c.id + "-card", kind: "card", id: "", url: c.url, c: c, part: 1, parts: 1 });
    });
    return out;
  }

  var th = null;

  function nextFilm(from) {
    for (var i = from; i < th.entries.length; i++) if (th.entries[i].kind !== "card") return i;
    return -1;
  }

  function openTheater(startId) {
    if (MOBILE.matches) { openFeed(startId); return; }
    if (th) closeTheater();
    var entries = entriesFor(viewItems());
    var films = entries.filter(function (e) { return e.kind !== "card"; }).length;
    var cards = entries.length - films;

    var root = el("div", "eh-theater");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "eh-th-title");

    var top = el("div", "eh-th-top");
    var head = el("div");
    head.appendChild(el("p", "eh-th-eyebrow", "Modo teatro"));
    var h2 = el("h2", null, heading());
    h2.id = "eh-th-title";
    head.appendChild(h2);
    var sub = [];
    if (films) sub.push(films + (films === 1 ? " filme" : " filmes") + " na fila, tocando um atrás do outro");
    if (cards) sub.push(cards + (cards === 1 ? " notícia sem filme" : " notícias sem filme") + " em card");
    head.appendChild(el("p", "eh-th-sub", sub.length ? sub.join(" · ") : "Nenhuma campanha nesta seleção."));
    top.appendChild(head);
    var close = el("button", "eh-th-close", "Fechar ✕");
    close.type = "button";
    close.addEventListener("click", closeTheater);
    top.appendChild(close);
    root.appendChild(top);

    var main = el("div", "eh-th-main");
    var stage = el("div", "eh-stage");
    var ytBox = el("div", "eh-stage-box");
    var vmBox = el("div", "eh-stage-box");
    var cardBox = el("article", "eh-stage-card");
    var endBox = el("div", "eh-stage-end");
    endBox.appendChild(el("p", null, "Fim da fila."));
    var again = el("button", null, "Assistir de novo");
    again.type = "button";
    again.addEventListener("click", function () { show(Math.max(0, nextFilm(0))); });
    endBox.appendChild(again);
    [ytBox, vmBox, cardBox, endBox].forEach(function (b) { b.hidden = true; stage.appendChild(b); });
    main.appendChild(stage);

    var now = el("div", "eh-now");
    var info = el("div", "eh-now-info");
    var count = el("span", "eh-now-count");
    var txt = el("div");
    var who = el("p", "eh-now-who");
    var title = el("p", "eh-now-title");
    var ag = el("p", "eh-now-ag");
    var popEl = el("p", "eh-now-pop");
    txt.appendChild(who); txt.appendChild(title); txt.appendChild(ag); txt.appendChild(popEl);
    info.appendChild(count); info.appendChild(txt);
    var ctrl = el("div", "eh-now-ctrl");
    var prev = el("button", null, "◀ Anterior"); prev.type = "button";
    var next = el("button", null, "Próximo ▶"); next.type = "button";
    var read = link(null, "Ler a matéria ↗", "#");
    prev.addEventListener("click", function () { show(th.idx - 1); });
    next.addEventListener("click", function () { show(th.idx + 1); });
    ctrl.appendChild(prev); ctrl.appendChild(next); ctrl.appendChild(read);
    now.appendChild(info); now.appendChild(ctrl);
    main.appendChild(now);
    var notice = el("p", "eh-th-notice");
    notice.setAttribute("role", "status");
    notice.hidden = true;
    main.appendChild(notice);
    if (entries.length) root.appendChild(main);

    var reel = el("div", "eh-reel");
    reel.setAttribute("aria-label", "Timeline das campanhas");
    if (entries.length) root.appendChild(reel);

    document.body.appendChild(root);
    th = {
      entries: entries, films: films, idx: 0, ended: false, token: 0, yt: null, vm: null,
      root: root, ytBox: ytBox, vmBox: vmBox, cardBox: cardBox, endBox: endBox,
      count: count, who: who, title: title, ag: ag, pop: popEl, prev: prev, next: next, read: read, notice: notice, reel: reel,
      opener: document.activeElement, overflow: document.body.style.overflow
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    close.focus();

    if (!entries.length) return;
    var start = -1;
    if (startId) start = entries.findIndex(function (e) { return e.c.id === startId; });
    if (start < 0) start = nextFilm(0);
    show(start < 0 ? 0 : start);
  }

  function onKey(e) { if (e.key === "Escape") closeTheater(); }

  function closeTheater() {
    if (!th) return;
    try { if (th.yt) th.yt.destroy(); } catch (e) { /* já destruído */ }
    stopVimeo();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = th.overflow;
    th.root.remove();
    var opener = th.opener;
    th = null;
    if (opener && opener.focus) opener.focus();
  }

  function stopVimeo() {
    if (!th) return;
    if (th.vm) { th.vm.destroy().catch(function () {}); th.vm = null; }
    th.vmBox.textContent = "";
  }

  function advance() {
    if (!th) return;
    var n = nextFilm(th.idx + 1);
    if (n >= 0) show(n);
    else { th.ended = true; paint(); }
  }

  function fail() {
    if (!th) return;
    var e = th.entries[th.idx];
    th.notice.textContent = e.c.brand + ": este filme não pode tocar fora do " + (e.kind === "yt" ? "YouTube" : "Vimeo") + ". Pulei para o próximo.";
    th.notice.hidden = false;
    advance();
  }

  function show(i) {
    if (!th) return;
    i = Math.max(0, Math.min(th.entries.length - 1, i));
    th.idx = i;
    th.ended = false;
    th.notice.hidden = true;
    var token = ++th.token;
    var e = th.entries[i];
    paint();

    if (e.kind === "card") {
      if (th.yt) th.yt.pauseVideo();
      stopVimeo();
      return;
    }
    if (e.kind === "yt") {
      stopVimeo();
      loadYouTube().then(function (YT) {
        if (!th || token !== th.token) return;
        if (th.yt) { th.yt.loadVideoById(e.id); return; }
        var mount = el("div");
        th.ytBox.appendChild(mount);
        th.yt = new YT.Player(mount, {
          videoId: e.id, width: "100%", height: "100%",
          playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
          events: {
            onReady: function (ev) { ev.target.playVideo(); },
            onStateChange: function (ev) { if (ev.data === 0) advance(); },
            onError: function () { fail(); }
          }
        });
      }).catch(function () { if (th && token === th.token) fail(); });
      return;
    }
    if (th.yt) th.yt.pauseVideo();
    loadVimeo().then(function (Vimeo) {
      if (!th || token !== th.token) return;
      stopVimeo();
      var mount = el("div");
      th.vmBox.appendChild(mount);
      var p = new Vimeo.Player(mount, { url: e.url, autoplay: true, playsinline: true, dnt: true });
      th.vm = p;
      p.on("ended", function () { if (th && token === th.token) advance(); });
      p.ready().catch(function () { if (th && token === th.token) fail(); });
    }).catch(function () { if (th && token === th.token) fail(); });
  }

  // Atualiza palco, informações, botões e timeline para o item da vez.
  function paint() {
    var e = th.entries[th.idx];
    var c = e.c;
    th.ytBox.hidden = e.kind !== "yt";
    th.vmBox.hidden = e.kind !== "vimeo";
    th.cardBox.hidden = e.kind !== "card";
    th.endBox.hidden = !th.ended;
    if (e.kind === "card") fillStageCard(c);

    th.count.textContent = pad(th.idx + 1) + " / " + pad(th.entries.length);
    th.who.textContent = flagOf(c.cc) + " " + c.brand +
      (e.parts > 1 ? " · filme " + e.part + " de " + e.parts : "") +
      (e.kind === "card" ? " · sem filme" : "");
    th.title.textContent = c.title;
    th.ag.textContent = c.agency;
    th.ag.hidden = !c.agency;
    fillPop(th.pop, e);
    th.prev.disabled = th.idx === 0;
    th.next.disabled = th.idx >= th.entries.length - 1;
    th.read.hidden = !c.url;
    if (c.url) th.read.href = c.url;

    th.reel.textContent = "";
    var lastDay = "";
    th.entries.forEach(function (x, i) {
      var groupEl = el("div", "eh-reel-group");
      var firstOfDay = x.c.date !== lastDay;
      if (firstOfDay) {
        lastDay = x.c.date;
        var nDay = {};
        th.entries.forEach(function (e) { if (e.c.date === x.c.date) nDay[e.c.id] = 1; });
        var d = el("div", "eh-reel-day" + (x.c.date === state.today ? " eh-reel-today" : ""));
        d.setAttribute("aria-label", fullDay(x.c.date));
        d.appendChild(el("span", "eh-rd-wd", x.c.date === state.today ? "Hoje" : weekday(x.c.date)));
        d.appendChild(el("b", null, x.c.date.slice(8)));
        d.appendChild(el("span", "eh-rd-mo", fmtMonthShort.format(toDate(x.c.date)).replace(".", "")));
        d.appendChild(el("span", "eh-rd-n", plural(Object.keys(nDay).length)));
        groupEl.appendChild(d);
      }
      var isCard = x.kind === "card";
      var t = el("button", isCard ? "eh-tile eh-tile-card" : "eh-tile");
      t.type = "button";
      if (i === th.idx) t.setAttribute("aria-current", "true");
      t.appendChild(el("span", "eh-tile-n", pad(i + 1)));
      t.appendChild(el("span", "eh-tile-who", flagOf(x.c.cc) + " " + x.c.brand));
      t.appendChild(el("span", "eh-tile-title", x.c.title));
      t.appendChild(el("span", "eh-tile-ag", x.parts > 1 ? "Filme " + x.part + " de " + x.parts : (x.c.agency || x.c.source)));
      var tp = el("span", "eh-tile-pop");
      t.appendChild(tp);
      fillPop(tp, x);
      if (i === th.idx) t.appendChild(el("span", "eh-tile-live", isCard ? "Aberto" : th.ended ? "Terminou" : "Tocando"));
      else if (isCard) t.appendChild(el("span", "eh-tile-nofilm", "Sem filme"));
      t.addEventListener("click", function () { show(i); });
      groupEl.appendChild(t);
      th.reel.appendChild(groupEl);
      if (i === th.idx) {
        requestAnimationFrame(function () {
          var target = firstOfDay ? groupEl : t;
          var r = th.reel, box = target.getBoundingClientRect(), rb = r.getBoundingClientRect();
          var left = r.scrollLeft + box.left - rb.left - (firstOfDay ? 0 : Math.max(0, (rb.width - box.width) / 2));
          r.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
        });
      }
    });
  }

  function fillStageCard(c) {
    var box = th.cardBox;
    box.textContent = "";
    box.appendChild(el("p", "eh-sc-who", flagOf(c.cc) + " " + c.brand + (c.region ? " · " + c.region : "")));
    box.appendChild(el("h3", null, c.title));
    if (c.summary) box.appendChild(el("p", "eh-sc-sum", c.summary));
    var out = outsideFilm(c);
    box.appendChild(el("p", "eh-sc-meta",
      (c.agency ? "Agência: " + c.agency + " · " : "") +
      (out ? "O filme só toca no " + hostName(out) + "." : "Sem filme público encontrado.")));
    var actions = el("div", "eh-sc-actions");
    if (out) actions.appendChild(link(null, "Ver o filme no " + hostName(out) + " ↗", out));
    if (c.url) actions.appendChild(link(null, "Ler em " + (c.source || "fonte") + " ↗", c.url));
    if (th.films) {
      var cont = el("button", null, "Continuar a fila ▶");
      cont.type = "button";
      cont.addEventListener("click", advance);
      actions.appendChild(cont);
    }
    box.appendChild(actions);
  }

  /* ---------- Modo teatro no celular: feed vertical, um filme por tela ---------- */
  var MOBILE = window.matchMedia("(max-width: 700px)");
  var fd = null;

  function openFeed(startId) {
    if (fd) closeFeed();
    var entries = entriesFor(viewItems());
    var root = el("div", "eh-feed");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Modo teatro: " + heading());

    var bar = el("div", "eh-fd-bar");
    var titleBox = el("div", "eh-fd-head");
    titleBox.appendChild(el("span", "eh-fd-eyebrow", "Modo teatro"));
    titleBox.appendChild(el("span", "eh-fd-h", heading()));
    bar.appendChild(titleBox);
    var sound = el("button", "eh-fd-btn", "🔇 Som");
    sound.type = "button";
    var close = el("button", "eh-fd-btn", "📅 Dias");
    close.type = "button";
    close.setAttribute("aria-label", "Fechar o feed e escolher um dia");
    bar.appendChild(sound);
    bar.appendChild(close);
    root.appendChild(bar);

    var slides = [];
    var intro = el("section", "eh-fs eh-fs-intro");
    var ib = el("div", "eh-fs-introin");
    ib.appendChild(el("span", "eh-fs-introkick", "Todo dia, o mundo inteiro"));
    ib.appendChild(el("h1", null, "Estreou Hoje"));
    ib.appendChild(el("p", null, "As campanhas publicitárias que acabaram de estrear em agências e marcas do mundo todo, numa fila só. Os filmes tocam aqui, um atrás do outro, com quantas pessoas já viram cada um."));
    ib.appendChild(el("p", "eh-fs-introsub", plural(Object.keys(viewItems().reduce(function (m, c) { m[c.id] = 1; return m; }, {})).length) + " · " + heading().toLowerCase()));
    ib.appendChild(el("span", "eh-fs-hint", "Deslize para cima ↑"));
    intro.appendChild(ib);
    root.appendChild(intro);
    slides.push({ kind: "intro", node: intro });
    var lastDay = "";
    var perDay = {};
    entries.forEach(function (e) { (perDay[e.c.date] = perDay[e.c.date] || {})[e.c.id] = 1; });
    entries.forEach(function (e) {
      if (e.c.date !== lastDay) {
        lastDay = e.c.date;
        var d = el("section", "eh-fs eh-fs-day");
        var inner = el("div", "eh-fs-dayin");
        inner.appendChild(el("span", "eh-fs-wd", e.c.date === state.today ? "Hoje" : weekday(e.c.date)));
        inner.appendChild(el("b", null, e.c.date.slice(8)));
        inner.appendChild(el("span", "eh-fs-mo", fmtMonthShort.format(toDate(e.c.date)).replace(".", "")));
        inner.appendChild(el("span", "eh-fs-n", plural(Object.keys(perDay[e.c.date]).length)));
        inner.appendChild(el("span", "eh-fs-hint", "Deslize para cima ↑"));
        d.appendChild(inner);
        root.appendChild(d);
        slides.push({ kind: "day", node: d, e: e });
      }
      slides.push(buildSlide(e, root));
    });
    if (!entries.length) {
      var empty = el("section", "eh-fs eh-fs-day");
      empty.appendChild(el("p", "eh-fs-empty", "Nenhuma campanha nesta seleção."));
      root.appendChild(empty);
    }

    document.body.appendChild(root);
    fd = { root: root, slides: slides, cur: -1, player: null, kind: "", timer: null, sound: false, soundBtn: sound,
      opener: document.activeElement, overflow: document.body.style.overflow, token: 0 };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onFeedKey);
    close.addEventListener("click", closeFeed);
    sound.addEventListener("click", function () { setSound(!fd.sound); });

    fd.io = new IntersectionObserver(function (list) {
      list.forEach(function (it) {
        if (it.isIntersecting && it.intersectionRatio >= 0.6) activate(slides.findIndex(function (s) { return s.node === it.target; }));
      });
    }, { root: root, threshold: [0.6] });
    slides.forEach(function (s) { fd.io.observe(s.node); });

    var start = -1;
    if (startId) start = slides.findIndex(function (s) { return s.e && s.e.c.id === startId && s.kind !== "day"; });
    if (start < 0) start = 0;
    if (start > 0) slides[start].node.scrollIntoView();
  }

  function buildSlide(e, root) {
    var c = e.c;
    var isCard = e.kind === "card";
    var s = el("section", "eh-fs" + (isCard ? " eh-fs-card" : ""));
    if (e.kind === "yt") {
      var bg = el("div", "eh-fs-bg");
      bg.style.backgroundImage = "url(https://i.ytimg.com/vi/" + e.id + "/hqdefault.jpg)";
      s.appendChild(bg);
    }
    var media = null, tap = null, prog = null;
    if (!isCard) {
      media = el("div", "eh-fs-media");
      if (e.kind === "yt") {
        var poster = el("img", "eh-fs-poster");
        poster.src = "https://i.ytimg.com/vi/" + e.id + "/hqdefault.jpg";
        poster.alt = "";
        poster.loading = "lazy";
        media.appendChild(poster);
      }
      var mount = el("div", "eh-fs-mount");
      media.appendChild(mount);
      tap = el("button", "eh-fs-tap");
      tap.type = "button";
      tap.setAttribute("aria-label", "Tocar ou pausar");
      media.appendChild(tap);
      prog = el("div", "eh-fs-prog");
      prog.appendChild(el("i"));
      media.appendChild(prog);
      s.appendChild(media);
    } else {
      var box = el("div", "eh-fs-cardbox");
      box.appendChild(el("span", "eh-fs-nofilm", "Sem filme"));
      box.appendChild(el("h3", null, c.title));
      if (c.summary) box.appendChild(el("p", null, c.summary));
      var out = outsideFilm(c);
      if (out) box.appendChild(link("eh-fs-out", "Ver o filme no " + hostName(out) + " ↗", out));
      s.appendChild(box);
    }

    var info = el("div", "eh-fs-info");
    info.appendChild(el("span", "eh-fs-date", (c.date === state.today ? "Hoje" : weekday(c.date)) + " · " + c.date.slice(8) + " " + fmtMonthShort.format(toDate(c.date)).replace(".", "")));
    info.appendChild(el("p", "eh-fs-who", flagOf(c.cc) + " " + c.brand + (e.parts > 1 ? " · filme " + e.part + " de " + e.parts : "")));
    if (!isCard) info.appendChild(el("p", "eh-fs-title", c.title));
    if (c.agency) info.appendChild(el("p", "eh-fs-ag", c.agency));
    var fp = el("p", "eh-fs-pop");
    info.appendChild(fp);
    fillPop(fp, e);
    if (c.url) info.appendChild(link("eh-fs-read", "Ler em " + (c.source || "fonte") + " ↗", c.url));
    s.appendChild(info);
    root.appendChild(s);
    var slide = { kind: e.kind, node: s, e: e, media: media, mount: mount, tap: tap, prog: prog };
    if (tap) tap.addEventListener("click", function () { togglePlay(slide); });
    return slide;
  }

  function stopPlayer() {
    if (!fd) return;
    fd.token++;
    clearInterval(fd.timer);
    var p = fd.player;
    fd.player = null;
    if (p) {
      try { if (fd.kind === "yt") p.destroy(); else p.destroy().catch(function () {}); } catch (err) { /* já destruído */ }
    }
    fd.slides.forEach(function (s) {
      if (s.mount) s.mount.textContent = "";
      if (s.node) s.node.classList.remove("eh-fs-on", "eh-fs-paused");
    });
  }

  function activate(i) {
    if (!fd || i < 0 || i === fd.cur) return;
    fd.cur = i;
    stopPlayer();
    var s = fd.slides[i];
    if (s.kind !== "yt" && s.kind !== "vimeo") return;
    var token = fd.token;
    var host = el("div");
    s.mount.appendChild(host);
    var ok = function () { return fd && token === fd.token; };
    var onEnd = function () { if (ok()) goNextFilm(); };
    if (s.kind === "yt") {
      loadYouTube().then(function (YT) {
        if (!ok()) return;
        fd.kind = "yt";
        fd.player = new YT.Player(host, {
          videoId: s.e.id, width: "100%", height: "100%",
          playerVars: { autoplay: 1, mute: fd.sound ? 0 : 1, playsinline: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0 },
          events: {
            onReady: function (ev) {
              if (!ok()) return;
              if (fd.sound) ev.target.unMute(); else ev.target.mute();
              ev.target.playVideo();
            },
            onStateChange: function (ev) {
              if (!ok()) return;
              if (ev.data === 1) { s.node.classList.add("eh-fs-on"); s.node.classList.remove("eh-fs-paused"); }
              if (ev.data === 2) s.node.classList.add("eh-fs-paused");
              if (ev.data === 0) onEnd();
            },
            onError: function () { if (ok()) s.node.classList.add("eh-fs-err"); }
          }
        });
        watchProgress(s, function () { return [fd.player.getCurrentTime(), fd.player.getDuration()]; });
      });
      return;
    }
    loadVimeo().then(function (Vimeo) {
      if (!ok()) return;
      fd.kind = "vimeo";
      var p = new Vimeo.Player(host, { url: s.e.url, autoplay: true, muted: !fd.sound, playsinline: true, controls: false, dnt: true });
      fd.player = p;
      p.on("play", function () { if (ok()) { s.node.classList.add("eh-fs-on"); s.node.classList.remove("eh-fs-paused"); } });
      p.on("pause", function () { if (ok()) s.node.classList.add("eh-fs-paused"); });
      p.on("ended", onEnd);
      p.on("timeupdate", function (d) { if (ok()) s.prog.firstChild.style.width = (d.percent * 100) + "%"; });
      p.ready().catch(function () { if (ok()) s.node.classList.add("eh-fs-err"); });
    });
  }

  function watchProgress(s, get) {
    clearInterval(fd.timer);
    var token = fd.token;
    fd.timer = setInterval(function () {
      if (!fd || token !== fd.token || !fd.player || !fd.player.getDuration) return;
      try {
        var t = get();
        if (t[1]) s.prog.firstChild.style.width = Math.min(100, t[0] / t[1] * 100) + "%";
      } catch (err) { /* player ainda carregando */ }
    }, 250);
  }

  function togglePlay(s) {
    if (!fd || fd.slides[fd.cur] !== s || !fd.player) return;
    if (fd.kind === "yt") {
      if (fd.player.getPlayerState && fd.player.getPlayerState() === 1) fd.player.pauseVideo();
      else fd.player.playVideo();
    } else {
      fd.player.getPaused().then(function (paused) { if (paused) fd.player.play(); else fd.player.pause(); });
    }
  }

  function setSound(on) {
    if (!fd) return;
    fd.sound = on;
    fd.soundBtn.textContent = on ? "🔊 Som" : "🔇 Som";
    fd.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (!fd.player) return;
    if (fd.kind === "yt") { if (on) fd.player.unMute(); else fd.player.mute(); fd.player.playVideo(); }
    else fd.player.setMuted(!on).catch(function () {});
  }

  function goNextFilm() {
    for (var i = fd.cur + 1; i < fd.slides.length; i++) {
      var k = fd.slides[i].kind;
      if (k === "yt" || k === "vimeo") { fd.slides[i].node.scrollIntoView({ behavior: "smooth" }); return; }
    }
  }

  function onFeedKey(e) {
    if (e.key === "Escape") closeFeed();
  }

  function closeFeed() {
    if (!fd) return;
    stopPlayer();
    fd.io.disconnect();
    document.removeEventListener("keydown", onFeedKey);
    document.body.style.overflow = fd.overflow;
    fd.root.remove();
    var opener = fd.opener;
    fd = null;
    if (opener && opener.focus) opener.focus();
  }

  /* ---------- Início ---------- */
  fromHash();
  fetch("campaigns.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(function (raw) {
      state.items = normalize(raw);
      state.loaded = true;
      var last = state.items.reduce(function (m, c) { return c.addedAt > m ? c.addedAt : m; }, "");
      var t = last ? new Date(last) : null;
      $("updated").textContent = t && !isNaN(t) ? "Atualizado em " + fmtStamp.format(t) + "." : "";
      var s = $("status");
      s.hidden = state.items.length > 0;
      s.textContent = "Ainda não há campanhas registradas.";
      render();
      // No celular o site já abre no feed; o botão "Dias" leva para o calendário.
      if (MOBILE.matches && state.items.length) openTheater(null);
    })
    .catch(function () {
      $("status").textContent = "Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.";
    });
})();
