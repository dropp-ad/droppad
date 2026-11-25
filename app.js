/* AD Drop: timeline de campanhas, uma por vez na tela (rolagem que para em cada uma).
   O quadro 16:9 fica no centro; com filme, toca sozinho e o texto aparece ao passar o
   mouse; sem filme, vira um carrossel com as fotos da matéria contando a ideia.
   Os dados vêm de feed.json: uma versão enxuta de campaigns.json, gerada na publicação (publicar.yml). */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var LOTE = 10;

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
  // créditos: [{role, name}] ou {"Direção de criação": "Fulano"}; mais os campos soltos de produtora/criativos
  function creditsOf(x) {
    var out = [];
    function add(role, name) {
      role = str(role); name = Array.isArray(name) ? name.map(str).filter(Boolean).join(", ") : str(name);
      if (role && name) out.push([role, name]);
    }
    if (Array.isArray(x.credits)) x.credits.forEach(function (k) { if (k && typeof k === "object") add(k.role, k.name || k.names); });
    else if (x.credits && typeof x.credits === "object") Object.keys(x.credits).forEach(function (k) { add(k, x.credits[k]); });
    if (x.creatives) add("Criação", x.creatives);
    if (x.production) add("Produtora", x.production);
    if (x.director) add("Direção", x.director);
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
        video: safeUrl(str(x.video)), image: safeUrl(str(x.image) || (Array.isArray(x.images) ? str(x.images[0]) : "")),
        addedAt: str(x.addedAt), story: arr(x.story, Boolean), st: !!x.st, hidden: !!x.hidden,
        idea: str(x.idea), frase: str(x.frase), credits: creditsOf(x)
      };
      c.fl = films(c);
      return c;
    }).filter(function (c) { return isDay(c.date) && c.title && !c.hidden; })
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
  function shift(s, n) { var p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  var TODAY = todayYmd();

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
    { nome: "Oriente Médio e África", cc: ["AE", "SA", "QA", "KW", "BH", "OM", "EG", "ZA", "NG", "KE", "MA", "LB", "JO", "IL", "GH", "TZ", "ET", "DZ", "TN", "CI", "SN", "UG", "IQ", "IR", "RW", "AO", "MZ"] },
    { nome: "Global", cc: [] }
  ];
  /* país de quem entra: vira o destaque ao lado de "Mundo" */
  var dn = null;
  try { dn = new Intl.DisplayNames(["pt-BR"], { type: "region" }); } catch (e) { /* navegador antigo */ }
  function countryName(cc) {
    var nomes = { BR: "Brasil", US: "EUA", GB: "Reino Unido" };
    if (nomes[cc]) return nomes[cc];
    try { return (dn && dn.of(cc)) || cc; } catch (e) { return cc; }
  }
  function guessCountry() {
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var m = String(langs[i]).match(/[-_]([A-Za-z]{2})\b/);
      if (m) return m[1].toUpperCase();
    }
    return "BR";
  }
  function detectCountry() {
    var saved = "";
    try { saved = localStorage.getItem("ddrop-cc") || ""; } catch (e) { /* sem storage */ }
    if (/^[A-Z]{2}$/.test(saved)) return Promise.resolve(saved);
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 2500);
    return fetch("https://api.country.is/", ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(to);
        var cc = String(j && j.country || "").toUpperCase();
        if (!/^[A-Z]{2}$/.test(cc)) throw new Error("cc");
        try { localStorage.setItem("ddrop-cc", cc); } catch (e) { /* sem storage */ }
        return cc;
      })
      .catch(function () { clearTimeout(to); return guessCountry(); });
  }
  function regiaoDoPais(cc) {
    for (var i = 0; i < REGIOES.length - 1; i++) if (REGIOES[i].cc.indexOf(cc) >= 0) return REGIOES[i].nome;
    return "";
  }
  function regiaoDe(c) {
    for (var i = 0; i < REGIOES.length - 1; i++) {
      var r = REGIOES[i];
      if (r.cc.indexOf(c.cc) >= 0 || (r.extra && r.extra.indexOf(c.region) >= 0)) return r.nome;
    }
    return "Global";
  }

  /* ---------- Estado ---------- */
  var state = { items: [], list: [], shown: 0, region: "", perDay: {}, home: { cc: "BR", label: "Brasil" } };
  // som ligado por padrão; se o navegador bloquear áudio antes do primeiro toque,
  // o filme toca mudo e o som entra no primeiro clique/toque/tecla na página
  var sound = true, blocked = false, gestureAt = 0, unblockedAt = 0;
  function paintSound() {
    var on = sound && !blocked;
    document.body.classList.toggle("sound-on", on);
    var b = document.getElementById("sound");
    if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function onFirstGesture() {
    gestureAt = Date.now();
    ["pointerdown", "touchstart", "keydown"].forEach(function (t) { document.removeEventListener(t, onFirstGesture, true); });
    if (sound && blocked) { unblockedAt = Date.now(); setSound(true); }
  }
  ["pointerdown", "touchstart", "keydown"].forEach(function (t) { document.addEventListener(t, onFirstGesture, true); });
  function fallbackMuted(mute, play) {
    blocked = true;
    try { mute(); play(); } catch (e) { /* nada */ }
    paintSound();
  }

  /* ---------- Post: cada campanha vira um post de rede social ---------- */
  // nome em cima do post: a agência; se vier vazia ou estranha ("Wise’s", "Brick e e"), o veículo
  // a agência, quando o nome vem limpo ("Wise’s", "Brick e e" ou o próprio veículo não contam)
  function agenciaDe(c) {
    var a = c.agency;
    if (!a || a.length < 2 || /['’]s\b/i.test(a) || /\b(\w+)\s+\1\b/i.test(a) || /\b(e|and|y)$/i.test(a)) return "";
    if (c.source && a.toLowerCase() === c.source.toLowerCase()) return "";
    return a;
  }
  function iniciais(t) {
    var w = String(t).replace(/[^0-9A-Za-zÀ-ÿ ]/g, " ").trim().split(/\s+/);
    return ((w[0] || "").charAt(0) + (w[1] || "").charAt(0)).toUpperCase() || "•";
  }
  function avatar(nome) {
    var box = el("span", "av ini");
    box.setAttribute("aria-hidden", "true");
    box.textContent = iniciais(nome);
    return box;
  }
  function fraseDe(c) {
    var f = str(c.frase) || c.summary || c.title;
    return f;
  }
  function fmtT(t) { t = Math.max(0, Math.floor(t || 0)); var m = Math.floor(t / 60), s = t % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function setTime(art, t, d) { var tg = art.querySelector(".ptime"); if (tg && d) tg.textContent = t > 0.5 ? fmtT(t) + " / " + fmtT(d) : fmtT(d); }
  var MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  function selo(d) { return d === TODAY ? "Estreou hoje" : d === shift(TODAY, -1) ? "Estreou ontem" : "Estreou " + (+d.slice(8, 10)) + " " + MESES[+d.slice(5, 7) - 1]; }
  // "há 2 h" a partir da hora em que entrou no site
  function haQuanto(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 0) return "";
    if (m < 60) return "há " + Math.max(1, m) + " min";
    if (m < 24 * 60) return "há " + Math.round(m / 60) + " h";
    return "";
  }
  var ICON_DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="3" height="3"/><rect x="10.5" y="11" width="3" height="3"/><rect x="17" y="11" width="3" height="3"/></svg>';

  /* Instagram: o post inteiro (cabeçalho, filme e rodapé) entra reduzido no quadro 16:9, sem cortar.
     O embed avisa a própria altura por postMessage (MEASURE); até lá, vale uma altura típica. */
  var IG_W = 400, IG_H = 760, igRO = "ResizeObserver" in window ? new ResizeObserver(function (es) { es.forEach(function (e) { scaleIG(e.target); }); }) : null;
  function scaleIG(media) {
    var box = media.querySelector(".igbox");
    if (!box) return;
    var h = +box.dataset.h || IG_H, w = media.clientWidth, bh = media.clientHeight;
    if (!w || !bh) return;
    box.style.setProperty("--igh", h + "px");
    box.style.transform = "translate(-50%,-50%) scale(" + Math.min(1, bh / h, w / IG_W).toFixed(4) + ")";
  }
  function fitIG(media) {
    if (!media) return;
    if (igRO) igRO.observe(media);
    requestAnimationFrame(function () { scaleIG(media); });
  }
  window.addEventListener("message", function (e) {
    if (!/^https:\/\/(www\.)?instagram\.com$/.test(e.origin)) return;
    var d = e.data;
    try { if (typeof d === "string") d = JSON.parse(d); } catch (err) { return; }
    var h = d && d.details && +d.details.height;
    if (!d || d.type !== "MEASURE" || !h) return;
    document.querySelectorAll(".igbox iframe").forEach(function (fr) {
      if (fr.contentWindow !== e.source) return;
      var box = fr.parentNode;
      if (+box.dataset.h === Math.round(h)) return;
      box.dataset.h = Math.round(h);
      scaleIG(box.closest(".media"));
    });
  });

  /* campanha sem filme: a notícia contada no próprio post (título + parágrafos da matéria) */
  // rodapé que os sites WordPress põem no feed ("O post … apareceu primeiro em …")
  var LIXO = /apareceu primeiro em|appeared first on|se publicó primero en|Gostou do conteúdo\?|Leia também|Read more:/i;
  function newsBlock(c) {
    var box = el("div", "news rv");
    box.style.setProperty("--i", 3);
    box.appendChild(el("h3", null, c.title));
    var body = el("div", "news-body");
    box.appendChild(body);
    function fill(story) {
      var shown = fraseDe(c).slice(0, 60), total = 0;
      body.textContent = "";
      (story || []).some(function (t) {
        t = str(t);
        if (!t || t.slice(0, 60) === shown || LIXO.test(t)) return false;
        body.appendChild(el("p", null, t));
        total += t.length;
        return body.children.length >= 4 || total > 900;
      });
    }
    fill(c.story);
    if (c.st && !body.children.length) {
      fetch("historia/" + encodeURIComponent(c.id) + ".json")
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { fill(j.story); })
        .catch(function () { /* fica só com o título e o link */ });
    }
    if (c.url) box.appendChild(link("news-more", "Ler a matéria completa em " + (c.source || "fonte") + " ↗", c.url));
    return box;
  }

  function post(c, idxInDay) {
    var art = el("article", "post");
    art._c = c;
    art._k = idxInDay;
    art.dataset.id = c.id;
    art.setAttribute("aria-label", (c.brand ? c.brand + ": " : "") + c.title);
    var ag = agenciaDe(c), marca = c.brand || c.title;

    // "Agência para Marca" (sem agência conhecida, só a marca); embaixo, o veículo
    var head = el("div", "head");
    head.appendChild(avatar(ag || marca));
    var who = el("div", "who");
    var b = el("b", null, ag || marca);
    if (ag && marca && marca.toLowerCase() !== ag.toLowerCase()) {
      b.appendChild(el("i", null, " para "));
      b.appendChild(document.createTextNode(marca));
    }
    who.appendChild(b);
    var sm = el("small");
    var bits = ["via " + (c.source || "—")];
    if (c.region) bits.push(c.region);
    var ha = haQuanto(c.addedAt);
    if (ha) bits.push(ha);
    if (c.url) sm.appendChild(link("", bits.join(" · "), c.url)); else sm.textContent = bits.join(" · ");
    who.appendChild(sm);
    head.appendChild(who);
    var pos = idxInDay + 1;
    head.appendChild(el("span", "num", "Nº " + (pos < 10 ? "0" : "") + pos));
    var mb = el("button", "more-btn");
    mb.type = "button";
    mb.setAttribute("aria-label", "Mais opções");
    mb.innerHTML = ICON_DOTS;
    mb.addEventListener("click", function (e) { e.stopPropagation(); share(c, mb); });
    head.appendChild(mb);
    head.classList.add("rv"); head.style.setProperty("--i", 0);
    art.appendChild(head);

    // a frase
    var txt = el("p", "txt", fraseDe(c));
    txt.title = c.title;
    txt.classList.add("rv"); txt.style.setProperty("--i", 1);
    art.appendChild(txt);

    // o filme
    var media = el("div", "media"), news = null;
    if (c.fl.length) {
      art.classList.add("is-film");
      var cover = el("div", "cover");
      var f0 = c.fl[0];
      var csrc = f0.kind === "yt" ? ytThumb(f0.id) : f0.kind === "vimeo" ? "https://vumbnail.com/" + f0.id + "_large.jpg" : c.image;
      if (csrc) cover.appendChild(img(csrc, function () { cover.appendChild(poster(c)); }));
      else cover.appendChild(poster(c));
      if (f0.kind === "ig" || f0.kind === "tt") art.classList.add("is-vert", f0.kind === "ig" ? "is-ig" : "is-tt");
      var host0 = el("div", "host");
      if (f0.kind === "ig" || f0.kind === "tt") {
        // post do Instagram/TikTok aparece direto, sem capa antes (carrega quando chega perto da tela)
        var box0 = el("div", f0.kind === "ig" ? "igbox" : null);
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
        if (f0.kind === "ig") fitIG(media);
      }
      media.appendChild(cover);
      media.appendChild(host0);
      media.appendChild(el("span", "bigplay"));
      media.appendChild(el("span", "ptime"));
      media.appendChild(el("span", "fail", "Este filme só toca no YouTube ↗"));
      media.appendChild(endCard(art, c));
      var mute = el("button", "mute");
      mute.type = "button";
      mute.setAttribute("aria-label", "Ligar ou desligar o som");
      mute.innerHTML = ICON_SND;
      media.appendChild(mute);
      var bar = el("div", "bar");
      bar.appendChild(el("i"));
      media.appendChild(bar);
      if (c.fl.length > 1) {
        var dots = el("div", "fdots");
        c.fl.forEach(function (f, i) {
          var d = el("button", i === 0 ? "fdot on" : "fdot");
          d.type = "button";
          d.setAttribute("aria-label", "Filme " + (i + 1) + " de " + c.fl.length);
          d.addEventListener("click", function (e) { e.stopPropagation(); art.dataset.part = i; activate(art, true); });
          dots.appendChild(d);
        });
        media.appendChild(dots);
      }
      media.addEventListener("click", function (e) {
        if (mute.contains(e.target)) { mute.blur(); setSound(Date.now() - unblockedAt < 1000 ? true : !sound); if (!(active && active.art === art)) activate(art, true); return; }
        if (art.classList.contains("is-vert") && active && active.art === art) return;
        if (art.classList.contains("ended")) return;
        if (art.classList.contains("failed")) { window.open("https://www.youtube.com/watch?v=" + c.fl[+art.dataset.part || 0].id, "_blank", "noopener"); return; }
        if (active && active.art === art) { if (!sound || Date.now() - unblockedAt < 1000) setSound(true); else togglePause(); }
        else activate(art, true);
      });
    } else {
      // sem filme: a foto da matéria (se houver) e, embaixo, a notícia contada
      art.classList.add("is-card");
      news = newsBlock(c);
      if (c.image) {
        var cv = el("div", "cover");
        cv.appendChild(img(c.image, function () {
          // foto quebrada: some o quadro e a notícia assume o lugar
          if (io) io.unobserve(media);
          if (pxIO) pxIO.unobserve(media);
          media.remove();
          news.insertBefore(el("span", "stamp", selo(c.date)), news.firstChild);
          watch(news);
        }));
        media.appendChild(cv);
      } else {
        media = null;
        news.insertBefore(el("span", "stamp", selo(c.date)), news.firstChild);
      }
    }
    if (media) {
      media.appendChild(el("span", "stamp", selo(c.date)));
      media.classList.add("rv"); media.style.setProperty("--i", 2);
      art.appendChild(media);
    }
    if (news) art.appendChild(news);

    // comentar, compartilhar, ver matéria
    var acts = el("div", "acts");
    var cm = el("button", "act cmt");
    cm.type = "button";
    cm.setAttribute("aria-label", "Comentários sobre esta campanha");
    cm.innerHTML = ICON_CMT + "<span>Comentar</span>";
    cm.appendChild(el("span", "n"));
    cm.addEventListener("click", function (e) { e.stopPropagation(); openComments(c); });
    acts.appendChild(cm);
    var sh = el("button", "act share");
    sh.type = "button";
    sh.setAttribute("aria-label", "Compartilhar esta campanha");
    sh.innerHTML = ICON_SHARE + "<span>Compartilhar</span>";
    sh.addEventListener("click", function (e) { e.stopPropagation(); share(c, sh); });
    acts.appendChild(sh);
    if (c.url) acts.appendChild(link("link", "Ver matéria ↗", c.url));
    acts.classList.add("rv"); acts.style.setProperty("--i", news ? 4 : 3);
    art.appendChild(acts);
    paintCount(art);

    // o que decide qual post está "na tela": o filme/foto, ou a notícia quando não há foto
    function watch(n) { n._art = art; art._media = n; if (io) io.observe(n); }
    watch(media || news);
    if (inIO) inIO.observe(art); else art.classList.add("in");
    if (pxIO && media) pxIO.observe(media);
    return art;
  }

  /* posts entram com fade suave quando aparecem na tela */
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var inIO = ("IntersectionObserver" in window && !REDUCE) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); inIO.unobserve(e.target); } });
  }, { threshold: 0 }) : null;
  // parallax só nas capas que estão perto da tela (o resto não é tocado a cada rolagem)
  var pxNear = new Set();
  var pxIO = ("IntersectionObserver" in window && !REDUCE) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) pxNear.add(e.target); else pxNear.delete(e.target); });
  }, { rootMargin: "50px 0px" }) : null;

  /* contagem de comentários por campanha (Supabase), pedida em lote */
  var CMT_N = {};
  function paintCount(art) {
    var n = art.querySelector(".act .n");
    var v = CMT_N[art._c.id];
    if (!n) return;
    if (v == null) { n.textContent = ""; return; }
    if (!v || REDUCE) { n.textContent = String(v); return; }
    // conta rapidinho até o valor final
    var t0 = performance.now();
    (function step(now) {
      var k = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - k, 5);
      n.textContent = String(Math.round(v * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function loadCounts(items) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    var ids = items.map(function (c) { return c.id; }).filter(function (id) { return CMT_N[id] == null; });
    if (!ids.length) return;
    var q = "in.(" + ids.map(function (id) { return '"' + id.replace(/"/g, "") + '"'; }).join(",") + ")";
    fetch(SUPABASE_URL + "/rest/v1/comments?select=campaign_id&limit=5000&campaign_id=" + encodeURIComponent(q), {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY }
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rows) {
        ids.forEach(function (id) { CMT_N[id] = 0; });
        rows.forEach(function (k) { if (k && k.campaign_id in CMT_N) CMT_N[k.campaign_id]++; });
        document.querySelectorAll(".post").forEach(function (a) { if (ids.indexOf(a._c.id) >= 0) paintCount(a); });
      })
      .catch(function () { /* sem contagem: o botão fica sem número */ });
  }

  /* ---------- Compartilhar: link que abre direto na campanha ---------- */
  var ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linejoin="miter"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
  var ICON_CMT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v13H9l-6 4z"/></svg>';
  var ICON_SND = '<svg class="i-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg><svg class="i-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  function linkOf(c) { return location.origin + location.pathname + "?c=" + encodeURIComponent(c.id); }
  function toast(msg) {
    var t = $("toast");
    if (!t) { t = el("div", "toast"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("on"); }, 2200);
  }
  function copy(text) {
    function legacy() {
      var ta = el("textarea"); ta.value = text; ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, legacy);
    return Promise.resolve(legacy());
  }
  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  document.addEventListener("click", function (e) { if (menu && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMenu(); closeComments(); } });
  window.addEventListener("scroll", closeMenu, { passive: true });
  function share(c, btn) {
    if (menu && menu._for === btn) { closeMenu(); return; }
    closeMenu();
    var url = linkOf(c);
    var title = (c.brand ? c.brand + ": " : "") + c.title;
    var txt = title + " · dropp Ad";
    menu = el("div", "sharemenu");
    menu._for = btn;
    menu.setAttribute("role", "menu");
    var field = el("input", "sharelink");
    field.value = url; field.readOnly = true;
    field.addEventListener("focus", function () { field.select(); });
    menu.appendChild(field);
    function item(label, fn) {
      var b = el("button", "shareitem", label); b.type = "button"; b.setAttribute("role", "menuitem");
      b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
      menu.appendChild(b);
    }
    function open(u) { window.open(u, "_blank", "noopener"); closeMenu(); }
    item("Copiar link", function () {
      copy(url).then(function (ok) {
        if (ok) { toast("Link copiado"); closeMenu(); } else { field.focus(); field.select(); toast("Selecione e copie o link"); }
      });
    });
    item("WhatsApp", function () { open("https://wa.me/?text=" + encodeURIComponent(txt + " " + url)); });
    item("X / Twitter", function () { open("https://x.com/intent/post?text=" + encodeURIComponent(txt) + "&url=" + encodeURIComponent(url)); });
    item("LinkedIn", function () { open("https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(url)); });
    item("E-mail", function () { location.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(txt + "\n\n" + url); closeMenu(); });
    if (navigator.share) item("Mais opções…", function () { navigator.share({ title: title, text: txt, url: url }).catch(function () {}); closeMenu(); });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(), w = menu.offsetWidth;
    var hgt = menu.offsetHeight;
    menu.style.top = (r.bottom + 8 + hgt > window.innerHeight - 8 && r.top - 8 - hgt > 8 ? r.top - 8 - hgt : r.bottom + 8) + "px";
    menu.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + "px";
  }

  /* ---------- Comentários (sistema próprio, no Supabase) ----------
     Login com Google (e Apple, quando APPLE_LOGIN = true). Os comentários ficam na tabela
     "comments" do seu projeto Supabase; o SQL está em supabase/comentarios.sql.
     Para esconder um comentário: Supabase → Table Editor → comments → marque "hidden".
     A chave abaixo é a pública ("anon"/"publishable"); ela pode ficar no site. */
  var SUPABASE_URL = "https://lwbqnvmagcplfheabcqp.supabase.co";
  var SUPABASE_KEY = "sb_publishable__1jrNtYNIVBoCi-AoZrkBQ_fiWexkIf";
  var APPLE_LOGIN = false;

  /* ---------- Contador de acessos (tabela "visits"; só o painel.html lê) ---------- */
  function registrarVisita() {
    if (!SUPABASE_URL || !SUPABASE_KEY || /[?&]code=/.test(location.search)) return;
    try {
      if (sessionStorage.getItem("ddrop-visita")) return; // uma por sessão do navegador
      sessionStorage.setItem("ddrop-visita", "1");
    } catch (e) { /* sem storage: conta mesmo assim */ }
    var vid = "";
    try {
      vid = localStorage.getItem("ddrop-vid") || "";
      if (!/^[a-z0-9]{16}$/.test(vid)) {
        vid = Array.from(crypto.getRandomValues(new Uint8Array(16)), function (b) { return "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]; }).join("");
        localStorage.setItem("ddrop-vid", vid);
      }
    } catch (e) { vid = "s" + Math.random().toString(36).slice(2, 17); }
    var ref = "";
    try { var r = document.referrer && new URL(document.referrer); if (r && r.host !== location.host) ref = r.host.replace(/^www\./, ""); } catch (e) { /* nada */ }
    var corpo = {
      visitor: vid, path: location.pathname.slice(0, 300), ref: ref.slice(0, 300) || null,
      campaign: (sharedId() || "").slice(0, 300) || null,
      device: matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop"
    };
    fetch(SUPABASE_URL + "/rest/v1/visits", {
      method: "POST", keepalive: true,
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(corpo)
    }).catch(function () { /* contador nunca atrapalha o site */ });
  }
  var sbReady = null, sb = null, me = null;
  function loadSb() {
    if (sbReady) return sbReady;
    sbReady = new Promise(function (ok, fail) {
      var sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      sc.async = true;
      sc.onload = function () {
        try {
          sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
          sb.auth.onAuthStateChange(function (_ev, s) { me = s ? s.user : null; refreshForm(); });
          sb.auth.getSession().then(function (r) { me = r.data.session ? r.data.session.user : null; ok(sb); }, function () { ok(sb); });
        } catch (e) { sbReady = null; fail(e); }
      };
      sc.onerror = function () { sbReady = null; fail(); };
      document.head.appendChild(sc);
    });
    return sbReady;
  }
  function nameOf(u) {
    var m = (u && u.user_metadata) || {};
    return m.full_name || m.name || "Você";
  }
  var fmtAgo = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  function ago(iso) {
    var s = (new Date(iso).getTime() - Date.now()) / 1000;
    var steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
    for (var i = 0; i < steps.length; i++) {
      if (Math.abs(s) < steps[i][0]) return fmtAgo.format(Math.round(s), steps[i][1]);
      s /= steps[i][0];
    }
    return "";
  }
  function cmtItem(k) {
    var li = el("li", "cmt-i");
    var av = el("span", "cmt-av");
    if (safeUrl(k.author_avatar || "")) {
      var img = document.createElement("img");
      img.src = k.author_avatar; img.alt = ""; img.referrerPolicy = "no-referrer"; img.loading = "lazy";
      img.onerror = function () { img.remove(); av.textContent = (k.author_name || "?").charAt(0).toUpperCase(); };
      av.appendChild(img);
    } else av.textContent = (k.author_name || "?").charAt(0).toUpperCase();
    li.appendChild(av);
    var box = el("div", "cmt-b");
    var hd = el("div", "cmt-h");
    hd.appendChild(el("b", null, k.author_name || "Leitor"));
    hd.appendChild(el("span", null, ago(k.created_at)));
    if (me && k.user_id === me.id) {
      var del = el("button", "cmt-del", "apagar"); del.type = "button";
      del.addEventListener("click", function () {
        del.disabled = true;
        sb.from("comments").delete().eq("id", k.id).then(function (r) {
          if (r.error) { del.disabled = false; toast("Não deu para apagar agora."); } else li.remove();
        });
      });
      hd.appendChild(del);
    }
    box.appendChild(hd);
    box.appendChild(el("p", "cmt-t", k.body));
    li.appendChild(box);
    return li;
  }
  var cur = null; // campanha aberta na gaveta
  function loadList(c, body) {
    var list = body.querySelector(".cmt-list");
    sb.from("comments").select("id,user_id,author_name,author_avatar,body,created_at")
      .eq("campaign_id", c.id).order("created_at", { ascending: true }).limit(300)
      .then(function (r) {
        if (cur !== c) return;
        list.textContent = "";
        if (r.error) { list.appendChild(el("li", "drawer-note", "Não foi possível carregar os comentários agora.")); return; }
        if (!r.data.length) list.appendChild(el("li", "drawer-note cmt-empty", "Ninguém comentou ainda. Comece a conversa."));
        r.data.forEach(function (k) { list.appendChild(cmtItem(k)); });
      });
  }
  function refreshForm() {
    if (!drawer || !cur) return;
    var f = drawer.querySelector(".cmt-form");
    if (!f) return;
    f.textContent = "";
    if (!me) {
      f.appendChild(el("p", "cmt-ask", "Entre para comentar:"));
      var row = el("div", "cmt-logins");
      function loginBtn(prov, label, icon) {
        var b = el("button", "cmt-login " + prov); b.type = "button";
        b.innerHTML = icon; b.appendChild(el("span", null, label));
        b.addEventListener("click", function () {
          try { sessionStorage.setItem("adCmt", cur.id); } catch (e) { /* nada */ }
          sb.auth.signInWithOAuth({ provider: prov, options: { redirectTo: linkOf(cur) } });
        });
        row.appendChild(b);
      }
      loginBtn("google", "Google", '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"/></svg>');
      if (APPLE_LOGIN) loginBtn("apple", "Apple", '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4zM13.9 5c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>');
      f.appendChild(row);
      return;
    }
    var ta = el("textarea", "cmt-in");
    ta.maxLength = 1000; ta.rows = 3; ta.placeholder = "Escreva seu comentário…";
    ta.setAttribute("aria-label", "Seu comentário");
    var bar = el("div", "cmt-bar");
    var who = el("span", "cmt-me", "Comentando como " + nameOf(me) + " · ");
    var out = el("button", "cmt-out", "sair"); out.type = "button";
    out.addEventListener("click", function () { sb.auth.signOut(); });
    who.appendChild(out);
    var send = el("button", "cmt-send", "Comentar"); send.type = "button";
    function post() {
      var txt = ta.value.trim();
      if (!txt || send.disabled) return;
      send.disabled = true;
      var c = cur;
      sb.from("comments").insert({ campaign_id: c.id, body: txt }).select("id,user_id,author_name,author_avatar,body,created_at").single()
        .then(function (r) {
          send.disabled = false;
          if (r.error) { toast(/rapido|devagar/i.test(r.error.message) ? "Calma: espere um pouco antes de comentar de novo." : "Não deu para enviar. Tente de novo."); return; }
          ta.value = "";
          if (cur !== c) return;
          var list = drawer.querySelector(".cmt-list");
          var empty = list.querySelector(".cmt-empty"); if (empty) empty.remove();
          list.appendChild(cmtItem(r.data));
          list.lastChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
    }
    send.addEventListener("click", post);
    ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); });
    bar.appendChild(who); bar.appendChild(send);
    f.appendChild(ta); f.appendChild(bar);
  }

  /* comentários abrem dentro do próprio post, logo abaixo dos botões */
  var drawer = null; // painel de comentários aberto (no post da campanha "cur")
  function closeComments() {
    if (!drawer) return;
    var p = drawer, btn = p.parentNode && p.parentNode.querySelector(".act.cmt");
    drawer = null; cur = null;
    if (btn) btn.setAttribute("aria-expanded", "false");
    p.style.height = p.scrollHeight + "px";
    requestAnimationFrame(function () { p.classList.remove("on"); p.style.height = "0px"; });
    setTimeout(function () { p.remove(); }, 450);
  }
  function openComments(c) {
    closeMenu();
    var art = document.querySelector('.post[data-id="' + (window.CSS && CSS.escape ? CSS.escape(c.id) : c.id) + '"]');
    if (!art) return;
    if (drawer && drawer.parentNode === art) { closeComments(); return; } // segundo clique fecha
    closeComments();
    drawer = el("section", "cmts");
    drawer.setAttribute("aria-label", "Comentários");
    var body = el("div", "drawer-body"), form = el("div", "cmt-form");
    drawer.appendChild(body);
    drawer.appendChild(form);
    art.appendChild(drawer);
    var btn = art.querySelector(".act.cmt");
    if (btn) btn.setAttribute("aria-expanded", "true");
    cur = c;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      body.appendChild(el("p", "drawer-note", "Comentários chegando em breve."));
    } else {
      var list = el("ul", "cmt-list");
      list.appendChild(el("li", "drawer-note", "Carregando comentários…"));
      body.appendChild(list);
      loadSb().then(function () { if (cur !== c) return; loadList(c, body); refreshForm(); },
        function () { body.textContent = ""; body.appendChild(el("p", "drawer-note", "Não foi possível carregar os comentários agora.")); });
    }
    // abre deslizando pra baixo; depois fica com a altura natural (cresce com a lista)
    var p = drawer;
    p.style.height = "0px";
    requestAnimationFrame(function () {
      p.classList.add("on");
      p.style.height = p.scrollHeight + "px";
      setTimeout(function () { if (p.classList.contains("on")) p.style.height = "auto"; }, 450);
    });
  }
  // volta do login: conclui a entrada e reabre a gaveta da campanha
  function resumeLogin() {
    if (!SUPABASE_URL || !/[?&]code=/.test(location.search)) return;
    var id = ""; try { id = sessionStorage.getItem("adCmt") || ""; sessionStorage.removeItem("adCmt"); } catch (e) { /* nada */ }
    loadSb().then(function () {
      var u = location.pathname + location.search.replace(/[?&](code|state)=[^&]*/g, "").replace(/^&/, "?") + location.hash;
      history.replaceState(null, "", u);
      var c = state.items.filter(function (k) { return k.id === id; })[0];
      if (c) openComments(c);
    }, function () { /* nada */ });
  }

  /* ---------- Card do fim do filme: a ideia e os créditos ---------- */
  function endCard(art, c) {
    var card = el("div", "endcard");
    var inner = el("div", "end-in");
    inner.appendChild(el("span", "end-k", "A ideia"));
    inner.appendChild(el("h3", "end-brand", c.brand || c.title));
    if (c.brand) inner.appendChild(el("p", "end-title", c.title));
    var idea = c.idea || c.summary;
    if (idea) inner.appendChild(el("p", "end-idea", idea));
    var rows = [];
    if (c.agency) rows.push(["Agência", c.agency]);
    c.credits.forEach(function (k) { if (!(k[0] === "Agência" && k[1] === c.agency)) rows.push(k); });
    rows.push(["Origem", flagOf(c.cc) + " " + (c.region || "Global")]);
    var dl = el("dl", "end-cred");
    rows.forEach(function (k) { dl.appendChild(el("dt", null, k[0])); dl.appendChild(el("dd", null, k[1])); });
    inner.appendChild(dl);
    var acts = el("div", "end-acts");
    var again = el("button", "end-btn", "↺ Ver de novo"); again.type = "button";
    again.addEventListener("click", function (e) { e.stopPropagation(); art.classList.remove("ended"); art.dataset.part = 0; activate(art, true); });
    acts.appendChild(again);
    var next = el("button", "end-btn", "Próxima ↓"); next.type = "button";
    next.addEventListener("click", function (e) { e.stopPropagation(); var n = art.nextElementSibling; if (n && n.classList.contains("post")) n.scrollIntoView({ behavior: "smooth", block: "center" }); });
    acts.appendChild(next);
    var shr = el("button", "end-btn share-end"); shr.type = "button";
    shr.setAttribute("aria-label", "Compartilhar esta campanha");
    shr.innerHTML = ICON_SHARE + "<span>Compartilhar</span>";
    shr.addEventListener("click", function (e) { e.stopPropagation(); share(c, shr); });
    acts.appendChild(shr);
    if (c.url) acts.appendChild(link("end-btn ghost", "Ler em " + (c.source || "fonte") + " ↗", c.url));
    inner.appendChild(acts);
    card.appendChild(inner);
    card.addEventListener("click", function (e) { e.stopPropagation(); });
    return card;
  }

  function sharedId() {
    var m = location.search.match(/[?&]c=([^&]+)/) || location.hash.match(/^#c=(.+)$/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  // abre a timeline a partir da campanha do link (sem montar centenas de telas antes dela)
  function goTo(id) {
    if (!id) return false;
    function find() { for (var i = 0; i < state.list.length; i++) if (state.list[i].id === id) return i; return -1; }
    var idx = find();
    if (idx < 0) {
      var alvo = state.items.filter(function (c) { return c.id === id; })[0];
      if (!alvo) return false;
      state.region = homeMatch(alvo) ? "home" : ""; state.upTo = "";
      idx = -1;
    }
    renderAll(true);
    idx = find();
    if (idx < 0) return false;
    if (idx > 0) {
      state.shown = idx;
      var back = el("button", "newer", "↑ Ver as campanhas mais recentes");
      back.type = "button";
      back.addEventListener("click", function () {
        try { history.replaceState(null, "", location.pathname); } catch (e) { /* nada */ }
        renderAll(); window.scrollTo(0, 0);
      });
      $("feed").appendChild(back);
    }
    renderMore();
    var art = $("feed").querySelector(".post");
    if (!art) return false;
    art.scrollIntoView({ block: "center" });
    setTimeout(function () { art.scrollIntoView({ block: "center" }); }, 400);
    return true;
  }
  window.addEventListener("hashchange", function () { goTo(sharedId()); });

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
    a.art.classList.remove("playing", "paused", "loading", "live", "ended");
    var host = a.art.querySelector(".host");
    if (host && a.art.classList.contains("is-vert")) {
      // Instagram/TikTok não aceitam pausa de fora: recarregar o post faz o vídeo parar
      var fr = host.querySelector("iframe");
      if (fr) { var src = fr.src; fr.src = "about:blank"; fr.src = src; }
    } else if (host) host.textContent = "";
    var bar = a.art.querySelector(".bar i");
    if (bar) bar.style.width = "0";
    var tg = a.art.querySelector(".ptime");
    if (tg) tg.textContent = "";
  }

  function activate(art, byUser) {
    if (active && active.art === art && !byUser) return;
    deactivate();
    var c = art._c;
    var me = { art: art, player: null, kind: "", timer: null };
    active = me;
    art.classList.add("live");
    function alive() { return active === me; }

    paintChrome(art);
    if (!c.fl.length) { me.kind = "card"; return; } // sem filme: só a imagem

    var part = Math.min(+art.dataset.part || 0, c.fl.length - 1);
    var f = c.fl[part];
    me.kind = f.kind;
    art.querySelectorAll(".fdot").forEach(function (d, i) { d.classList.toggle("on", i === part); });
    art.classList.remove("failed", "ended");
    var slot = el("div");
    art.querySelector(".host").appendChild(slot);
    art.classList.add("loading");
    function ended() {
      if (!alive()) return;
      if (part < c.fl.length - 1) { art.dataset.part = part + 1; activate(art, true); return; }
      art.classList.remove("playing", "paused", "loading");
      art.classList.add("ended");
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
      if (f.kind === "ig") { slot.className = "igbox"; fitIG(art._media); }
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
          playerVars: { autoplay: 1, mute: 1, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 1, cc_lang_pref: "pt", hl: "pt-BR" },
          events: {
            onReady: function (e) {
              if (!alive()) return;
              var pl = e.target;
              pl.mute(); pl.playVideo();
              if (!sound || blocked) return;
              pl.unMute(); pl.playVideo();
              if (!gestureAt) setTimeout(function () {
                if (!alive() || gestureAt) return;
                try { if (pl.getPlayerState() !== 1 || pl.isMuted()) fallbackMuted(function () { pl.mute(); }, function () { pl.playVideo(); }); } catch (err) { /* nada */ }
              }, 1200);
            },
            onStateChange: function (e) { if (e.data === 1) playing(); else if (e.data === 2) paused(); else if (e.data === 0) ended(); },
            onError: failed
          }
        });
        me.timer = setInterval(function () {
          if (!alive() || !me.player || !me.player.getDuration) return;
          try {
            var d = me.player.getDuration(), t = me.player.getCurrentTime();
            if (d) art.querySelector(".bar i").style.width = Math.min(100, t / d * 100) + "%";
            setTime(art, t, d);
          } catch (err) { /* carregando */ }
        }, 300);
      }).catch(failed);
    } else {
      loadVimeo().then(function (Vimeo) {
        if (!alive()) return;
        var p = new Vimeo.Player(slot, {
          url: "https://vimeo.com/" + f.id + (f.hash ? "/" + f.hash : ""),
          autoplay: true, muted: !(sound && !blocked && gestureAt), loop: false, playsinline: true, controls: true, dnt: true, texttrack: "pt",
          width: 1280, title: false, byline: false, portrait: false
        });
        me.player = p;
        p.on("play", playing);
        p.on("pause", paused);
        p.on("ended", ended);
        p.on("timeupdate", function (d) { if (alive()) { art.querySelector(".bar i").style.width = (d.percent * 100) + "%"; setTime(art, d.seconds, d.duration); } });
        p.ready().then(function () {
          if (!sound || blocked || gestureAt) return;
          p.setMuted(false).then(function () { return p.play(); }).catch(function () {});
          setTimeout(function () {
            if (!alive() || gestureAt) return;
            p.getPaused().then(function (x) { if (x) fallbackMuted(function () { p.setMuted(true); }, function () { p.play().catch(function () {}); }); });
          }, 1200);
        }).catch(failed);
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
    blocked = false;
    paintSound();
    if (!active || !active.player) return;
    try {
      if (active.kind === "yt") { if (on) active.player.unMute(); else active.player.mute(); active.player.playVideo(); }
      else if (active.kind === "vimeo") active.player.setMuted(!on).catch(function () {});
    } catch (e) { /* carregando */ }
  }

  /* ---------- Timeline (uma tela por campanha, rolagem infinita) ---------- */
  var moreIO = null;
  function renderMore() {
    var feed = $("feed");
    var slice = state.list.slice(state.shown, state.shown + LOTE);
    slice.forEach(function (c) {
      feed.appendChild(post(c, c._k || 0));
    });
    state.shown += slice.length;
    loadCounts(slice);
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
      feed.appendChild(el("p", "end", state.list.length ? "Você chegou ao início do arquivo." :
        state.region === "home" ? "Ainda não há campanhas de " + state.home.label + " no arquivo. Veja o Mundo." : "Nenhuma campanha com esse filtro."));
    }
  }
  // o país do visitante; se o arquivo não tiver nada de lá, vale a região (ex.: Ásia-Pacífico)
  function homeMatch(c) { return state.home.reg ? regiaoDe(c) === state.home.reg : c.cc === state.home.cc; }
  function setHome(cc) {
    var has = state.items.some(function (c) { return c.cc === cc; });
    var reg = has ? "" : regiaoDoPais(cc);
    // a aba sempre leva o nome do país; se ainda não houver campanha de lá, mostra a região dele
    state.home = { cc: cc, label: countryName(cc), reg: reg };
  }
  function renderAll(skipMore) {
    closeMenu();
    deactivate();
    ratios.clear();
    if (io) io.disconnect();
    if (pxIO) { pxIO.disconnect(); pxNear.clear(); }
    if (inIO) inIO.disconnect();
    var fd = $("feed");
    fd.textContent = "";
    if (!REDUCE) { fd.classList.add("swap"); requestAnimationFrame(function () { requestAnimationFrame(function () { fd.classList.remove("swap"); }); }); }
    state.shown = 0;
    state.list = state.items.filter(function (c) {
      if (state.upTo && c.date > state.upTo) return false;
      // Mundo = tudo; a outra aba é o país de quem entra
      return state.region !== "home" || homeMatch(c);
    });
    state.perDay = {};
    state.list.forEach(function (c) { c._k = state.perDay[c.date] || 0; state.perDay[c.date] = c._k + 1; });
    renderChips();
    renderCal();
    if (!skipMore) renderMore();
  }
  function renderChips() {
    var box = $("chips"), sel = $("reg-sel");
    box.textContent = "";
    if (sel) sel.textContent = "";
    var h = state.home;
    // só duas abas: o mundo inteiro e o país de quem entra (EUA, Brasil, Japão…)
    var opts = [["", "Mundo"], ["home", h.label]];
    opts.forEach(function (o) {
      var on = (state.region || "") === o[0];
      var b = el("button", null, o[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () { state.region = o[0]; window.scrollTo(0, 0); renderAll(); });
      box.appendChild(b);
      if (sel) { var op = el("option", null, o[1]); op.value = o[0]; op.selected = on; sel.appendChild(op); }
      if (on) $("reg-txt").textContent = o[1];
    });
  }
  (function () {
    var sel = $("reg-sel");
    if (sel) sel.addEventListener("change", function () { state.region = sel.value; window.scrollTo(0, 0); renderAll(); });
  })();

  /* ---------- Data na lateral e o convite pra rolar ---------- */
  function nextPost(art) { var n = art.nextElementSibling; while (n && !n.classList.contains("post")) n = n.nextElementSibling; return n; }
  function paintChrome(art) {
    var c = art._c;
    var dd = c.date.slice(8, 10), mm = MESES[+c.date.slice(5, 7) - 1], sd = $("sidedate");
    if ($("sd-d").textContent !== dd || $("sd-m").textContent !== mm) {
      // a data troca linha por linha, revelada de baixo pra cima
      sd.classList.add("swap");
      $("sd-d").textContent = dd; $("sd-m").textContent = mm;
      void sd.offsetWidth;
      sd.classList.remove("swap");
    }
    var tot = state.perDay[c.date] || 0;
    $("readbar").style.transform = "scaleX(" + (tot ? Math.min(1, ((art._k || 0) + 1) / tot) : 0) + ")";
    var left = tot - ((art._k || 0) + 1), t = "";
    var quando = c.date === TODAY ? " HOJE" : c.date === shift(TODAY, -1) ? " ONTEM" : " NESTE DIA";
    if (left > 0 && nextPost(art)) t = "MAIS " + left + (left === 1 ? " ESTREIA" : " ESTREIAS") + quando;
    $("cue-txt").textContent = t;
    $("cue").hidden = !t;
    $("cue-btn").setAttribute("aria-label", t ? "Rolar para a próxima campanha. " + t.toLowerCase() : "");
  }
  $("cue-btn").addEventListener("click", function () {
    var a = active ? active.art : document.querySelector(".post");
    var n = a && nextPost(a);
    if (n) n.scrollIntoView({ block: "center", behavior: REDUCE ? "auto" : "smooth" });
  });

  /* ---------- Rolagem: topo some/volta, parallax leve (num só requestAnimationFrame) ---------- */
  (function () {
    var topbar = $("topbar");
    // imagens andam um pouco mais devagar que a página; no celular, metade disso
    var PARALLAX = window.matchMedia("(pointer: coarse)").matches ? 0.03 : 0.06;
    var lastY = window.scrollY, ticking = false;
    function frame() {
      ticking = false;
      var y = window.scrollY, vh = window.innerHeight;
      if (y > 10 && y - lastY > 2) topbar.classList.add("hide");
      else if (lastY - y > 2 || y <= 10) topbar.classList.remove("hide");
      lastY = y;
      if (REDUCE) return;
      pxNear.forEach(function (m) {
        var im = m.querySelector(".cover img");
        if (!im) return;
        var box = m.getBoundingClientRect();
        var t = ((box.top + box.height / 2) - vh / 2) / vh;
        im.style.transform = "translate3d(0," + (t * -PARALLAX * box.height).toFixed(1) + "px,0)";
      });
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  })();

  /* ---------- Calendário: começa a timeline no dia escolhido (e segue para trás) ---------- */
  function renderCal() {
    var inp = $("cal-in");
    if (!inp) return;
    var datas = state.items.map(function (c) { return c.date; }).sort();
    if (datas.length) { inp.min = datas[0]; inp.max = datas[datas.length - 1]; }
    inp.value = state.upTo || "";
    $("cal-txt").textContent = state.upTo ? (+state.upTo.slice(8, 10)) + " " + MESES[+state.upTo.slice(5, 7) - 1].toLowerCase() : "Hoje";
    $("cal").classList.toggle("on", !!state.upTo);
    $("cal-x").hidden = !state.upTo;
  }
  (function () {
    var inp = $("cal-in");
    if (!inp) return;
    inp.addEventListener("click", function () { try { if (inp.showPicker) inp.showPicker(); } catch (e) { /* abre do jeito nativo */ } });
    inp.addEventListener("change", function () {
      if (inp.value && !/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return;
      state.upTo = inp.value || "";
      window.scrollTo(0, 0);
      renderAll();
    });
    $("cal-x").addEventListener("click", function () { state.upTo = ""; window.scrollTo(0, 0); renderAll(); });
  })();

  /* ---------- Teclado: setas pulam de campanha em campanha ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    var posts = Array.prototype.slice.call(document.querySelectorAll(".post"));
    if (!posts.length) return;
    var cur = active ? posts.indexOf(active.art) : 0;
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); if (posts[cur + 1]) posts[cur + 1].scrollIntoView({ behavior: "smooth", block: "center" }); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); if (posts[cur - 1]) posts[cur - 1].scrollIntoView({ behavior: "smooth", block: "center" }); }
    else if (e.key === " ") { e.preventDefault(); togglePause(); }
    else if (e.key === "m") setSound(!sound);
  });

  /* ---------- Novidades: com a página aberta, confere a cada minuto se o robô publicou algo ----------
     Confere novidades.json (poucos bytes) e só baixa campaigns.json inteiro quando ele mudou. */
  var lastCheck = Date.now(), pending = null, lastStamp = null;
  function pollNew() {
    lastCheck = Date.now();
    fetch("novidades.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (n) {
        var stamp = n.atualizado + "|" + n.total + "|" + n.ultimo;
        if (lastStamp === null) { lastStamp = stamp; return; }
        if (stamp !== lastStamp) { lastStamp = stamp; checkNew(); }
      })
      .catch(function () { /* tenta de novo no próximo minuto */ });
  }
  function checkNew() {
    loadData("no-store")
      .then(function (raw) {
        var fresh = normalize(raw);
        var known = {};
        state.items.forEach(function (c) { known[c.id] = 1; });
        var n = fresh.filter(function (c) { return !known[c.id]; }).length;
        if (!n) return;
        pending = fresh;
        var pill = $("newpill");
        if (!pill) {
          pill = el("button", "newpill"); pill.id = "newpill"; pill.type = "button";
          pill.addEventListener("click", function () {
            if (!pending) return;
            state.items = pending; pending = null; pill.remove();
            try { history.replaceState(null, "", location.pathname); } catch (e) { /* nada */ }
            window.scrollTo(0, 0); renderAll();
          });
          document.body.appendChild(pill);
        }
        pill.textContent = "↑ " + n + (n === 1 ? " campanha nova" : " campanhas novas");
      })
      .catch(function () { /* tenta de novo na próxima */ });
  }
  pollNew();
  setInterval(function () { if (!document.hidden) pollNew(); }, 60 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - lastCheck > 60 * 1000) pollNew(); });

  /* ---------- Botões magnéticos: puxam de leve na direção do mouse (máx. 5px; só com mouse) ---------- */
  (function () {
    if (REDUCE || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var MAG = ".tool, .seg button, .act, .more-btn, .mute, .more-cue button", cur = null;
    function release() { if (cur) { cur.style.transform = ""; cur = null; } }
    document.addEventListener("mousemove", function (e) {
      var b = e.target.closest && e.target.closest(MAG);
      if (!b) { release(); return; }
      if (b !== cur) { release(); cur = b; b.classList.add("mag"); }
      var r = b.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width * 2 - 1, dy = (e.clientY - r.top) / r.height * 2 - 1;
      b.style.transform = "translate(" + (dx * 5).toFixed(1) + "px," + (dy * 5).toFixed(1) + "px)";
    }, { passive: true });
    document.addEventListener("mouseleave", release);
    window.addEventListener("scroll", release, { passive: true });
  })();

  /* ---------- Início ---------- */
  $("sound").addEventListener("click", function () { setSound(Date.now() - unblockedAt < 1000 ? true : !sound); });
  paintSound();
  $("top").addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  document.addEventListener("visibilitychange", function () {
    if (!active || !active.player) return;
    try {
      if (document.hidden) { if (active.kind === "yt") active.player.pauseVideo(); else active.player.pause(); }
      else { if (active.kind === "yt") active.player.playVideo(); else active.player.play(); }
    } catch (e) { /* nada */ }
  });
  setupIO();
  // feed.json é a versão enxuta (gerada na publicação); campaigns.json fica de reserva.
  // "no-cache" revalida com o servidor: se nada mudou, o navegador usa a cópia que já tem.
  function loadData(mode) {
    function get(f) { return fetch(f, { cache: mode }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
    return get("feed.json").catch(function () { return get("campaigns.json"); });
  }
  // dados e país de quem entra chegam ao mesmo tempo
  Promise.all([loadData("no-cache"), detectCountry()])
    .then(function (res) {
      state.items = normalize(res[0]);
      setHome(res[1]);
      $("status").hidden = true;
      renderAll();
      goTo(sharedId());
      resumeLogin();
      registrarVisita();
    })
    .catch(function (err) {
      console.log("ERRO", err && err.stack);
      $("status").textContent = "Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.";
    });
})();
