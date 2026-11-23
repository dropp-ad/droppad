/* AD Drop: timeline vertical de campanhas, estilo feed de rede social, mas para filmes.
   Cada post tem o filme em 16:9; o que está na tela toca sozinho (mudo até a pessoa
   ligar o som). Os dados vêm de campaigns.json, atualizado pelo robô do repositório. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var LOTE = 12;

  /* ---------- Dados ---------- */
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function safeUrl(u) { return /^https?:\/\//i.test(u) ? u : ""; }
  function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function vimeoOf(u) {
    var m = (u || "").match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/i);
    return m ? { id: m[1], hash: m[2] || "", url: u } : null;
  }
  // Lista de filmes tocáveis de uma campanha.
  function films(c) {
    var out = c.yt.map(function (id) { return { kind: "yt", id: id }; });
    if (!out.length) { var v = vimeoOf(c.video); if (v) out.push({ kind: "vimeo", id: v.id, hash: v.hash }); }
    return out;
  }
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
        var pa = films(a).length ? 1 : 0, pb = films(b).length ? 1 : 0;
        if (pa !== pb) return pb - pa; // no mesmo dia, quem tem filme vem primeiro
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
  var fmtShort = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "short" });
  var fmtStamp = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  var TODAY = todayYmd();
  function dayTitle(d) {
    if (d === TODAY) return "Hoje";
    if (d === shift(TODAY, -1)) return "Ontem";
    var s = fmtLong.format(toDate(d));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function dayShort(d) {
    if (d === TODAY) return "hoje";
    if (d === shift(TODAY, -1)) return "ontem";
    return fmtShort.format(toDate(d)).replace(".", "");
  }

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

  /* ---------- Regiões (filtro) ---------- */
  var REGIOES = [
    { nome: "Brasil", ico: "🇧🇷", cc: ["BR"] },
    { nome: "América Latina", ico: "🌎", cc: ["MX", "AR", "CO", "CL", "PE", "EC", "UY", "PY", "BO", "VE", "CR", "PA", "GT", "DO", "PR", "SV", "HN", "NI", "CU"] },
    { nome: "EUA e Canadá", ico: "🇺🇸", cc: ["US", "CA"] },
    { nome: "Europa", ico: "🇪🇺", cc: ["GB", "IE", "FR", "DE", "ES", "PT", "IT", "NL", "SE", "NO", "DK", "FI", "PL", "BE", "CH", "AT", "CZ", "GR", "HU", "RO", "TR", "UA"], extra: ["Europa"] },
    { nome: "Ásia-Pacífico", ico: "🌏", cc: ["AU", "NZ", "IN", "SG", "JP", "KR", "CN", "HK", "TW", "TH", "MY", "ID", "PH", "VN", "PK", "BD", "LK"] },
    { nome: "Global", ico: "🌐", cc: [] }
  ];
  function regiaoDe(c) {
    for (var i = 0; i < REGIOES.length - 1; i++) {
      var r = REGIOES[i];
      if (r.cc.indexOf(c.cc) >= 0 || (r.extra && r.extra.indexOf(c.region) >= 0)) return r.nome;
    }
    return "Global";
  }

  /* ---------- Estado ---------- */
  var state = { items: [], list: [], shown: 0, lastDay: "", region: "", onlyFilms: false };
  var sound = false;

  /* ---------- Popularidade no YouTube ---------- */
  var popCache = {};
  function popOf(id) {
    if (!popCache[id]) {
      popCache[id] = fetch("https://returnyoutubedislikeapi.com/votes?videoId=" + encodeURIComponent(id))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { return { views: +j.viewCount || 0, likes: +j.likes || 0 }; })
        .catch(function () { return { views: 0, likes: 0 }; });
    }
    return popCache[id];
  }

  /* ---------- Post ---------- */
  function avatar(c) {
    var a = el("span", "av");
    var h = hue(c.brand || c.title);
    a.style.background = "linear-gradient(135deg, hsl(" + h + " 85% 58%), hsl(" + ((h + 60) % 360) + " 80% 45%))";
    a.textContent = ((c.brand || c.title).replace(/[^0-9A-Za-zÀ-ÿ]/g, "").charAt(0) || "•").toUpperCase();
    return a;
  }
  function poster(c) {
    var p = el("div", "poster");
    var h = hue(c.brand || c.title);
    p.style.background = "radial-gradient(120% 90% at 0% 0%, hsl(" + h + " 80% 50%), transparent 60%), " +
      "radial-gradient(120% 120% at 100% 100%, hsl(" + ((h + 55) % 360) + " 75% 40%), transparent 60%), #15151c";
    p.appendChild(el("span", null, c.brand || c.title));
    return p;
  }

  function post(c) {
    var fl = films(c);
    var art = el("article", "post");
    art._c = c;

    // texto à esquerda, no fundo preto
    var info = el("div", "info");
    info.appendChild(el("h3", "brand", c.brand || c.source || "Campanha"));
    var meta = el("p", "meta");
    meta.textContent = [flagOf(c.cc) + " " + (c.region || "Global"), c.agency].filter(Boolean).join("  ·  ");
    info.appendChild(meta);
    info.appendChild(el("p", "title", c.title));
    if (c.summary) info.appendChild(el("p", "sum", c.summary));
    var foot = el("p", "foot");
    if (c.url) foot.appendChild(link("src", (c.source || "Fonte") + " ↗", c.url));
    var pop = el("span", "pop");
    foot.appendChild(pop);
    if (c.yt.length) popOf(c.yt[0]).then(function (v) { if (v.views) pop.textContent = fmtNum(v.views) + " views"; });
    info.appendChild(foot);
    art.appendChild(info);

    // quadro do filme
    var media = el("div", "media");
    var cover = el("div", "cover");
    var src = fl.length ? (fl[0].kind === "yt" ? ytThumb(fl[0].id) : "https://vumbnail.com/" + fl[0].id + "_large.jpg") : c.image;
    if (src) {
      var img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = src;
      img.addEventListener("error", function () { img.remove(); cover.appendChild(poster(c)); });
      cover.appendChild(img);
    } else {
      cover.appendChild(poster(c));
    }
    media.appendChild(cover);

    if (fl.length) {
      art.classList.add("has-film");
      media.appendChild(el("div", "host"));
      media.appendChild(el("span", "bigplay"));
      media.appendChild(el("span", "fail", "Este filme só toca no YouTube ↗"));
      var mute = el("button", "mute");
      mute.type = "button";
      mute.setAttribute("aria-label", "Ligar ou desligar o som");
      media.appendChild(mute);
      var bar = el("div", "bar");
      bar.appendChild(el("i"));
      media.appendChild(bar);
      if (fl.length > 1) {
        var dots = el("div", "dots");
        fl.forEach(function (f, i) {
          var d = el("button", i === 0 ? "dot on" : "dot");
          d.type = "button";
          d.setAttribute("aria-label", "Filme " + (i + 1) + " de " + fl.length);
          d.addEventListener("click", function (e) { e.stopPropagation(); art.dataset.part = i; activate(art, true); });
          dots.appendChild(d);
        });
        media.appendChild(dots);
      }
      media.addEventListener("click", function (e) {
        if (e.target === mute) { setSound(!sound); if (!(active && active.art === art)) activate(art, true); return; }
        if (art.classList.contains("failed")) { window.open("https://www.youtube.com/watch?v=" + fl[+art.dataset.part || 0].id, "_blank", "noopener"); return; }
        if (active && active.art === art) {
          if (!sound) setSound(true); else togglePause();
        } else {
          activate(art, true);
        }
      });
    } else if (c.url) {
      media.appendChild(link("readover", "Ler a matéria ↗", c.url));
    }
    art.appendChild(media);

    media._art = art;
    art._media = media;
    if (fl.length && io) io.observe(media);
    return art;
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
      pickTimer = setTimeout(pick, 150);
    }, { threshold: [0, .2, .4, .5, .6, .7, .8, .9, 1], rootMargin: "-120px 0px 0px 0px" });
  }
  // Toca o post com filme mais visível na tela; para o que saiu.
  function pick() {
    var best = null, br = 0;
    ratios.forEach(function (r, m) { if (r > br) { br = r; best = m._art; } });
    if (best && br >= 0.55) {
      if (!active || active.art !== best) activate(best, false);
    } else if (active && (ratios.get(active.art._media) || 0) < 0.3) {
      deactivate();
    }
  }

  function deactivate() {
    if (!active) return;
    var a = active;
    active = null;
    clearInterval(a.timer);
    try { if (a.player) a.player.destroy(); } catch (e) { /* já destruído */ }
    a.art.classList.remove("playing", "paused", "loading");
    var host = a.art.querySelector(".host");
    if (host) host.textContent = "";
    var bar = a.art.querySelector(".bar i");
    if (bar) bar.style.width = "0";
  }

  function activate(art, byUser) {
    if (active && active.art === art && !byUser) return;
    deactivate();
    var fl = films(art._c);
    var part = Math.min(+art.dataset.part || 0, fl.length - 1);
    var f = fl[part];
    art.querySelectorAll(".dot").forEach(function (d, i) { d.classList.toggle("on", i === part); });
    var cnt = art.querySelector(".count");
    if (cnt) cnt.textContent = (part + 1) + "/" + fl.length;
    art.classList.remove("failed");
    var slot = el("div");
    art.querySelector(".host").appendChild(slot);
    var me = { art: art, player: null, kind: f.kind, timer: null };
    active = me;
    art.classList.add("loading");
    function alive() { return active === me; }
    function ended() {
      // terminou: passa para o próximo filme da campanha ou repete
      if (!alive()) return;
      if (fl.length > 1) { art.dataset.part = (part + 1) % fl.length; activate(art, true); }
      else if (me.kind === "yt") { me.player.seekTo(0); me.player.playVideo(); }
    }
    function playing() { if (alive()) { art.classList.remove("loading", "paused"); art.classList.add("playing"); } }
    function paused() { if (alive()) art.classList.add("paused"); }
    function failed() { if (alive()) { art.classList.remove("loading", "playing"); art.classList.add("failed"); } }

    if (f.kind === "yt") {
      loadYT().then(function (YT) {
        if (!alive()) return;
        me.player = new YT.Player(slot, {
          videoId: f.id,
          host: "https://www.youtube-nocookie.com",
          playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
          events: {
            onReady: function (e) { if (!alive()) return; if (sound) e.target.unMute(); else e.target.mute(); e.target.playVideo(); },
            onStateChange: function (e) {
              if (e.data === 1) playing();
              else if (e.data === 2) paused();
              else if (e.data === 0) ended();
            },
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
          autoplay: true, muted: !sound, loop: fl.length === 1, playsinline: true, controls: false, dnt: true, responsive: true
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
    if (active.kind === "yt") {
      if (p.getPlayerState && p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo();
    } else {
      p.getPaused().then(function (x) { if (x) p.play(); else p.pause(); });
    }
  }

  function setSound(on) {
    sound = on;
    document.body.classList.toggle("sound-on", on);
    $("sound").setAttribute("aria-pressed", on ? "true" : "false");
    if (!active || !active.player) return;
    try {
      if (active.kind === "yt") { if (on) active.player.unMute(); else active.player.mute(); active.player.playVideo(); }
      else active.player.setMuted(!on).catch(function () {});
    } catch (e) { /* carregando */ }
  }

  /* ---------- Timeline (rolagem infinita) ---------- */
  var moreIO = null;
  function renderMore() {
    var feed = $("feed");
    var slice = state.list.slice(state.shown, state.shown + LOTE);
    slice.forEach(function (c) {
      if (c.date !== state.lastDay || !state.section) {
        state.lastDay = c.date;
        // um bloco por dia, com o título do dia preso no topo enquanto o dia rola
        var sec = el("section", "day");
        var h = el("h2", "day-h");
        h.appendChild(el("span", "day-name", dayTitle(c.date)));
        var n = state.list.filter(function (x) { return x.date === c.date; });
        var nf = n.filter(function (x) { return films(x).length; }).length;
        h.appendChild(el("span", "day-date", (dayTitle(c.date) === "Hoje" || dayTitle(c.date) === "Ontem" ? fmtLong.format(toDate(c.date)) + "  ·  " : "") +
          n.length + (n.length === 1 ? " campanha" : " campanhas") + (nf ? "  ·  " + nf + (nf === 1 ? " filme" : " filmes") : "")));
        sec.appendChild(h);
        feed.appendChild(sec);
        state.section = sec;
      }
      state.section.appendChild(post(c));
    });
    state.shown += slice.length;
    var old = $("more");
    if (old) old.remove();
    if (moreIO) moreIO.disconnect();
    if (state.shown < state.list.length) {
      var s = el("div", "more");
      s.id = "more";
      s.appendChild(el("span", "spin"));
      feed.appendChild(s);
      if ("IntersectionObserver" in window) {
        moreIO = new IntersectionObserver(function (es) {
          if (es[0].isIntersecting) renderMore();
        }, { rootMargin: "1600px 0px" });
        moreIO.observe(s);
      } else {
        var b = el("button", "chip", "Carregar mais");
        b.type = "button";
        b.addEventListener("click", renderMore);
        s.appendChild(b);
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
    state.lastDay = "";
    state.section = null;
    state.list = state.items.filter(function (c) {
      if (state.onlyFilms && !films(c).length) return false;
      if (state.region && regiaoDe(c) !== state.region) return false;
      return true;
    });
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
    chip("Tudo", !state.region && !state.onlyFilms, function () { state.region = ""; state.onlyFilms = false; });
    chip("Só filmes", state.onlyFilms, function () { state.onlyFilms = !state.onlyFilms; });
    REGIOES.forEach(function (r) {
      chip(r.nome, state.region === r.nome, function () { state.region = state.region === r.nome ? "" : r.nome; });
    });
  }

  /* ---------- Início ---------- */
  $("sound").addEventListener("click", function () { setSound(!sound); });
  $("top").addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && active && active.player) {
      try { if (active.kind === "yt") active.player.pauseVideo(); else active.player.pause(); } catch (e) { /* nada */ }
    } else if (!document.hidden && active && active.player) {
      try { if (active.kind === "yt") active.player.playVideo(); else active.player.play(); } catch (e) { /* nada */ }
    }
  });
  function measure() { document.documentElement.style.setProperty("--hh", document.querySelector(".bar-top").offsetHeight + "px"); }
  measure();
  window.addEventListener("resize", measure);
  setupIO();
  fetch("campaigns.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (raw) {
      state.items = normalize(raw);
      var last = state.items.reduce(function (m, c) { return c.addedAt > m ? c.addedAt : m; }, "");
      var t = last ? new Date(last) : null;
      $("status").hidden = true;
      renderAll();
    })
    .catch(function () {
      $("status").textContent = "Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.";
    });
})();
