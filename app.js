/* AD Drop: timeline de campanhas, uma por vez na tela (rolagem que para em cada uma).
   O quadro 16:9 fica no centro; com filme, toca sozinho e o texto aparece ao passar o
   mouse; sem filme, vira um carrossel com as fotos da matéria contando a ideia.
   Os dados vêm de campaigns.json, atualizado pelo robô do repositório. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var LOTE = 10;
  var SLIDE_MS = 8000;

  /* ---------- Dados ---------- */
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function safeUrl(u) { return /^https?:\/\//i.test(u) ? u : ""; }
  function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function arr(v, f) { return Array.isArray(v) ? v.map(str).filter(f) : []; }
  function vimeoOf(u) {
    var m = (u || "").match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/i);
    return m ? { id: m[1], hash: m[2] || "" } : null;
  }
  // Instagram e TikTok entram como filmes verticais, embutidos com o player deles.
  function socialOf(u) {
    var m = (u || "").match(/instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i);
    if (m) return { kind: "ig", id: m[2], src: "https://www.instagram.com/" + (m[1].indexOf("reel") === 0 ? "reel" : m[1]) + "/" + m[2] + "/embed/" };
    m = (u || "").match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
    if (m) return { kind: "tt", id: m[1], src: "https://www.tiktok.com/player/v1/" + m[1] + "?autoplay=1&muted=1&loop=1&controls=1&description=0&music_info=0" };
    return null;
  }
  function films(c) {
    var out = c.yt.map(function (id) { return { kind: "yt", id: id }; });
    if (!out.length) {
      var v = vimeoOf(c.video);
      if (v) out.push({ kind: "vimeo", id: v.id, hash: v.hash });
      else { var so = socialOf(c.video); if (so) out.push(so); }
    }
    return out;
  }
  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (x) {
      var c = {
        id: str(x.id), date: str(x.date), brand: str(x.brand), title: str(x.title),
        agency: str(x.agency), source: str(x.source), url: safeUrl(str(x.url)),
        region: str(x.region), cc: str(x.cc).toUpperCase(), summary: str(x.summary),
        yt: arr(x.yt, function (s) { return /^[\w-]{11}$/.test(s); }),
        video: safeUrl(str(x.video)), image: safeUrl(str(x.image)),
        images: arr(x.images, function (s) { return !!safeUrl(s); }),
        story: arr(x.story, Boolean), addedAt: str(x.addedAt)
      };
      c.fl = films(c);
      return c;
    }).filter(function (c) { return isDay(c.date) && c.title; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (!!a.fl.length !== !!b.fl.length) return a.fl.length ? -1 : 1; // no mesmo dia, filmes primeiro
        return a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0;
      });
  }

  /* ---------- Datas ---------- */
  function todayYmd() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function toDate(s) { var p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function shift(s, n) { var p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  var fmtLong = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  var TODAY = todayYmd();
  function dayName(d) {
    if (d === TODAY) return "Hoje";
    if (d === shift(TODAY, -1)) return "Ontem";
    var s = fmtLong.format(toDate(d)).split(",")[0];
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function dayDate(d) { return fmtLong.format(toDate(d)).split(", ").slice(1).join(", ") || fmtLong.format(toDate(d)); }

  /* ---------- Utilidades ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(cls, text, href) {
    var a = el("a", cls, text);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.addEventListener("click", function (e) { e.stopPropagation(); });
    return a;
  }
  function flagOf(cc) {
    if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
    return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65);
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function ytThumb(id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; }
  function fmtNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " mi";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(".", ",") + " mil";
    return String(n);
  }
  function img(src, onfail) {
    var i = el("img");
    i.alt = "";
    i.loading = "lazy";
    i.decoding = "async";
    i.referrerPolicy = "no-referrer";
    i.src = src;
    i.addEventListener("error", function () { i.remove(); if (onfail) onfail(); });
    return i;
  }
  function poster(c) {
    var p = el("div", "poster");
    var h = hue(c.brand || c.title);
    p.style.background = "radial-gradient(120% 90% at 0% 0%, hsl(" + h + " 70% 42%), transparent 60%), " +
      "radial-gradient(120% 120% at 100% 100%, hsl(" + ((h + 55) % 360) + " 65% 32%), transparent 60%), #111116";
    p.appendChild(el("span", null, c.brand || c.title));
    return p;
  }

  /* ---------- Regiões (filtro) ---------- */
  var REGIOES = [
    { nome: "Brasil", cc: ["BR"] },
    { nome: "América Latina", cc: ["MX", "AR", "CO", "CL", "PE", "EC", "UY", "PY", "BO", "VE", "CR", "PA", "GT", "DO", "PR", "SV", "HN", "NI", "CU"] },
    { nome: "EUA e Canadá", cc: ["US", "CA"] },
    { nome: "Europa", cc: ["GB", "IE", "FR", "DE", "ES", "PT", "IT", "NL", "SE", "NO", "DK", "FI", "PL", "BE", "CH", "AT", "CZ", "GR", "HU", "RO", "TR", "UA"], extra: ["Europa"] },
    { nome: "Ásia-Pacífico", cc: ["AU", "NZ", "IN", "SG", "JP", "KR", "CN", "HK", "TW", "TH", "MY", "ID", "PH", "VN", "PK", "BD", "LK"] },
    { nome: "Global", cc: [] }
  ];
  function regiaoDe(c) {
    for (var i = 0; i < REGIOES.length - 1; i++) {
      var r = REGIOES[i];
      if (r.cc.indexOf(c.cc) >= 0 || (r.extra && r.extra.indexOf(c.region) >= 0)) return r.nome;
    }
    return "Global";
  }

  /* ---------- Estado ---------- */
  var state = { items: [], list: [], shown: 0, region: "", onlyFilms: false, perDay: {} };
  var sound = false;

  var popCache = {};
  function popOf(id) {
    if (!popCache[id]) {
      popCache[id] = fetch("https://returnyoutubedislikeapi.com/votes?videoId=" + encodeURIComponent(id))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { return { views: +j.viewCount || 0 }; })
        .catch(function () { return { views: 0 }; });
    }
    return popCache[id];
  }

  /* ---------- Post: uma tela por campanha ---------- */
  function post(c, idxInDay) {
    var art = el("section", "post");
    art._c = c;
    art.setAttribute("aria-label", (c.brand ? c.brand + ": " : "") + c.title);

    // linha de cima: o dia (divisão por dias) e quem é
    var top = el("div", "post-top");
    var day = el("span", "day");
    day.appendChild(el("b", null, dayName(c.date)));
    day.appendChild(el("span", null, dayDate(c.date)));
    top.appendChild(day);
    var tot = state.perDay[c.date] || 0;
    top.appendChild(el("span", "pos", (idxInDay + 1) + " de " + tot));
    art.appendChild(top);

    var frame = el("div", "frame");
    var media = el("div", "media");
    frame.appendChild(media);

    if (c.fl.length) {
      art.classList.add("is-film");
      var cover = el("div", "cover");
      var f0 = c.fl[0];
      var csrc = f0.kind === "yt" ? ytThumb(f0.id) : f0.kind === "vimeo" ? "https://vumbnail.com/" + f0.id + "_large.jpg" : (c.image || c.images[0] || "");
      if (csrc) cover.appendChild(img(csrc, function () { cover.appendChild(poster(c)); }));
      else cover.appendChild(poster(c));
      if (f0.kind === "ig" || f0.kind === "tt") art.classList.add("is-vert", f0.kind === "ig" ? "is-ig" : "is-tt");
      var host0 = el("div", "host");
      if (f0.kind === "ig" || f0.kind === "tt") {
        // post do Instagram/TikTok aparece direto, sem capa antes (carrega quando chega perto da tela)
        var box0 = el("div");
        var fr0 = el("iframe");
        fr0.src = f0.src;
        fr0.loading = "lazy";
        fr0.allow = "autoplay; encrypted-media; picture-in-picture; clipboard-write";
        fr0.setAttribute("allowfullscreen", "");
        fr0.setAttribute("scrolling", "no");
        fr0.title = c.brand + " no " + (f0.kind === "ig" ? "Instagram" : "TikTok");
        box0.appendChild(fr0);
        host0.appendChild(box0);
        art.classList.add("embed-on");
      }
      media.appendChild(cover);
      media.appendChild(host0);
      media.appendChild(el("span", "bigplay"));
      media.appendChild(el("span", "fail", "Este filme só toca no YouTube ↗"));
      var mute = el("button", "mute");
      mute.type = "button";
      mute.setAttribute("aria-label", "Ligar ou desligar o som");
      media.appendChild(mute);
      var bar = el("div", "bar");
      bar.appendChild(el("i"));
      media.appendChild(bar);
      if (c.fl.length > 1) {
        var dots = el("div", "dots");
        c.fl.forEach(function (f, i) {
          var d = el("button", i === 0 ? "dot on" : "dot");
          d.type = "button";
          d.setAttribute("aria-label", "Filme " + (i + 1) + " de " + c.fl.length);
          d.addEventListener("click", function (e) { e.stopPropagation(); art.dataset.part = i; activate(art, true); });
          dots.appendChild(d);
        });
        media.appendChild(dots);
      }
      media.addEventListener("click", function (e) {
        if (e.target === mute) { setSound(!sound); if (!(active && active.art === art)) activate(art, true); return; }
        if (art.classList.contains("is-vert") && active && active.art === art) return;
        if (art.classList.contains("failed")) { window.open("https://www.youtube.com/watch?v=" + c.fl[+art.dataset.part || 0].id, "_blank", "noopener"); return; }
        if (active && active.art === art) { if (!sound) setSound(true); else togglePause(); }
        else activate(art, true);
      });
    } else {
      art.classList.add("is-story");
      buildStory(art, media, c);
    }

    // texto: aparece ao passar o mouse sobre o quadro (no celular, fica embaixo)
    var ov = el("div", "ov");
    ov.appendChild(el("h3", "brand", c.brand || c.source || "Campanha"));
    ov.appendChild(el("p", "meta", [flagOf(c.cc) + " " + (c.region || "Global"), c.agency].filter(Boolean).join("  ·  ")));
    ov.appendChild(el("p", "title", c.title));
    if (c.summary && c.fl.length) ov.appendChild(el("p", "sum", c.summary));
    var foot = el("p", "foot");
    if (c.url) foot.appendChild(link("src", "Ler em " + (c.source || "fonte") + " ↗", c.url));
    var pop = el("span", "pop");
    foot.appendChild(pop);
    if (c.yt.length) popOf(c.yt[0]).then(function (v) { if (v.views) pop.textContent = fmtNum(v.views) + " views"; });
    ov.appendChild(foot);
    frame.appendChild(ov);
    art.appendChild(frame);

    media._art = art;
    art._media = media;
    if (io) io.observe(media);
    return art;
  }

  /* ---------- Carrossel: campanha sem filme, a notícia inteira contada slide a slide ----------
     Cada foto da matéria é usada uma vez; quando as fotos acabam, o slide ganha um grafismo
     feito aqui mesmo (número em destaque, aspas, marca, padrões), sempre no formato da referência:
     imagem em cima, faixa preta com o texto em serifa embaixo. */
  // Texto do slide com destaques em negrito: marca, agência, números e nomes entre aspas.
  function rich(text, c) {
    var p = el("p");
    var keys = [c.brand, c.agency].filter(function (k) { return k && k.length > 1; })
      .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    var pat = "(" + (keys.length ? keys.join("|") + "|" : "") +
      "[“\"‘'][^”\"’']{2,60}[”\"’']|(?:R\\$|US\\$|€|£)\\s?[\\d.,]+(?:\\s?(?:mil|milhões|milhão|bilhões|bilhão|mi|bi))?|\\b\\d[\\d.,]*\\s?(?:%|mil|milhões|milhão|bilhões|bilhão|anos|dias|cidades|países|pessoas|lojas)?\\b)";
    var re = new RegExp(pat, "g"), last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) p.appendChild(document.createTextNode(text.slice(last, m.index)));
      p.appendChild(el("b", null, m[0]));
      last = m.index + m[0].length;
      if (!m[0].length) re.lastIndex++;
    }
    if (last < text.length) p.appendChild(document.createTextNode(text.slice(last)));
    return p;
  }
  var NUM_RE = /(?:R\$|US\$|€|£)\s?[\d.,]+(?:\s?(?:mil|milhões|milhão|bilhões|bilhão|bi|mi))?|\b\d[\d.,]*\s?(?:%|mil|milhões|milhão|bilhões|bilhão)|\b(?:19|20)\d{2}\b|\b\d{2,}[\d.,]*\b/;
  var QUOTE_RE = /[“"]([^”"]{8,90})[”"]/;
  function graphic(c, line, k) {
    var g = el("div", "gfx");
    var h = hue(c.brand || c.title);
    g.style.setProperty("--h", h);
    var num = line.match(NUM_RE), q = line.match(QUOTE_RE);
    if (num && k % 2 === 1) {
      g.classList.add("gfx-num");
      g.appendChild(el("span", "big", num[0].replace(/\s+/g, " ")));
    } else if (q) {
      g.classList.add("gfx-quote");
      g.appendChild(el("span", "qmark", "“"));
      g.appendChild(el("span", "qtext", q[1]));
    } else {
      var kind = ["gfx-type", "gfx-rings", "gfx-stripes", "gfx-grid"][k % 4];
      g.classList.add(kind);
      var word = c.brand || c.title;
      if (kind === "gfx-grid") {
        var ini = word.replace(/[^0-9A-Za-zÀ-ÿ]/g, "").charAt(0).toUpperCase() || "•";
        for (var n = 0; n < 24; n++) g.appendChild(el("span", null, ini));
      } else {
        g.appendChild(el("span", "big", word));
      }
    }
    return g;
  }
  function buildStory(art, media, c) {
    var pics = c.images.length ? c.images.slice() : c.image ? [c.image] : [];
    var lines = [c.title];
    if (c.summary && c.story.join(" ").indexOf(c.summary.slice(0, 40)) < 0) lines.push(c.summary);
    lines = lines.concat(c.story).slice(0, 11);
    var meta = [["Marca", c.brand], ["Agência", c.agency], ["Origem", c.region ? flagOf(c.cc) + " " + c.region : ""], ["Publicado em", c.source]]
      .filter(function (x) { return x[1]; });
    var n = lines.length + 1; // + ficha técnica
    var slides = [];
    var dots = el("div", "sdots");
    for (var k = 0; k < n; k++) {
      var sl = el("div", "slide" + (k === 0 ? " on" : ""));
      var top = el("div", "ph");
      if (k === n - 1) {
        top.appendChild(graphic(c, "", 0));
      } else if (k < pics.length) {
        top.appendChild(img(pics[k], (function (box, line, kk) { return function () { box.appendChild(graphic(c, line, kk)); }; })(top, lines[k], k)));
      } else {
        top.appendChild(graphic(c, lines[k], k));
      }
      sl.appendChild(top);
      sl.appendChild(el("span", "mark", "dA"));
      var panel = el("div", "panel");
      panel.appendChild(el("span", "kicker", "DROPP AD"));
      if (k === n - 1) {
        var fic = el("div", "ficha");
        meta.forEach(function (x) {
          var row = el("p");
          row.appendChild(el("span", null, x[0] + " "));
          row.appendChild(el("b", null, x[1]));
          fic.appendChild(row);
        });
        panel.appendChild(fic);
        if (c.url) panel.appendChild(link("more-link", "Ler a matéria completa ↗", c.url));
      } else {
        panel.appendChild(rich(lines[k], c));
      }
      sl.appendChild(panel);
      media.appendChild(sl);
      slides.push(sl);
      dots.appendChild(el("i", k === 0 ? "on" : ""));
    }
    var prev = el("button", "sarrow sprev", "‹"), next = el("button", "sarrow snext", "›");
    prev.type = next.type = "button";
    prev.setAttribute("aria-label", "Slide anterior");
    next.setAttribute("aria-label", "Próximo slide");
    prev.addEventListener("click", function (e) { e.stopPropagation(); if (!(active && active.art === art)) activate(art, true); storyGo(art, art._story.i - 1); });
    next.addEventListener("click", function (e) { e.stopPropagation(); if (!(active && active.art === art)) activate(art, true); storyGo(art, art._story.i + 1); });
    media.appendChild(prev); media.appendChild(next); media.appendChild(dots);
    art._story = { slides: slides, dots: dots.children, i: 0, t: 0 };
    media.addEventListener("click", function (e) {
      if (!(active && active.art === art)) { activate(art, true); return; }
      var r = media.getBoundingClientRect();
      storyGo(art, e.clientX - r.left < r.width / 3 ? art._story.i - 1 : art._story.i + 1);
    });
  }
  function storyGo(art, i) {
    var st = art._story, n = st.slides.length;
    i = (i + n) % n;
    st.slides.forEach(function (s, k) { s.classList.toggle("on", k === i); });
    Array.prototype.forEach.call(st.dots, function (d, k) { d.className = k === i ? "on" : ""; });
    st.i = i;
    st.t = 0;
  }

  /* ---------- Tocar sozinho o que está na tela ---------- */
  var ytReady = null, vimeoReady = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (!ytReady) ytReady = new Promise(function (res, rej) {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); res(window.YT); };
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = function () { ytReady = null; rej(new Error("yt")); };
      document.head.appendChild(s);
    });
    return ytReady;
  }
  function loadVimeo() {
    if (window.Vimeo && window.Vimeo.Player) return Promise.resolve(window.Vimeo);
    if (!vimeoReady) vimeoReady = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://player.vimeo.com/api/player.js";
      s.onload = function () { window.Vimeo ? res(window.Vimeo) : rej(new Error("vimeo")); };
      s.onerror = function () { vimeoReady = null; rej(new Error("vimeo")); };
      document.head.appendChild(s);
    });
    return vimeoReady;
  }

  var active = null; // { art, player, kind, timer }
  var ratios = new Map();
  var io = null, pickTimer = null;
  function setupIO() {
    if (!("IntersectionObserver" in window)) return;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0); });
      clearTimeout(pickTimer);
      pickTimer = setTimeout(pick, 120);
    }, { threshold: [0, .25, .5, .6, .75, .9, 1] });
  }
  function pick() {
    var best = null, br = 0;
    ratios.forEach(function (r, m) { if (r > br) { br = r; best = m._art; } });
    if (best && br >= 0.6) { if (!active || active.art !== best) activate(best, false); }
    else if (active && (ratios.get(active.art._media) || 0) < 0.3) deactivate();
  }

  function deactivate() {
    if (!active) return;
    var a = active;
    active = null;
    clearInterval(a.timer);
    try { if (a.player) a.player.destroy(); } catch (e) { /* já destruído */ }
    a.art.classList.remove("playing", "paused", "loading", "live");
    var host = a.art.querySelector(".host");
    if (host && !a.art.classList.contains("is-vert")) host.textContent = "";
    var bar = a.art.querySelector(".bar i");
    if (bar) bar.style.width = "0";
  }

  function activate(art, byUser) {
    if (active && active.art === art && !byUser) return;
    deactivate();
    var c = art._c;
    var me = { art: art, player: null, kind: "", timer: null };
    active = me;
    art.classList.add("live");
    function alive() { return active === me; }

    if (!c.fl.length) { // carrossel
      me.kind = "story";
      var st = art._story;
      if (byUser && st.t === 0 && st.i === 0) storyGo(art, 0);
      me.timer = setInterval(function () {
        if (!alive() || document.hidden || art.matches(":hover")) return;
        st.t += 100;
        if (st.t >= SLIDE_MS && st.slides.length > 1) storyGo(art, st.i + 1);
      }, 100);
      return;
    }

    var part = Math.min(+art.dataset.part || 0, c.fl.length - 1);
    var f = c.fl[part];
    me.kind = f.kind;
    art.querySelectorAll(".dot").forEach(function (d, i) { d.classList.toggle("on", i === part); });
    art.classList.remove("failed");
    var slot = el("div");
    art.querySelector(".host").appendChild(slot);
    art.classList.add("loading");
    function ended() {
      if (!alive()) return;
      if (c.fl.length > 1) { art.dataset.part = (part + 1) % c.fl.length; activate(art, true); }
      else if (me.kind === "yt") { me.player.seekTo(0); me.player.playVideo(); }
    }
    function playing() { if (alive()) { art.classList.remove("loading", "paused"); art.classList.add("playing"); } }
    function paused() { if (alive()) art.classList.add("paused"); }
    function failed() { if (alive()) { art.classList.remove("loading", "playing"); art.classList.add("failed"); } }

    if ((f.kind === "ig" || f.kind === "tt") && art.querySelector(".host iframe")) {
      slot.remove();
      playing();
      return;
    }
    if (f.kind === "ig" || f.kind === "tt") {
      // player do Instagram/TikTok: aparece no centro do quadro, em pé
      var fr = el("iframe");
      fr.src = f.src;
      fr.allow = "autoplay; encrypted-media; picture-in-picture; clipboard-write";
      fr.setAttribute("allowfullscreen", "");
      fr.setAttribute("scrolling", "no");
      fr.title = c.brand + " no " + (f.kind === "ig" ? "Instagram" : "TikTok");
      slot.appendChild(fr);
      fr.addEventListener("load", playing);
      setTimeout(playing, 2500);
      return;
    }
    if (f.kind === "yt") {
      loadYT().then(function (YT) {
        if (!alive()) return;
        me.player = new YT.Player(slot, {
          videoId: f.id,
          host: "https://www.youtube-nocookie.com",
          playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
          events: {
            onReady: function (e) { if (!alive()) return; if (sound) e.target.unMute(); else e.target.mute(); e.target.playVideo(); },
            onStateChange: function (e) { if (e.data === 1) playing(); else if (e.data === 2) paused(); else if (e.data === 0) ended(); },
            onError: failed
          }
        });
        me.timer = setInterval(function () {
          if (!alive() || !me.player || !me.player.getDuration) return;
          try {
            var d = me.player.getDuration(), t = me.player.getCurrentTime();
            if (d) art.querySelector(".bar i").style.width = Math.min(100, t / d * 100) + "%";
          } catch (err) { /* carregando */ }
        }, 300);
      }).catch(failed);
    } else {
      loadVimeo().then(function (Vimeo) {
        if (!alive()) return;
        var p = new Vimeo.Player(slot, {
          url: "https://vimeo.com/" + f.id + (f.hash ? "/" + f.hash : ""),
          autoplay: true, muted: !sound, loop: c.fl.length === 1, playsinline: true, controls: false, dnt: true, responsive: true
        });
        me.player = p;
        p.on("play", playing);
        p.on("pause", paused);
        p.on("ended", ended);
        p.on("timeupdate", function (d) { if (alive()) art.querySelector(".bar i").style.width = (d.percent * 100) + "%"; });
        p.ready().catch(failed);
      }).catch(failed);
    }
  }

  function togglePause() {
    if (!active || !active.player) return;
    var p = active.player;
    if (active.kind === "yt") { if (p.getPlayerState && p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo(); }
    else p.getPaused().then(function (x) { if (x) p.play(); else p.pause(); });
  }
  function setSound(on) {
    sound = on;
    document.body.classList.toggle("sound-on", on);
    $("sound").setAttribute("aria-pressed", on ? "true" : "false");
    if (!active || !active.player) return;
    try {
      if (active.kind === "yt") { if (on) active.player.unMute(); else active.player.mute(); active.player.playVideo(); }
      else if (active.kind === "vimeo") active.player.setMuted(!on).catch(function () {});
    } catch (e) { /* carregando */ }
  }

  /* ---------- Timeline (uma tela por campanha, rolagem infinita) ---------- */
  var moreIO = null, dayIdx = {};
  function renderMore() {
    var feed = $("feed");
    var slice = state.list.slice(state.shown, state.shown + LOTE);
    slice.forEach(function (c) {
      dayIdx[c.date] = (dayIdx[c.date] || 0);
      feed.appendChild(post(c, dayIdx[c.date]++));
    });
    state.shown += slice.length;
    var old = $("more");
    if (old) old.remove();
    if (moreIO) moreIO.disconnect();
    if (state.shown < state.list.length) {
      var s = el("div", "more");
      s.id = "more";
      feed.appendChild(s);
      if ("IntersectionObserver" in window) {
        moreIO = new IntersectionObserver(function (es) { if (es[0].isIntersecting) renderMore(); }, { rootMargin: "300% 0px" });
        moreIO.observe(s);
      }
    } else {
      feed.appendChild(el("p", "end", state.list.length ? "Você chegou ao início do arquivo." : "Nenhuma campanha com esse filtro."));
    }
  }
  function renderAll() {
    deactivate();
    ratios.clear();
    if (io) io.disconnect();
    $("feed").textContent = "";
    state.shown = 0;
    dayIdx = {};
    state.list = state.items.filter(function (c) {
      if (state.onlyFilms && !c.fl.length) return false;
      if (state.region && regiaoDe(c) !== state.region) return false;
      return true;
    });
    state.perDay = {};
    state.list.forEach(function (c) { state.perDay[c.date] = (state.perDay[c.date] || 0) + 1; });
    renderChips();
    renderMore();
  }
  function renderChips() {
    var box = $("chips");
    box.textContent = "";
    function chip(label, on, fn) {
      var b = el("button", "chip", label);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () { fn(); window.scrollTo(0, 0); renderAll(); });
      box.appendChild(b);
    }
    chip("Mundo", !state.region, function () { state.region = ""; });
    chip("Brasil", state.region === "Brasil", function () { state.region = "Brasil"; });
  }

  /* ---------- Teclado: setas pulam de campanha em campanha ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    var posts = Array.prototype.slice.call(document.querySelectorAll(".post"));
    if (!posts.length) return;
    var cur = active ? posts.indexOf(active.art) : 0;
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); if (posts[cur + 1]) posts[cur + 1].scrollIntoView({ behavior: "smooth" }); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); if (posts[cur - 1]) posts[cur - 1].scrollIntoView({ behavior: "smooth" }); }
    else if (e.key === " ") { e.preventDefault(); if (active && active.kind === "story") storyGo(active.art, active.art._story.i + 1); else togglePause(); }
    else if (e.key === "m") setSound(!sound);
    else if (e.key === "ArrowRight" && active && active.kind === "story") storyGo(active.art, active.art._story.i + 1);
    else if (e.key === "ArrowLeft" && active && active.kind === "story") storyGo(active.art, active.art._story.i - 1);
  });

  /* ---------- Início ---------- */
  $("sound").addEventListener("click", function () { setSound(!sound); });
  $("top").addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  document.addEventListener("visibilitychange", function () {
    if (!active || !active.player) return;
    try {
      if (document.hidden) { if (active.kind === "yt") active.player.pauseVideo(); else active.player.pause(); }
      else { if (active.kind === "yt") active.player.playVideo(); else active.player.play(); }
    } catch (e) { /* nada */ }
  });
  function measure() { document.documentElement.style.setProperty("--hh", document.querySelector(".bar-top").offsetHeight + "px"); }
  measure();
  window.addEventListener("resize", measure);
  setupIO();
  fetch("campaigns.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (raw) {
      state.items = normalize(raw);
      $("status").hidden = true;
      renderAll();
    })
    .catch(function (err) {
      console.log("ERRO", err && err.stack);
      $("status").textContent = "Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.";
    });
})();
