/* AD Drop: vitrine estilo streaming (destaque, fileiras, ficha da campanha), calendário, filtros e modo teatro
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
        video: safeUrl(str(x.video)), image: safeUrl(str(x.image)), addedAt: str(x.addedAt)
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
  var REGIOES = [
    { nome: "Brasil", cc: ["BR"] },
    { nome: "América Latina", cc: ["MX", "AR", "CO", "CL", "PE", "EC", "UY", "PY", "BO", "VE", "CR", "PA", "GT", "DO", "PR", "SV", "HN", "NI", "CU"] },
    { nome: "EUA e Canadá", cc: ["US", "CA"] },
    { nome: "Europa", cc: ["GB", "IE", "FR", "DE", "ES", "PT", "IT", "NL", "SE", "NO", "DK", "FI", "PL", "BE", "CH", "AT", "CZ", "GR", "HU", "RO", "TR", "UA"], extra: ["Europa"] },
    { nome: "Ásia-Pacífico", cc: ["AU", "NZ", "IN", "SG", "JP", "KR", "CN", "HK", "TW", "TH", "MY", "ID", "PH", "VN", "PK", "BD", "LK"] }
  ];
  var OUTROS = "Global e outros";
  function regiaoDe(c) {
    for (var i = 0; i < REGIOES.length; i++) {
      var r = REGIOES[i];
      if (r.cc.indexOf(c.cc) >= 0 || (r.extra && r.extra.indexOf(c.region) >= 0)) return r.nome;
    }
    return OUTROS;
  }
  var state = { items: [], today: todayYmd(), sel: null, month: todayYmd().slice(0, 7), region: ALL, q: "", film: false, loaded: false };

  function norm(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function filtered() {
    var q = norm(state.q.trim());
    return state.items.filter(function (c) {
      if (state.sel && c.date !== state.sel) return false;
      if (state.region !== ALL && regiaoDe(c) !== state.region) return false;
      if (state.film && !isPlayable(c)) return false;
      if (q && norm([c.brand, c.title, c.agency, c.source, c.region, c.summary].join(" ")).indexOf(q) < 0) return false;
      return true;
    });
  }
  function isHome() { return !state.sel && state.region === ALL && !state.q.trim() && !state.film; }
  function byDay(list) {
    var m = {};
    list.forEach(function (c) { (m[c.date] = m[c.date] || []).push(c); });
    return m;
  }
  // Usado pelo modo teatro: o que está na tela agora.
  function viewItems() {
    if (!isHome()) return filtered();
    var from = shift(state.today, -5);
    return state.items.filter(function (c) { return c.date >= from && c.date <= state.today; });
  }
  function heading() {
    if (isHome()) return "Hoje e os últimos 5 dias";
    var p = [];
    if (state.sel) p.push(fullDay(state.sel));
    if (state.region !== ALL) p.push(state.region);
    if (state.film) p.push("só com filme");
    if (state.q.trim()) p.push("“" + state.q.trim() + "”");
    return p.join(" · ");
  }
  function relDay(d) {
    if (d === state.today) return "Hoje";
    if (d === shift(state.today, -1)) return "Ontem";
    var s = longDay(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------- Imagens ---------- */
  function ytThumb(id, big) { return "https://i.ytimg.com/vi/" + id + "/" + (big ? "maxresdefault" : "hqdefault") + ".jpg"; }
  function thumbOf(c, big) {
    if (c.yt.length) return ytThumb(c.yt[0], big);
    if (c.image) return c.image;
    var v = vimeoOf(c.video);
    if (v) return "https://vumbnail.com/" + v.id + (big ? "_large" : "") + ".jpg";
    return "";
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  // Capa gerada para campanhas sem imagem: nome da marca em tipografia grande.
  function poster(c) {
    var p = el("div", "ad-poster");
    var h = hue(c.brand || c.title);
    p.style.setProperty("--h1", h);
    p.style.setProperty("--h2", (h + 55) % 360);
    p.appendChild(el("span", "ad-poster-brand", c.brand || c.title));
    p.appendChild(el("span", "ad-poster-flag", flagOf(c.cc)));
    return p;
  }
  function media(c, big) {
    var box = el("div", "ad-media");
    var src = thumbOf(c, big);
    if (!src) { box.appendChild(poster(c)); return box; }
    var img = el("img");
    img.alt = "";
    img.loading = big ? "eager" : "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = src;
    img.addEventListener("load", function () {
      // a "maxresdefault" que não existe vem como uma imagem cinza de 120px
      if (big && c.yt.length && img.naturalWidth <= 120) { img.src = ytThumb(c.yt[0], false); return; }
      box.classList.add("ad-loaded");
    });
    img.addEventListener("error", function () {
      if (big && c.yt.length && img.src.indexOf("maxres") > 0) { img.src = ytThumb(c.yt[0], false); return; }
      img.remove(); box.appendChild(poster(c));
      if (box.parentNode && box.parentNode.classList) box.parentNode.classList.add("ad-noimg");
    });
    box.appendChild(img);
    return box;
  }

  /* ---------- Cartão ---------- */
  function card(c) {
    var b = el("button", "ad-card");
    b.type = "button";
    b.setAttribute("aria-label", (c.brand ? c.brand + ": " : "") + c.title);
    b.appendChild(media(c, false));
    if (!thumbOf(c, false)) b.classList.add("ad-noimg");
    if (isPlayable(c)) b.appendChild(el("span", "ad-play", "▶"));
    if (c.date === state.today) b.appendChild(el("span", "ad-new", "Novo"));
    var cap = el("div", "ad-cap");
    var top = el("div", "ad-cap-top");
    top.appendChild(el("span", "ad-flag", flagOf(c.cc)));
    if (c.brand) top.appendChild(el("span", "ad-cap-brand", c.brand));
    cap.appendChild(top);
    cap.appendChild(el("span", "ad-cap-title", c.title));
    var meta = el("span", "ad-cap-meta", [c.agency, c.source].filter(Boolean).join(" · "));
    cap.appendChild(meta);
    b.appendChild(cap);
    b.addEventListener("click", function () { openInfo(c, b); });
    return b;
  }

  /* ---------- Fileiras ---------- */
  function row(title, list, opts) {
    opts = opts || {};
    var s = el("section", "ad-row");
    var h = el("div", "ad-row-head");
    var h2 = el("h2", null, title);
    h.appendChild(h2);
    if (opts.sub) h.appendChild(el("span", "ad-row-sub", opts.sub));
    if (opts.all) {
      var all = el("button", "ad-row-all", "Ver tudo ›");
      all.type = "button";
      all.addEventListener("click", opts.all);
      h.appendChild(all);
    }
    s.appendChild(h);
    var wrap = el("div", "ad-track-wrap");
    var track = el("div", "ad-track");
    list.forEach(function (c) { track.appendChild(card(c)); });
    var prev = el("button", "ad-arrow ad-prev", "‹"), next = el("button", "ad-arrow ad-next", "›");
    prev.type = next.type = "button";
    prev.setAttribute("aria-label", "Anteriores");
    next.setAttribute("aria-label", "Próximos");
    function step(dir) { track.scrollBy({ left: dir * track.clientWidth * 0.9, behavior: "smooth" }); }
    prev.addEventListener("click", function () { step(-1); });
    next.addEventListener("click", function () { step(1); });
    function arrows() {
      prev.hidden = track.scrollLeft < 8;
      next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    }
    track.addEventListener("scroll", arrows, { passive: true });
    requestAnimationFrame(arrows);
    wrap.appendChild(prev); wrap.appendChild(track); wrap.appendChild(next);
    s.appendChild(wrap);
    return s;
  }

  /* ---------- Destaque (hero) ---------- */
  var hero = { list: [], i: 0, timer: null, preview: null };
  function pickHero() {
    var from = shift(state.today, -3), seen = {}, out = [];
    var pool = state.items.filter(function (c) { return c.yt.length && c.date >= from; });
    if (pool.length < 3) pool = state.items.filter(function (c) { return c.yt.length; });
    pool.forEach(function (c) {
      var k = norm(c.brand);
      if (out.length < 6 && !seen[k]) { seen[k] = 1; out.push(c); }
    });
    return out;
  }
  function renderHero() {
    var box = $("hero");
    clearTimeout(hero.timer); clearTimeout(hero.preview);
    box.textContent = "";
    box.hidden = !isHome() || !hero.list.length;
    if (box.hidden) return;
    var c = hero.list[hero.i];
    var bg = media(c, true);
    bg.classList.add("ad-hero-bg");
    box.appendChild(bg);
    box.appendChild(el("div", "ad-hero-shade"));
    var info = el("div", "ad-hero-info");
    var eye = el("p", "ad-hero-eye");
    eye.appendChild(el("span", "ad-pill", c.date === state.today ? "Estreou hoje" : relDay(c.date)));
    eye.appendChild(document.createTextNode(flagOf(c.cc) + " " + (c.region || "")));
    info.appendChild(eye);
    var h1 = el("h1", "ad-hero-brand", c.brand || c.title);
    var n = (c.brand || c.title).length;
    h1.style.setProperty("--k", (n <= 6 ? 11 : n <= 10 ? 8.5 : n <= 16 ? 6.5 : 5) + "vw");
    h1.style.setProperty("--max", (n <= 6 ? 150 : n <= 10 ? 120 : n <= 16 ? 92 : 72) + "px");
    info.appendChild(h1);
    if (c.brand) info.appendChild(el("p", "ad-hero-title", c.title));
    var meta = [c.agency && "Agência " + c.agency, c.source].filter(Boolean).join(" · ");
    if (meta) info.appendChild(el("p", "ad-hero-meta", meta));
    if (c.summary) info.appendChild(el("p", "ad-hero-sum", c.summary));
    var acts = el("div", "ad-hero-acts");
    var play = el("button", "ad-btn ad-btn-play", "▶ Assistir");
    play.type = "button";
    play.addEventListener("click", function () { openTheater(c.id); });
    var more = el("button", "ad-btn ad-btn-ghost", "ⓘ Mais informações");
    more.type = "button";
    more.addEventListener("click", function () { openInfo(c, more); });
    acts.appendChild(play); acts.appendChild(more);
    info.appendChild(acts);
    box.appendChild(info);
    if (hero.list.length > 1) {
      var dots = el("div", "ad-hero-dots");
      hero.list.forEach(function (x, i) {
        var d = el("button", i === hero.i ? "ad-dot ad-dot-on" : "ad-dot");
        d.type = "button";
        d.setAttribute("aria-label", "Destaque " + (i + 1) + ": " + (x.brand || x.title));
        d.addEventListener("click", function () { hero.i = i; renderHero(); });
        dots.appendChild(d);
      });
      box.appendChild(dots);
    }
    // No computador, depois de um instante o filme começa a tocar mudo no fundo.
    var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!MOBILE.matches && !calm) {
      hero.preview = setTimeout(function () {
        if (th || fd || cn || document.hidden) return;
        var f = el("iframe", "ad-hero-video");
        var id = c.yt[0];
        f.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&mute=1&controls=0&loop=1&playlist=" + id + "&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1";
        f.allow = "autoplay; encrypted-media";
        f.tabIndex = -1;
        f.setAttribute("aria-hidden", "true");
        f.addEventListener("load", function () { setTimeout(function () { f.classList.add("ad-on"); }, 900); });
        bg.appendChild(f);
      }, 2500);
    }
    hero.timer = setTimeout(function () {
      if (th || fd || cn || document.hidden || !isHome()) return;
      hero.i = (hero.i + 1) % hero.list.length;
      renderHero();
    }, 16000);
  }

  /* ---------- Página inicial e resultados ---------- */
  var moreIO = null, homeCursor = null, gridList = [], gridShown = 0;
  function stopMore() { if (moreIO) { moreIO.disconnect(); moreIO = null; } }
  function sentinel(box, fn) {
    var s = el("div", "ad-sentinel");
    box.appendChild(s);
    if ("IntersectionObserver" in window) {
      moreIO = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { stopMore(); s.remove(); fn(); }
      }, { rootMargin: "900px 0px" });
      moreIO.observe(s);
    } else {
      var b = el("button", "ad-more", "Carregar mais");
      b.type = "button";
      b.addEventListener("click", function () { s.remove(); fn(); });
      s.appendChild(b);
    }
  }

  function renderHome(box) {
    var map = byDay(state.items);
    var today = map[state.today] || [];
    var yest = map[shift(state.today, -1)] || [];
    if (today.length) box.appendChild(row("Estreou hoje", today, { sub: plural(today.length), all: function () { go(state.today); } }));
    else box.appendChild(row("Últimas estreias", state.items.slice(0, 24)));
    if (yest.length) box.appendChild(row("Ontem", yest, { sub: plural(yest.length), all: function () { go(shift(state.today, -1)); } }));
    var films = state.items.filter(function (c) { return isPlayable(c) && c.date >= shift(state.today, -6); }).slice(0, 30);
    if (films.length >= 4) box.appendChild(row("Filmes da semana", films, { sub: "para assistir em sequência", all: function () { state.film = true; render(); } }));
    var recent = state.items.filter(function (c) { return c.date >= shift(state.today, -13); });
    REGIOES.forEach(function (r) {
      var l = recent.filter(function (c) { return regiaoDe(c) === r.nome; }).slice(0, 30);
      if (l.length >= 3) box.appendChild(row(r.nome, l, { sub: "últimas duas semanas", all: function () { state.region = r.nome; render(); } }));
    });
    homeCursor = shift(state.today, -2);
    moreDays(box, map);
  }
  function moreDays(box, map) {
    var oldest = state.items.length ? state.items[state.items.length - 1].date : state.today;
    var added = 0;
    while (homeCursor >= oldest && added < 5) {
      var d = homeCursor, l = map[d] || [];
      homeCursor = shift(homeCursor, -1);
      if (!l.length) continue;
      box.appendChild(row(relDay(d), l, { sub: plural(l.length), all: (function (day) { return function () { go(day); }; })(d) }));
      added++;
    }
    if (homeCursor >= oldest) sentinel(box, function () { moreDays(box, map); });
    else box.appendChild(el("p", "ad-end", "Início do arquivo: " + fullDay(oldest) + "."));
  }

  function renderGrid(box) {
    gridList = filtered();
    gridShown = 0;
    var head = el("div", "ad-grid-head");
    var t = el("div");
    t.appendChild(el("p", "ad-grid-eye", state.sel ? relDay(state.sel) : "Resultados"));
    t.appendChild(el("h1", "ad-grid-title", heading()));
    t.appendChild(el("p", "ad-grid-sub", gridList.length ? plural(gridList.length) : "Nenhuma campanha encontrada."));
    head.appendChild(t);
    var acts = el("div", "ad-grid-acts");
    if (state.sel) {
      var prev = el("button", "ad-btn ad-btn-ghost ad-btn-sm", "‹ Dia anterior");
      prev.type = "button";
      prev.addEventListener("click", function () { go(shift(state.sel, -1)); });
      acts.appendChild(prev);
      if (state.sel < state.today) {
        var nx = el("button", "ad-btn ad-btn-ghost ad-btn-sm", "Dia seguinte ›");
        nx.type = "button";
        nx.addEventListener("click", function () { go(shift(state.sel, 1)); });
        acts.appendChild(nx);
      }
    }
    if (gridList.length) {
      var play = el("button", "ad-btn ad-btn-play ad-btn-sm", "▶ Assistir tudo");
      play.type = "button";
      play.addEventListener("click", function () { openTheater(null); });
      acts.appendChild(play);
    }
    var clear = el("button", "ad-btn ad-btn-ghost ad-btn-sm", "✕ Voltar ao início");
    clear.type = "button";
    clear.addEventListener("click", clearAll);
    acts.appendChild(clear);
    head.appendChild(acts);
    box.appendChild(head);
    var grid = el("div", "ad-grid");
    box.appendChild(grid);
    moreGrid(box, grid);
  }
  function moreGrid(box, grid) {
    gridList.slice(gridShown, gridShown + 48).forEach(function (c) { grid.appendChild(card(c)); });
    gridShown += 48;
    if (gridShown < gridList.length) sentinel(box, function () { moreGrid(box, grid); });
  }

  /* ---------- Filtros (barra de cima) ---------- */
  function renderChips() {
    var box = $("chips");
    box.textContent = "";
    function chip(label, on, fn) {
      var b = el("button", "ad-chip", label);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", fn);
      box.appendChild(b);
    }
    chip("Tudo", isHome(), clearAll);
    chip("▶ Com filme", state.film, function () { state.film = !state.film; render(); });
    REGIOES.concat([{ nome: OUTROS }]).forEach(function (r) {
      chip(r.nome, state.region === r.nome, function () { state.region = state.region === r.nome ? ALL : r.nome; render(); });
    });
  }

  function renderCal() {
    var map = byDay(state.items);
    var month = state.month;
    $("cal-title").textContent = monthName(month);
    var g = $("cal");
    g.textContent = "";
    ["D", "S", "T", "Q", "Q", "S", "S"].forEach(function (d) { g.appendChild(el("div", "ad-dow", d)); });
    var first = toDate(month + "-01");
    for (var k = 0; k < first.getUTCDay(); k++) g.appendChild(el("div"));
    var days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    for (var d = 1; d <= days; d++) {
      (function (day, d) {
        var n = (map[day] || []).length;
        var c = el("button", "ad-cell" + (n ? " ad-has" : "") + (day === state.today ? " ad-today" : ""), String(d));
        c.type = "button";
        c.disabled = day > state.today;
        c.setAttribute("aria-pressed", state.sel === day ? "true" : "false");
        c.setAttribute("aria-label", fullDay(day) + (n ? ", " + plural(n) : ""));
        c.addEventListener("click", function () { toggleCal(false); go(day); });
        g.appendChild(c);
      })(month + "-" + pad(d), d);
    }
    var next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    $("next").disabled = next > state.today;
  }
  function toggleCal(open) {
    var p = $("calpop");
    if (open === undefined) open = p.hidden;
    p.hidden = !open;
    $("open-cal").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderCal();
  }

  var lastHome = null;
  function render() {
    stopMore();
    renderChips();
    var box = $("feed");
    box.textContent = "";
    if (!state.loaded) return;
    if (isHome()) {
      if (!hero.list.length) hero.list = pickHero();
      renderHero();
      renderHome(box);
    } else {
      renderHero();
      renderGrid(box);
    }
    if (lastHome !== isHome()) { window.scrollTo(0, 0); lastHome = isHome(); }
  }
  function clearAll() {
    state.region = ALL; state.film = false; state.q = ""; $("q").value = "";
    if (state.sel) go(null); else render();
    window.scrollTo(0, 0);
  }
  function go(day) {
    state.sel = day;
    if (day) state.month = day.slice(0, 7);
    var h = day ? "#dia-" + day : "";
    if (location.hash !== h) {
      if (h) location.hash = h;
      else history.replaceState(null, "", location.pathname + location.search);
    }
    render();
    window.scrollTo(0, 0);
  }
  function fromHash() {
    state.today = todayYmd();
    var m = /^#dia-(\d{4}-\d{2}-\d{2})$/.exec(location.hash || "");
    var day = m && isDay(m[1]) && m[1] <= state.today ? m[1] : null;
    state.sel = day;
    if (day) state.month = day.slice(0, 7);
    render();
  }

  /* ---------- Ficha da campanha ("Mais informações") ---------- */
  var info = null;
  function openInfo(c, opener) {
    closeInfo();
    var root = el("div", "ad-modal");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", (c.brand ? c.brand + ": " : "") + c.title);
    var panel = el("div", "ad-modal-panel");
    var top = el("div", "ad-modal-media");
    top.appendChild(media(c, true));
    top.appendChild(el("div", "ad-modal-shade"));
    var x = el("button", "ad-modal-x", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "Fechar");
    x.addEventListener("click", closeInfo);
    top.appendChild(x);
    var head = el("div", "ad-modal-head");
    head.appendChild(el("h2", "ad-modal-brand", c.brand || c.title));
    var acts = el("div", "ad-hero-acts");
    if (isPlayable(c)) {
      var play = el("button", "ad-btn ad-btn-play", "▶ Assistir");
      play.type = "button";
      play.addEventListener("click", function () { closeInfo(); openTheater(c.id); });
      acts.appendChild(play);
    }
    var out = outsideFilm(c);
    if (out) acts.appendChild(link("ad-btn ad-btn-ghost", "Ver o filme no " + hostName(out) + " ↗", out));
    if (c.url) acts.appendChild(link("ad-btn ad-btn-ghost", "Ler em " + (c.source || "fonte") + " ↗", c.url));
    head.appendChild(acts);
    top.appendChild(head);
    panel.appendChild(top);
    var body = el("div", "ad-modal-body");
    var main = el("div");
    var tags = el("p", "ad-modal-tags");
    tags.appendChild(el("span", "ad-pill", relDay(c.date)));
    tags.appendChild(document.createTextNode(fullDay(c.date)));
    main.appendChild(tags);
    if (c.brand) main.appendChild(el("h3", "ad-modal-title", c.title));
    if (c.summary) main.appendChild(el("p", "ad-modal-sum", c.summary));
    if (c.yt.length) {
      var pop = el("p", "ad-modal-pop");
      main.appendChild(pop);
      popOf(c.yt[0]).then(function (v) { pop.textContent = popText(v, c.date); });
    }
    body.appendChild(main);
    var side = el("dl", "ad-modal-side");
    [["Marca", c.brand], ["Agência", c.agency], ["Origem", c.region ? flagOf(c.cc) + " " + c.region : ""], ["Fonte", c.source],
     ["Filmes", c.yt.length > 1 ? c.yt.length + " filmes" : ""]].forEach(function (p) {
      if (!p[1]) return;
      side.appendChild(el("dt", null, p[0]));
      side.appendChild(el("dd", null, p[1]));
    });
    body.appendChild(side);
    panel.appendChild(body);
    var same = state.items.filter(function (o) { return o.date === c.date && o.id !== c.id; }).slice(0, 9);
    if (same.length) {
      var more = el("div", "ad-modal-more");
      more.appendChild(el("h3", null, "Estrearam no mesmo dia"));
      var g = el("div", "ad-modal-grid");
      same.forEach(function (o) { g.appendChild(card(o)); });
      more.appendChild(g);
      panel.appendChild(more);
    }
    root.appendChild(panel);
    root.addEventListener("click", function (e) { if (e.target === root) closeInfo(); });
    document.body.appendChild(root);
    info = { root: root, opener: opener, overflow: document.body.style.overflow };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onInfoKey);
    requestAnimationFrame(function () { root.classList.add("ad-open"); x.focus(); });
  }
  function onInfoKey(e) { if (e.key === "Escape") closeInfo(); }
  function closeInfo() {
    if (!info) return;
    document.removeEventListener("keydown", onInfoKey);
    document.body.style.overflow = info.overflow;
    info.root.remove();
    var o = info.opener;
    info = null;
    if (o && o.focus && document.body.contains(o)) o.focus({ preventScroll: true });
  }

  /* ---------- Barra de cima ---------- */
  $("open-cal").addEventListener("click", function (e) { e.stopPropagation(); toggleCal(); });
  document.addEventListener("click", function (e) {
    var p = $("calpop");
    if (!p.hidden && !p.contains(e.target)) toggleCal(false);
  });
  $("prev").addEventListener("click", function () {
    var f = toDate(state.month + "-01");
    state.month = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    renderCal();
  });
  $("next").addEventListener("click", function () {
    var f = toDate(state.month + "-01");
    state.month = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    renderCal();
  });
  $("logo").addEventListener("click", function (e) { e.preventDefault(); clearAll(); });
  var qTimer = null;
  $("q").addEventListener("input", function () {
    clearTimeout(qTimer);
    var v = this.value;
    qTimer = setTimeout(function () { state.q = v; render(); }, 220);
  });
  $("open-theater").addEventListener("click", function () { openTheater(null); });
  window.addEventListener("hashchange", fromHash);
  window.addEventListener("scroll", function () {
    $("nav").classList.toggle("ad-nav-solid", window.scrollY > 24);
  }, { passive: true });

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
    if (openCinema(startId)) return;
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
          if (!th) return;
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
    ib.appendChild(el("h1", null, "AD Drop"));
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

  /* ---------- Cinema: modo teatro em tela cheia, 16:9, abre junto com o site ---------- */
  var cn = null;
  function cinemaEntries() {
    return entriesFor(viewItems()).filter(function (e) { return e.kind !== "card"; });
  }
  function openCinema(startId) {
    if (cn) closeCinema(true);
    closeInfo();
    var entries = cinemaEntries();
    if (!entries.length) return false;
    var start = 0;
    if (startId) entries.forEach(function (e, i) { if (e.c.id === startId && !start && e.part === 1) start = i; });

    var root = el("div", "cn");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Modo teatro");

    var bg = el("div", "cn-bg");
    var stage = el("div", "cn-stage");
    var frame = el("div", "cn-frame");
    var host = el("div", "cn-host");
    frame.appendChild(host);
    var poster = el("div", "cn-poster");
    frame.appendChild(poster);
    var spin = el("div", "cn-spin");
    frame.appendChild(spin);
    var hit = el("button", "cn-hit");
    hit.type = "button";
    hit.setAttribute("aria-label", "Pausar ou continuar");
    frame.appendChild(hit);
    var paused = el("div", "cn-paused", "❚❚");
    frame.appendChild(paused);
    stage.appendChild(frame);

    var shade = el("div", "cn-shade");

    var top = el("div", "cn-top");
    var logo = el("span", "ad-logo cn-logo");
    logo.innerHTML = "AD<span>Drop</span>";
    top.appendChild(logo);
    var where = el("span", "cn-where");
    top.appendChild(where);
    var acts = el("div", "cn-top-acts");
    var sound = el("button", "cn-btn cn-sound", "🔇 Ativar som");
    sound.type = "button";
    var exit = el("button", "cn-btn cn-exit");
    exit.type = "button";
    exit.appendChild(document.createTextNode("Ver tudo "));
    exit.appendChild(el("kbd", null, "Esc"));
    acts.appendChild(sound); acts.appendChild(exit);
    top.appendChild(acts);

    var info = el("div", "cn-info");
    var bottom = el("div", "cn-bottom");
    var prog = el("div", "cn-prog");
    prog.appendChild(el("i"));
    var ctrl = el("div", "cn-ctrl");
    var prev = el("button", "cn-round", "⏮");
    var play = el("button", "cn-round cn-play", "❚❚");
    var next = el("button", "cn-round", "⏭");
    [prev, play, next].forEach(function (b) { b.type = "button"; ctrl.appendChild(b); });
    prev.setAttribute("aria-label", "Filme anterior");
    play.setAttribute("aria-label", "Pausar ou continuar");
    next.setAttribute("aria-label", "Próximo filme");
    var count = el("span", "cn-count");
    ctrl.appendChild(count);
    var upLabel = el("span", "cn-up-label", "A seguir");
    ctrl.appendChild(upLabel);
    var strip = el("div", "cn-strip");
    bottom.appendChild(prog); bottom.appendChild(ctrl); bottom.appendChild(strip);

    root.appendChild(bg); root.appendChild(stage); root.appendChild(shade);
    root.appendChild(top); root.appendChild(info); root.appendChild(bottom);
    document.body.appendChild(root);

    cn = { root: root, entries: entries, i: start, bg: bg, host: host, poster: poster, spin: spin, info: info, strip: strip,
           prog: prog, where: where, count: count, sound: sound, playBtn: play, paused: paused,
           muted: true, player: null, kind: "", token: 0, timer: null, idle: null,
           overflow: document.body.style.overflow };
    document.body.style.overflow = "hidden";
    clearTimeout(hero.preview);
    var oldVideo = document.querySelector(".ad-hero-video");
    if (oldVideo) oldVideo.remove();

    exit.addEventListener("click", function () { closeCinema(); });
    sound.addEventListener("click", function () { setCinemaSound(cn.muted); });
    prev.addEventListener("click", function () { cinemaGo(cn.i - 1); });
    next.addEventListener("click", function () { cinemaGo(cn.i + 1); });
    play.addEventListener("click", cinemaToggle);
    hit.addEventListener("click", function () {
      // o primeiro toque liga o som (navegadores só deixam com um gesto da pessoa)
      if (cn.muted) setCinemaSound(true); else cinemaToggle();
    });
    document.addEventListener("keydown", onCinemaKey);
    root.addEventListener("mousemove", wake);
    root.addEventListener("touchstart", wake, { passive: true });
    wake();
    cinemaShow(start);
    requestAnimationFrame(function () { root.classList.add("cn-open"); });
    return true;
  }

  function wake() {
    if (!cn) return;
    cn.root.classList.remove("cn-idle");
    clearTimeout(cn.idle);
    cn.idle = setTimeout(function () { if (cn && !cn.root.classList.contains("cn-is-paused")) cn.root.classList.add("cn-idle"); }, 3500);
  }

  function onCinemaKey(e) {
    if (!cn || info) return;
    if (e.key === "Escape") { e.preventDefault(); closeCinema(); }
    else if (e.key === "ArrowRight") { cinemaGo(cn.i + 1); wake(); }
    else if (e.key === "ArrowLeft") { cinemaGo(cn.i - 1); wake(); }
    else if (e.key === " " || e.key === "k") { e.preventDefault(); cinemaToggle(); wake(); }
    else if (e.key === "m") setCinemaSound(cn.muted);
  }

  function cinemaGo(i) {
    if (!cn) return;
    if (i < 0) i = 0;
    if (i >= cn.entries.length) i = 0; // fim da fila: recomeça
    cinemaShow(i);
  }

  function cinemaInfo(e) {
    var c = e.c, box = cn.info;
    box.textContent = "";
    var eye = el("p", "ad-hero-eye");
    eye.appendChild(el("span", "ad-pill", c.date === state.today ? "Estreou hoje" : relDay(c.date)));
    eye.appendChild(document.createTextNode(flagOf(c.cc) + " " + (c.region || "") + (e.parts > 1 ? " · filme " + e.part + " de " + e.parts : "")));
    box.appendChild(eye);
    var h = el("h2", "ad-hero-brand cn-brand", c.brand || c.title);
    var n = (c.brand || c.title).length;
    h.style.setProperty("--k", (n <= 6 ? 9 : n <= 10 ? 7 : n <= 16 ? 5.5 : 4.2) + "vw");
    h.style.setProperty("--max", (n <= 6 ? 130 : n <= 10 ? 104 : n <= 16 ? 80 : 62) + "px");
    box.appendChild(h);
    if (c.brand) box.appendChild(el("p", "ad-hero-title", c.title));
    var meta = [c.agency && "Agência " + c.agency, c.source].filter(Boolean).join(" · ");
    if (meta) box.appendChild(el("p", "ad-hero-meta", meta));
    if (c.summary) box.appendChild(el("p", "ad-hero-sum cn-sum", c.summary));
    var row = el("div", "cn-info-acts");
    var more = el("button", "cn-btn", "ⓘ Mais informações");
    more.type = "button";
    more.addEventListener("click", function () { cinemaPause(); openInfo(c, more); });
    row.appendChild(more);
    if (c.url) row.appendChild(link("cn-btn", "Ler em " + (c.source || "fonte") + " ↗", c.url));
    var pop = el("span", "cn-pop");
    row.appendChild(pop);
    if (e.kind === "yt") popOf(e.id).then(function (v) { if (cn && cn.entries[cn.i] === e) pop.textContent = popText(v, c.date); });
    box.appendChild(row);
    box.classList.remove("cn-in");
    void box.offsetWidth;
    box.classList.add("cn-in");
  }

  function cinemaStrip() {
    var s = cn.strip;
    s.textContent = "";
    var total = cn.entries.length;
    for (var k = 1; k <= Math.min(14, total - 1); k++) {
      (function (idx) {
        var e = cn.entries[idx];
        var b = el("button", "cn-thumb");
        b.type = "button";
        b.setAttribute("aria-label", "Assistir " + (e.c.brand || e.c.title));
        var img = el("img");
        img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
        img.src = e.kind === "yt" ? ytThumb(e.id, false) : thumbOf(e.c, false);
        img.addEventListener("error", function () { img.remove(); });
        b.appendChild(img);
        var cap = el("span", "cn-thumb-cap");
        cap.appendChild(el("b", null, e.c.brand || e.c.title));
        cap.appendChild(el("span", null, e.c.title));
        b.appendChild(cap);
        b.addEventListener("click", function () { cinemaShow(idx); });
        s.appendChild(b);
      })((cn.i + k) % total);
    }
    s.scrollLeft = 0;
  }

  function cinemaShow(i) {
    var e = cn.entries[i];
    cn.i = i;
    cn.token++;
    var token = cn.token;
    clearInterval(cn.timer);
    cn.prog.firstChild.style.width = "0%";
    cn.root.classList.remove("cn-is-paused", "cn-err");
    cn.root.classList.add("cn-loading");
    cn.playBtn.textContent = "❚❚";
    cn.where.textContent = "Modo teatro · " + heading();
    cn.count.textContent = (i + 1) + " de " + cn.entries.length;
    var thumb = e.kind === "yt" ? ytThumb(e.id, true) : thumbOf(e.c, true);
    cn.bg.style.backgroundImage = thumb ? "url(\"" + thumb + "\")" : "";
    cn.poster.style.backgroundImage = thumb ? "url(\"" + thumb + "\")" : "";
    cn.poster.classList.remove("cn-gone");
    cinemaInfo(e);
    cinemaStrip();
    function ok() { return cn && cn.token === token; }
    function ended() { if (ok()) cinemaGo(cn.i + 1); }
    function failed() {
      if (!ok()) return;
      cinemaSkip();
    }
    function playing() {
      if (!ok()) return;
      cn.root.classList.remove("cn-loading", "cn-is-paused");
      cn.poster.classList.add("cn-gone");
      cn.playBtn.textContent = "❚❚";
    }
    if (e.kind === "yt") {
      if (cn.kind === "yt" && cn.player && cn.player.loadVideoById) {
        cn.player.loadVideoById(e.id);
        if (cn.muted) cn.player.mute(); else cn.player.unMute();
      } else {
        stopCinemaPlayer();
        var div = el("div");
        cn.host.appendChild(div);
        loadYouTube().then(function (YT) {
          if (!ok()) return;
          cn.kind = "yt";
          cn.player = new YT.Player(div, {
            videoId: e.id,
            host: "https://www.youtube-nocookie.com",
            playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
            events: {
              onReady: function (ev) { if (!cn) return; if (!cn.muted) ev.target.unMute(); else ev.target.mute(); ev.target.playVideo(); },
              onStateChange: function (ev) {
                if (!cn) return;
                if (ev.data === 0) cinemaGo(cn.i + 1);
                else if (ev.data === 1) { cn.fails = 0; cn.root.classList.remove("cn-loading", "cn-is-paused"); cn.poster.classList.add("cn-gone"); cn.playBtn.textContent = "❚❚"; }
                else if (ev.data === 2) { cn.root.classList.add("cn-is-paused"); cn.playBtn.textContent = "▶"; }
              },
              onError: function () { if (cn) cinemaSkip(); }
            }
          });
        }).catch(failed);
      }
      cn.timer = setInterval(function () {
        if (!ok() || !cn.player || !cn.player.getDuration) return;
        try {
          var d = cn.player.getDuration(), t = cn.player.getCurrentTime();
          if (d) cn.prog.firstChild.style.width = Math.min(100, t / d * 100) + "%";
        } catch (err) { /* carregando */ }
      }, 250);
      return;
    }
    // Vimeo
    stopCinemaPlayer();
    loadVimeo().then(function (Vimeo) {
      if (!ok()) return;
      cn.kind = "vimeo";
      var p = new Vimeo.Player(cn.host, { url: e.url, autoplay: true, muted: cn.muted, playsinline: true, controls: false, dnt: true, responsive: true });
      cn.player = p;
      p.on("play", playing);
      p.on("pause", function () { if (ok()) { cn.root.classList.add("cn-is-paused"); cn.playBtn.textContent = "▶"; } });
      p.on("ended", ended);
      p.on("timeupdate", function (d) { if (ok()) cn.prog.firstChild.style.width = (d.percent * 100) + "%"; });
      p.ready().catch(failed);
    }).catch(failed);
  }

  // Filme que não toca: pula para o próximo (e para de tentar se nada estiver tocando).
  function cinemaSkip() {
    cn.fails = (cn.fails || 0) + 1;
    cn.root.classList.add("cn-err");
    if (cn.fails >= 6) { cn.root.classList.add("cn-dead"); cn.root.classList.remove("cn-loading"); return; }
    var t = cn.token;
    setTimeout(function () { if (cn && cn.token === t) cinemaGo(cn.i + 1); }, 1600);
  }

  function stopCinemaPlayer() {
    if (!cn) return;
    try {
      if (cn.player && cn.kind === "yt" && cn.player.destroy) cn.player.destroy();
      else if (cn.player && cn.kind === "vimeo") cn.player.destroy();
    } catch (err) { /* já destruído */ }
    cn.player = null;
    cn.kind = "";
    cn.host.textContent = "";
  }

  function cinemaPause() {
    if (!cn || !cn.player) return;
    try { if (cn.kind === "yt") cn.player.pauseVideo(); else cn.player.pause(); } catch (err) { /* nada */ }
  }
  function cinemaToggle() {
    if (!cn || !cn.player) return;
    if (cn.kind === "yt") {
      if (cn.player.getPlayerState && cn.player.getPlayerState() === 1) cn.player.pauseVideo(); else cn.player.playVideo();
    } else {
      cn.player.getPaused().then(function (p) { if (p) cn.player.play(); else cn.player.pause(); });
    }
  }
  function setCinemaSound(on) {
    if (!cn) return;
    cn.muted = !on;
    cn.sound.textContent = on ? "🔊 Som ligado" : "🔇 Ativar som";
    cn.root.classList.toggle("cn-muted", !on);
    if (!cn.player) return;
    try {
      if (cn.kind === "yt") { if (on) cn.player.unMute(); else cn.player.mute(); cn.player.playVideo(); }
      else cn.player.setMuted(!on).catch(function () {});
    } catch (err) { /* player carregando */ }
  }

  function closeCinema(silent) {
    if (!cn) return;
    clearInterval(cn.timer);
    clearTimeout(cn.idle);
    stopCinemaPlayer();
    document.removeEventListener("keydown", onCinemaKey);
    document.body.style.overflow = cn.overflow;
    var root = cn.root;
    cn = null;
    root.classList.remove("cn-open");
    root.classList.add("cn-closing");
    setTimeout(function () { root.remove(); }, 350);
    if (!silent && isHome()) renderHero();
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
      // O site abre direto no modo teatro; Esc leva para a vitrine com tudo.
      if (state.items.length && location.hash !== "#inicio") openCinema(null);
    })
    .catch(function () {
      $("status").textContent = "Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.";
    });
})();
