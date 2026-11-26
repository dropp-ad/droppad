/* droppad (dropp.ad): timeline de campanhas, uma por vez na tela (rolagem que para em cada uma).
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
    if (m) return { kind: "ig", id: m[2], reel: m[1].indexOf("reel") === 0, src: "https://www.instagram.com/" + (m[1].indexOf("reel") === 0 ? "reel" : m[1]) + "/" + m[2] + "/embed/?cr=1&v=14&wp=400" };
    m = (u || "").match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
    if (m) return { kind: "tt", id: m[1], src: "https://www.tiktok.com/player/v1/" + m[1] + "?autoplay=0&muted=1&loop=1&controls=1&description=0&music_info=0" };
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
    if (x.creatives) add(tr("Criação"), x.creatives);
    if (x.production) add(tr("Produtora"), x.production);
    if (x.director) add(tr("Direção"), x.director);
    return out;
  }
  // Malásia e Índia: só entram campanhas de agências dos grandes grupos internacionais
  var SO_REDE = { MY: 1, IN: 1 };
  var REDES = /\b(ogilvy|mccann|bbdo|ddb|tbwa|media arts lab|leo burnett|leo|publicis|saatchi|grey|vml|vmly&r|wunderman|jwt|walter thompson|fcb|havas|dentsu|isobar|lowe|y&r|wieden|w\+k|72andsunny|droga5|accenture song|cheil|hakuhodo|bbh|akqa|r\/ga|serviceplan|edelman|digitas|sapient|mullen|lintas|wpp|omnicom|interpublic|ipg|initiative|mindshare|wavemaker|essencemediacom|mediacom|omd|phd|starcom|zenith|spark foundry|carat|iprospect|taproot|ulka|mudra|monks|razorfish|deutsch|innocean|merkle|geometry|tribal|landor|weber shandwick|golin|burson|hill & knowlton|ketchum|fleishmanhillard)\b/i;
  function foraDaRede(c) { return !!SO_REDE[c.cc] && !REDES.test(c.agency); }
  // post institucional da própria agência no Instagram (equipe, datas, eventos), não campanha:
  // a "marca" saiu da própria agência (HLK → HLKers) ou o título é de agradecimento/bastidores
  var INSTITUCIONAL = /\b(thankful|thanksgiving|grateful|gratid[aã]o|happy holidays|feliz natal|boas festas|our (team|people|office|family)|nosso time|nossa equipe|meet the (people|team)|meet our|conhe[cç]a (o )?nosso|conhe[cç]a (a )?nossa|we'?re hiring|estamos contratando|vagas|anniversary|anivers[aá]rio|birthday|tbt|throwback|reflects on|portfolio night|is a wrap|year in review|retrospectiva|first year|primeiro ano)\b/i;
  var TEM_PECA = /\b(campaign|campanha|campaña|film|filme|spot|commercial|comercial|anúncio|ad)\b/i;
  function soLetras(x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function institucional(c) {
    if (!/^Instagram/.test(c.source)) return false;
    var a = soLetras(c.agency), b = soLetras(c.brand);
    if (a.length >= 3 && b.indexOf(a) === 0 && !TEM_PECA.test(c.title)) return true;
    return INSTITUCIONAL.test(c.title);
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
        idea: str(x.idea), frase: str(x.frase), credits: creditsOf(x), tl: !!x.tl,
        igm: Array.isArray(x.igm) && x.igm.length === 2 && +x.igm[1] > 100 ? [+x.igm[0], +x.igm[1]] : null
      };
      c.fl = films(c);
      return c;
    }).filter(function (c) { return isDay(c.date) && c.title && !c.hidden && !foraDaRede(c) && !institucional(c); })
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
    if (LANG === "pt" && nomes[cc]) return nomes[cc];
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

  /* ---------- Língua: a do país de quem entra (o mesmo mapa do Contato) ---------- */
  // ordem das traduções: en, es, fr, de, it, nl, ja, ko, zh (o português é a própria chave)
  var LINGUAS = ["en", "es", "fr", "de", "it", "nl", "ja", "ko", "zh"];
  var LOCALE = { pt: "pt-BR", en: "en", es: "es", fr: "fr", de: "de", it: "it", nl: "nl", ja: "ja", ko: "ko", zh: "zh-CN" };
  var TXT = {
    "Criação": ["Creative", "Creatividad", "Création", "Kreation", "Creatività", "Creatie", "クリエイティブ", "크리에이티브", "创意"],
    "Produtora": ["Production", "Productora", "Production", "Produktion", "Casa di produzione", "Productie", "制作会社", "제작사", "制作公司"],
    "Direção": ["Director", "Dirección", "Réalisation", "Regie", "Regia", "Regie", "監督", "감독", "导演"],
    "Agência": ["Agency", "Agencia", "Agence", "Agentur", "Agenzia", "Bureau", "エージェンシー", "대행사", "代理商"],
    "Origem": ["Origin", "Origen", "Origine", "Herkunft", "Origine", "Herkomst", "地域", "지역", "地区"],
    "A ideia": ["The idea", "La idea", "L'idée", "Die Idee", "L'idea", "Het idee", "アイデア", "아이디어", "创意概念"],
    "Estreou hoje": ["Launched today", "Estrenó hoy", "Sorti aujourd'hui", "Heute gestartet", "Uscito oggi", "Vandaag gelanceerd", "本日公開", "오늘 공개", "今日上线"],
    "Estreou ontem": ["Launched yesterday", "Estrenó ayer", "Sorti hier", "Gestern gestartet", "Uscito ieri", "Gisteren gelanceerd", "昨日公開", "어제 공개", "昨日上线"],
    "Estreou {d}": ["Launched {d}", "Estrenó el {d}", "Sorti le {d}", "Gestartet am {d}", "Uscito il {d}", "Gelanceerd op {d}", "{d}公開", "{d} 공개", "{d}上线"],
    "há {n} min": ["{n} min ago", "hace {n} min", "il y a {n} min", "vor {n} Min.", "{n} min fa", "{n} min geleden", "{n}分前", "{n}분 전", "{n}分钟前"],
    "há {n} h": ["{n} h ago", "hace {n} h", "il y a {n} h", "vor {n} Std.", "{n} h fa", "{n} u geleden", "{n}時間前", "{n}시간 전", "{n}小时前"],
    "Ver mais": ["See more", "Ver más", "Voir plus", "Mehr anzeigen", "Mostra altro", "Meer zien", "もっと見る", "더 보기", "展开"],
    "Ver menos": ["See less", "Ver menos", "Voir moins", "Weniger anzeigen", "Mostra meno", "Minder zien", "閉じる", "접기", "收起"],
    "fonte": ["source", "fuente", "source", "Quelle", "fonte", "bron", "出典", "출처", "来源"],
    "Ler a matéria completa em {s} ↗": ["Read the full story on {s} ↗", "Leer la nota completa en {s} ↗", "Lire l'article complet sur {s} ↗", "Ganzen Artikel auf {s} lesen ↗", "Leggi l'articolo completo su {s} ↗", "Lees het hele artikel op {s} ↗", "{s}で記事を読む ↗", "{s}에서 기사 전문 보기 ↗", "在 {s} 阅读全文 ↗"],
    "Ler a matéria completa ↗": ["Read the full story ↗", "Leer la nota completa ↗", "Lire l'article complet ↗", "Ganzen Artikel lesen ↗", "Leggi l'articolo completo ↗", "Lees het hele artikel ↗", "記事を読む ↗", "기사 전문 보기 ↗", "阅读全文 ↗"],
    "Ler o resto do texto": ["Read the rest", "Leer el resto", "Lire la suite", "Weiterlesen", "Leggi il resto", "Lees verder", "続きを読む", "나머지 읽기", "阅读剩余内容"],
    "Ler mais": ["Read more", "Leer más", "Lire plus", "Mehr lesen", "Leggi di più", "Lees meer", "続きを読む", "더 읽기", "阅读更多"],
    "Ler a matéria em {s}": ["Read the story on {s}", "Leer la nota en {s}", "Lire l'article sur {s}", "Artikel auf {s} lesen", "Leggi l'articolo su {s}", "Lees het artikel op {s}", "{s}で記事を読む", "{s}에서 기사 보기", "在 {s} 阅读"],
    "Ler em {s} ↗": ["Read on {s} ↗", "Leer en {s} ↗", "Lire sur {s} ↗", "Auf {s} lesen ↗", "Leggi su {s} ↗", "Lees op {s} ↗", "{s}で読む ↗", "{s}에서 보기 ↗", "在 {s} 阅读 ↗"],
    "Ver matéria ↗": ["Read story ↗", "Ver nota ↗", "Voir l'article ↗", "Zum Artikel ↗", "Vedi articolo ↗", "Bekijk artikel ↗", "記事を見る ↗", "기사 보기 ↗", "查看报道 ↗"],
    " para ": [" for ", " para ", " pour ", " für ", " per ", " voor ", " × ", " × ", " × "],
    "via {s}": ["via {s}", "vía {s}", "via {s}", "via {s}", "via {s}", "via {s}", "{s}より", "{s} 경유", "来自 {s}"],
    "{b} no {p}": ["{b} on {p}", "{b} en {p}", "{b} sur {p}", "{b} auf {p}", "{b} su {p}", "{b} op {p}", "{p}の{b}", "{p}의 {b}", "{b} 的 {p}"],
    "Mais opções": ["More options", "Más opciones", "Plus d'options", "Weitere Optionen", "Altre opzioni", "Meer opties", "その他", "더 보기", "更多选项"],
    "Mais opções…": ["More options…", "Más opciones…", "Plus d'options…", "Weitere Optionen…", "Altre opzioni…", "Meer opties…", "その他…", "더 보기…", "更多选项…"],
    "Copiar link": ["Copy link", "Copiar enlace", "Copier le lien", "Link kopieren", "Copia link", "Link kopiëren", "リンクをコピー", "링크 복사", "复制链接"],
    "Link copiado": ["Link copied", "Enlace copiado", "Lien copié", "Link kopiert", "Link copiato", "Link gekopieerd", "リンクをコピーしました", "링크를 복사했어요", "链接已复制"],
    "Selecione e copie o link": ["Select and copy the link", "Selecciona y copia el enlace", "Sélectionnez et copiez le lien", "Link markieren und kopieren", "Seleziona e copia il link", "Selecteer en kopieer de link", "リンクを選択してコピーしてください", "링크를 선택해 복사하세요", "请选择并复制链接"],
    "Este filme só toca no YouTube ↗": ["This film only plays on YouTube ↗", "Este video solo se ve en YouTube ↗", "Ce film ne se lit que sur YouTube ↗", "Dieser Film läuft nur auf YouTube ↗", "Questo video si vede solo su YouTube ↗", "Deze film speelt alleen op YouTube ↗", "この動画はYouTubeでのみ再生できます ↗", "이 영상은 YouTube에서만 재생돼요 ↗", "此视频仅能在 YouTube 播放 ↗"],
    "Ligar ou desligar o som": ["Sound on or off", "Activar o desactivar el sonido", "Activer ou couper le son", "Ton an oder aus", "Attiva o disattiva l'audio", "Geluid aan of uit", "音声のオン・オフ", "소리 켜기/끄기", "打开或关闭声音"],
    "Filme {i} de {n}": ["Film {i} of {n}", "Video {i} de {n}", "Film {i} sur {n}", "Film {i} von {n}", "Video {i} di {n}", "Film {i} van {n}", "動画 {i}/{n}", "영상 {i}/{n}", "视频 {i}/{n}"],
    "Comentários sobre esta campanha": ["Comments on this campaign", "Comentarios sobre esta campaña", "Commentaires sur cette campagne", "Kommentare zu dieser Kampagne", "Commenti su questa campagna", "Reacties op deze campagne", "このキャンペーンへのコメント", "이 캠페인에 대한 댓글", "关于此广告的评论"],
    "Compartilhar esta campanha": ["Share this campaign", "Compartir esta campaña", "Partager cette campagne", "Diese Kampagne teilen", "Condividi questa campagna", "Deel deze campagne", "このキャンペーンをシェア", "이 캠페인 공유", "分享此广告"],
    "Comentar": ["Comment", "Comentar", "Commenter", "Kommentieren", "Commenta", "Reageren", "コメント", "댓글", "评论"],
    "Compartilhar": ["Share", "Compartir", "Partager", "Teilen", "Condividi", "Delen", "シェア", "공유", "分享"],
    "Você": ["You", "Tú", "Vous", "Du", "Tu", "Jij", "あなた", "나", "你"],
    "Leitor": ["Reader", "Lector", "Lecteur", "Leser", "Lettore", "Lezer", "読者", "독자", "读者"],
    "Não deu para apagar agora.": ["Couldn't delete it right now.", "No se pudo borrar ahora.", "Impossible de supprimer pour l'instant.", "Löschen gerade nicht möglich.", "Impossibile eliminare ora.", "Verwijderen lukt nu niet.", "今は削除できませんでした。", "지금은 삭제할 수 없어요.", "暂时无法删除。"],
    "Não foi possível carregar os comentários agora.": ["Couldn't load the comments right now.", "No se pudieron cargar los comentarios ahora.", "Impossible de charger les commentaires pour l'instant.", "Kommentare konnten gerade nicht geladen werden.", "Impossibile caricare i commenti ora.", "Reacties laden lukt nu niet.", "今はコメントを読み込めませんでした。", "지금은 댓글을 불러올 수 없어요.", "暂时无法加载评论。"],
    "Ninguém comentou ainda. Comece a conversa.": ["No comments yet. Start the conversation.", "Nadie comentó todavía. Empieza la conversación.", "Aucun commentaire pour l'instant. Lancez la discussion.", "Noch keine Kommentare. Fang die Unterhaltung an.", "Ancora nessun commento. Inizia tu la conversazione.", "Nog geen reacties. Begin het gesprek.", "まだコメントはありません。最初のコメントをどうぞ。", "아직 댓글이 없어요. 첫 댓글을 남겨 보세요.", "还没有评论，来说两句吧。"],
    "Entre para comentar:": ["Sign in to comment:", "Inicia sesión para comentar:", "Connectez-vous pour commenter :", "Zum Kommentieren anmelden:", "Accedi per commentare:", "Log in om te reageren:", "ログインしてコメント：", "로그인하고 댓글 달기:", "登录后评论："],
    "Escreva seu comentário…": ["Write your comment…", "Escribe tu comentario…", "Écrivez votre commentaire…", "Schreib deinen Kommentar…", "Scrivi il tuo commento…", "Schrijf je reactie…", "コメントを入力…", "댓글을 입력하세요…", "写下你的评论…"],
    "Seu comentário": ["Your comment", "Tu comentario", "Votre commentaire", "Dein Kommentar", "Il tuo commento", "Je reactie", "コメント", "댓글", "你的评论"],
    "Comentando como {s} · ": ["Commenting as {s} · ", "Comentando como {s} · ", "Vous commentez en tant que {s} · ", "Du kommentierst als {s} · ", "Commenti come {s} · ", "Je reageert als {s} · ", "{s}としてコメント · ", "{s}(으)로 댓글 작성 중 · ", "以 {s} 的身份评论 · "],
    "Calma: espere um pouco antes de comentar de novo.": ["Easy: wait a moment before commenting again.", "Calma: espera un poco antes de volver a comentar.", "Doucement : attendez un peu avant de recommenter.", "Langsam: Warte kurz, bevor du wieder kommentierst.", "Calma: aspetta un po' prima di commentare di nuovo.", "Rustig aan: wacht even voor je opnieuw reageert.", "少し時間をおいてからコメントしてください。", "잠시 후에 다시 댓글을 달아 주세요.", "请稍等片刻再评论。"],
    "Não deu para enviar. Tente de novo.": ["Couldn't send it. Please try again.", "No se pudo enviar. Inténtalo de nuevo.", "Échec de l'envoi. Réessayez.", "Senden fehlgeschlagen. Bitte erneut versuchen.", "Invio non riuscito. Riprova.", "Versturen mislukt. Probeer opnieuw.", "送信できませんでした。もう一度お試しください。", "전송하지 못했어요. 다시 시도해 주세요.", "发送失败，请重试。"],
    "Comentários": ["Comments", "Comentarios", "Commentaires", "Kommentare", "Commenti", "Reacties", "コメント", "댓글", "评论"],
    "Comentários chegando em breve.": ["Comments coming soon.", "Comentarios muy pronto.", "Les commentaires arrivent bientôt.", "Kommentare kommen bald.", "Commenti in arrivo.", "Reacties komen binnenkort.", "コメント機能は近日公開。", "댓글 기능이 곧 열려요.", "评论功能即将上线。"],
    "Carregando comentários…": ["Loading comments…", "Cargando comentarios…", "Chargement des commentaires…", "Kommentare werden geladen…", "Caricamento commenti…", "Reacties laden…", "コメントを読み込み中…", "댓글을 불러오는 중…", "正在加载评论…"],
    "↺ Ver de novo": ["↺ Watch again", "↺ Ver de nuevo", "↺ Revoir", "↺ Noch mal ansehen", "↺ Rivedi", "↺ Opnieuw kijken", "↺ もう一度見る", "↺ 다시 보기", "↺ 再看一遍"],
    "Próxima ↓": ["Next ↓", "Siguiente ↓", "Suivante ↓", "Nächste ↓", "Successiva ↓", "Volgende ↓", "次へ ↓", "다음 ↓", "下一个 ↓"],
    "↑ Ver as campanhas mais recentes": ["↑ See the latest campaigns", "↑ Ver las campañas más recientes", "↑ Voir les campagnes les plus récentes", "↑ Neueste Kampagnen ansehen", "↑ Vedi le campagne più recenti", "↑ Bekijk de nieuwste campagnes", "↑ 最新のキャンペーンを見る", "↑ 최신 캠페인 보기", "↑ 查看最新广告"],
    "Você chegou ao início do arquivo.": ["You've reached the start of the archive.", "Llegaste al inicio del archivo.", "Vous êtes arrivé au début des archives.", "Du bist am Anfang des Archivs angekommen.", "Sei arrivato all'inizio dell'archivio.", "Je bent bij het begin van het archief.", "アーカイブの最初に到達しました。", "아카이브의 처음까지 왔어요.", "已经到档案的开头了。"],
    "Ainda não há campanhas de {s} no arquivo. Veja o Mundo.": ["No campaigns from {s} in the archive yet. See the World tab.", "Todavía no hay campañas de {s} en el archivo. Mira Mundo.", "Pas encore de campagnes de {s} dans les archives. Voir Monde.", "Noch keine Kampagnen aus {s} im Archiv. Sieh dir Welt an.", "Ancora nessuna campagna da {s} nell'archivio. Guarda Mondo.", "Nog geen campagnes uit {s} in het archief. Bekijk Wereld.", "{s}のキャンペーンはまだありません。「世界」をご覧ください。", "아직 {s} 캠페인이 없어요. '세계'를 확인해 보세요.", "档案中还没有{s}的广告，请看“全球”。"],
    "Nenhuma campanha com esse filtro.": ["No campaigns with this filter.", "Ninguna campaña con este filtro.", "Aucune campagne avec ce filtre.", "Keine Kampagnen mit diesem Filter.", "Nessuna campagna con questo filtro.", "Geen campagnes met dit filter.", "この条件のキャンペーンはありません。", "이 조건에 맞는 캠페인이 없어요.", "没有符合条件的广告。"],
    "Mundo": ["World", "Mundo", "Monde", "Welt", "Mondo", "Wereld", "世界", "세계", "全球"],
    "MAIS {n} ESTREIA HOJE": ["{n} MORE LAUNCH TODAY", "{n} ESTRENO MÁS HOY", "ENCORE {n} SORTIE AUJOURD'HUI", "NOCH {n} START HEUTE", "ALTRA {n} USCITA OGGI", "NOG {n} LANCERING VANDAAG", "本日あと{n}件", "오늘 {n}개 더", "今天还有 {n} 个"],
    "MAIS {n} ESTREIAS HOJE": ["{n} MORE LAUNCHES TODAY", "{n} ESTRENOS MÁS HOY", "ENCORE {n} SORTIES AUJOURD'HUI", "NOCH {n} STARTS HEUTE", "ALTRE {n} USCITE OGGI", "NOG {n} LANCERINGEN VANDAAG", "本日あと{n}件", "오늘 {n}개 더", "今天还有 {n} 个"],
    "MAIS {n} ESTREIA ONTEM": ["{n} MORE LAUNCH YESTERDAY", "{n} ESTRENO MÁS AYER", "ENCORE {n} SORTIE HIER", "NOCH {n} START GESTERN", "ALTRA {n} USCITA IERI", "NOG {n} LANCERING GISTEREN", "昨日あと{n}件", "어제 {n}개 더", "昨天还有 {n} 个"],
    "MAIS {n} ESTREIAS ONTEM": ["{n} MORE LAUNCHES YESTERDAY", "{n} ESTRENOS MÁS AYER", "ENCORE {n} SORTIES HIER", "NOCH {n} STARTS GESTERN", "ALTRE {n} USCITE IERI", "NOG {n} LANCERINGEN GISTEREN", "昨日あと{n}件", "어제 {n}개 더", "昨天还有 {n} 个"],
    "MAIS {n} ESTREIA NESTE DIA": ["{n} MORE LAUNCH THIS DAY", "{n} ESTRENO MÁS ESTE DÍA", "ENCORE {n} SORTIE CE JOUR-LÀ", "NOCH {n} START AN DIESEM TAG", "ALTRA {n} USCITA QUEL GIORNO", "NOG {n} LANCERING DEZE DAG", "この日あと{n}件", "이날 {n}개 더", "当天还有 {n} 个"],
    "MAIS {n} ESTREIAS NESTE DIA": ["{n} MORE LAUNCHES THIS DAY", "{n} ESTRENOS MÁS ESTE DÍA", "ENCORE {n} SORTIES CE JOUR-LÀ", "NOCH {n} STARTS AN DIESEM TAG", "ALTRE {n} USCITE QUEL GIORNO", "NOG {n} LANCERINGEN DEZE DAG", "この日あと{n}件", "이날 {n}개 더", "当天还有 {n} 个"],
    "Rolar para a próxima campanha. {s}": ["Scroll to the next campaign. {s}", "Ir a la siguiente campaña. {s}", "Aller à la campagne suivante. {s}", "Zur nächsten Kampagne scrollen. {s}", "Vai alla campagna successiva. {s}", "Naar de volgende campagne. {s}", "次のキャンペーンへ。{s}", "다음 캠페인으로. {s}", "滚动到下一个广告。{s}"],
    "Voltar ao topo": ["Back to top", "Volver arriba", "Retour en haut", "Nach oben", "Torna su", "Terug naar boven", "トップへ戻る", "맨 위로", "回到顶部"],
    "Hoje": ["Today", "Hoy", "Aujourd'hui", "Heute", "Oggi", "Vandaag", "今日", "오늘", "今天"],
    "↑ {n} campanha nova": ["↑ {n} new campaign", "↑ {n} campaña nueva", "↑ {n} nouvelle campagne", "↑ {n} neue Kampagne", "↑ {n} nuova campagna", "↑ {n} nieuwe campagne", "↑ 新着 {n} 件", "↑ 새 캠페인 {n}개", "↑ {n} 个新广告"],
    "↑ {n} campanhas novas": ["↑ {n} new campaigns", "↑ {n} campañas nuevas", "↑ {n} nouvelles campagnes", "↑ {n} neue Kampagnen", "↑ {n} nuove campagne", "↑ {n} nieuwe campagnes", "↑ 新着 {n} 件", "↑ 새 캠페인 {n}개", "↑ {n} 个新广告"],
    "Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.": ["Couldn't load the campaigns. Reload the page in a few minutes.", "No se pudieron cargar las campañas. Recarga la página en unos minutos.", "Impossible de charger les campagnes. Rechargez la page dans quelques minutes.", "Kampagnen konnten nicht geladen werden. Lade die Seite in ein paar Minuten neu.", "Impossibile caricare le campagne. Ricarica la pagina tra qualche minuto.", "Campagnes laden lukt niet. Herlaad de pagina over een paar minuten.", "キャンペーンを読み込めませんでした。数分後に再読み込みしてください。", "캠페인을 불러오지 못했어요. 잠시 후 새로고침해 주세요.", "无法加载广告，请几分钟后刷新页面。"],
    "Carregando campanhas…": ["Loading campaigns…", "Cargando campañas…", "Chargement des campagnes…", "Kampagnen werden geladen…", "Caricamento campagne…", "Campagnes laden…", "キャンペーンを読み込み中…", "캠페인을 불러오는 중…", "正在加载广告…"],
    "Região": ["Region", "Región", "Région", "Region", "Regione", "Regio", "地域", "지역", "地区"],
    "droppad, voltar ao topo": ["droppad, back to top", "droppad, volver arriba", "droppad, retour en haut", "droppad, nach oben", "droppad, torna su", "droppad, terug naar boven", "droppad、トップへ", "droppad, 맨 위로", "droppad，回到顶部"],
    "Escolher uma data": ["Pick a date", "Elegir una fecha", "Choisir une date", "Datum wählen", "Scegli una data", "Kies een datum", "日付を選ぶ", "날짜 선택", "选择日期"],
    "Ver campanhas a partir de uma data": ["See campaigns from a date", "Ver campañas desde una fecha", "Voir les campagnes à partir d'une date", "Kampagnen ab einem Datum ansehen", "Vedi le campagne da una data", "Bekijk campagnes vanaf een datum", "日付からキャンペーンを見る", "날짜부터 캠페인 보기", "查看某日期起的广告"],
    "Voltar para hoje": ["Back to today", "Volver a hoy", "Revenir à aujourd'hui", "Zurück zu heute", "Torna a oggi", "Terug naar vandaag", "今日に戻る", "오늘로 돌아가기", "回到今天"],
    "Som dos filmes": ["Film sound", "Sonido de los videos", "Son des films", "Ton der Filme", "Audio dei video", "Geluid van de films", "動画の音声", "영상 소리", "视频声音"],
    "droppad · as campanhas que estrearam hoje no mundo": ["droppad · the campaigns that launched today around the world", "droppad · las campañas que se estrenaron hoy en el mundo", "droppad · les campagnes sorties aujourd'hui dans le monde", "droppad · die Kampagnen, die heute weltweit gestartet sind", "droppad · le campagne uscite oggi nel mondo", "droppad · de campagnes die vandaag wereldwijd lanceerden", "droppad · 今日世界で公開された広告", "droppad · 오늘 전 세계에 공개된 캠페인", "droppad · 今天全球上线的广告"],
    "Brasil": ["Brazil", "Brasil", "Brésil", "Brasilien", "Brasile", "Brazilië", "ブラジル", "브라질", "巴西"],
    "América Latina": ["Latin America", "América Latina", "Amérique latine", "Lateinamerika", "America Latina", "Latijns-Amerika", "ラテンアメリカ", "라틴아메리카", "拉丁美洲"],
    "EUA e Canadá": ["US & Canada", "EE. UU. y Canadá", "États-Unis et Canada", "USA und Kanada", "USA e Canada", "VS en Canada", "米国・カナダ", "미국·캐나다", "美国和加拿大"],
    "EUA": ["USA", "EE. UU.", "États-Unis", "USA", "USA", "VS", "米国", "미국", "美国"],
    "Reino Unido": ["UK", "Reino Unido", "Royaume-Uni", "Großbritannien", "Regno Unito", "VK", "英国", "영국", "英国"],
    "Europa": ["Europe", "Europa", "Europe", "Europa", "Europa", "Europa", "ヨーロッパ", "유럽", "欧洲"],
    "Ásia-Pacífico": ["Asia-Pacific", "Asia-Pacífico", "Asie-Pacifique", "Asien-Pazifik", "Asia-Pacifico", "Azië-Pacific", "アジア太平洋", "아시아태평양", "亚太"],
    "Oriente Médio e África": ["Middle East & Africa", "Oriente Medio y África", "Moyen-Orient et Afrique", "Nahost und Afrika", "Medio Oriente e Africa", "Midden-Oosten en Afrika", "中東・アフリカ", "중동·아프리카", "中东和非洲"],
    "Global": ["Global", "Global", "Monde", "Global", "Globale", "Wereldwijd", "グローバル", "글로벌", "全球"]
  };
  var LANG = "pt";
  // texto na língua de quem entra; {x} vira o valor passado
  function tr(s, v) {
    var d = TXT[s], i = LINGUAS.indexOf(LANG), out = s;
    if (LANG !== "pt" && d) out = d[i >= 0 ? i : 0] || d[0];
    if (v) for (var k in v) out = out.split("{" + k + "}").join(v[k]);
    return out;
  }
  function mesesDe(lang) {
    if (lang === "pt") return ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
    try {
      var f = new Intl.DateTimeFormat(LOCALE[lang] || "en", { month: "short", timeZone: "UTC" });
      var out = [];
      for (var m = 0; m < 12; m++) out.push(f.format(new Date(Date.UTC(2020, m, 15))).replace(/\./g, "").toUpperCase());
      return out;
    } catch (e) { return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]; }
  }
  // troca a língua da página (textos fixos do index.html, meses, nomes de países)
  function aplicarLingua(lang) {
    LANG = TXT.Hoje && (lang === "pt" || LINGUAS.indexOf(lang) >= 0) ? lang : "en";
    MESES = mesesDe(LANG);
    try { dn = new Intl.DisplayNames([LOCALE[LANG] || "en"], { type: "region" }); } catch (e) { dn = null; }
    document.documentElement.lang = LOCALE[LANG] || "en";
    document.title = tr("droppad · as campanhas que estrearam hoje no mundo");
    function attr(sel, nome, pt) { var e = document.querySelector(sel); if (e) e.setAttribute(nome, tr(pt)); }
    function txt(id, pt) { var e = $(id); if (e) e.textContent = tr(pt); }
    attr("#chips", "aria-label", "Região");
    attr("#reg-sel", "aria-label", "Região");
    attr("#top", "aria-label", "droppad, voltar ao topo");
    attr(".cal-btn", "title", "Escolher uma data");
    attr("#cal-in", "aria-label", "Ver campanhas a partir de uma data");
    attr("#cal-x", "aria-label", "Voltar para hoje");
    attr("#sound", "aria-label", "Som dos filmes");
    txt("reg-txt", "Mundo");
    if (!state.upTo) txt("cal-txt", "Hoje");
    var st = $("status");
    if (st && !st.hidden && st.textContent === "Carregando campanhas…") st.textContent = tr("Carregando campanhas…");
  }
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
  /* Foto de perfil do post: a da agência (perfil do Instagram ou logo do site dela) e, se não
     houver, a do veículo de onde a campanha veio. As iniciais só ficam se nenhuma imagem carregar. */
  var AG_SITE = {
    almapbbdo: "almapbbdo.com.br", vccp: "vccp.com", africacreative: "africacreative.com.br", ogilvy: "ogilvy.com",
    tbwa: "tbwa.com", bbh: "bbh.co.uk", bbhlondon: "bbh.co.uk", galeria: "galeria.ag", wmccann: "wmccann.com",
    mother: "motherlondon.com", adameve: "adamandeveddb.com", adameveddb: "adamandeveddb.com",
    betc: "betc.com", betchavas: "betc.com", leo: "leoburnett.com", leouk: "leoburnett.co.uk", leoburnett: "leoburnett.com",
    dpz: "dpz.com.br", crispin: "crispin.com", droga5: "droga5.com", mila: "mila.com.br", thinkerbell: "thinkerbell.com",
    publicis: "publicis.com", publicisconseil: "publicisconseil.fr", publicisbrasil: "publicis.com.br",
    howatsoncompany: "howatsoncompany.com", vml: "vml.com", vmlbrasil: "vml.com", clemengerbbdo: "clemengerbbdo.com.au",
    anomaly: "anomaly.com", lolatbwa: "lolatbwa.com", artplan: "artplan.com.br", youdare: "youdare.com.br",
    david: "davidtheagency.com", dentsucreative: "dentsucreative.com", dentsu: "dentsu.com", mccann: "mccann.com",
    bbdo: "bbdo.com", bbdonewyork: "bbdo.com", impactbbdo: "impactbbdo.com", wpp: "wpp.com",
    saatchisaatchi: "saatchi.com", idtbwa: "idtbwa.com", amvbbdo: "amvbbdo.com", highdive: "highdive.com",
    calia: "calia.com.br", grey: "grey.com", greylondon: "grey.com", we: "agenciawe.com.br", bbdobelgium: "bbdo.be",
    bearmeetseagleonfire: "bearmeetseagleonfire.com", boysgirls: "boysandgirls.ie", "72andsunny": "72andsunny.com",
    newcommercialarts: "newcommercialarts.com", tp: "tandp.com.au", luckygenerals: "luckygenerals.com", dept: "deptagency.com",
    thecommunity: "thecommunityagency.com", colensobbdo: "colensobbdo.co.nz", davidgoliath: "dng.com", propeg: "propeg.com.br",
    w3haus: "w3haus.com.br", akcelo: "akcelo.com", gut: "gut.agency", goodbysilversteinpartners: "goodbysilverstein.com",
    techandsoul: "techandsoul.com.br", orchard: "orchard.com.au", scholzfriends: "s-f.com", ampfy: "ampfy.com",
    archertroy: "archertroy.com", ps21: "ps21.com.br", talented: "talented.agency", lepub: "lepub.com",
    nova: "novasb.com.br", havas: "havas.com", havaslondon: "havaslondon.com", wieden: "wk.com", wiedenkennedy: "wk.com",
    wk: "wk.com", fcb: "fcb.com", fcbbrasil: "fcb.com", fcbnewyork: "fcb.com", dm9: "dm9.com.br", soko: "soko.com.br",
    jwt: "wundermanthompson.com", wundermanthompson: "wundermanthompson.com", ddb: "ddb.com", africa: "africacreative.com.br",
    serviceplan: "serviceplan.com", mckinney: "mckinney.com", fallon: "fallon.com", jungvonmatt: "jvm.com",
    rethink: "rethinkideas.com", johannesleonardo: "johannesleonardo.com", deutsch: "deutsch.com", alma: "almaad.com",
    cheil: "cheil.com", innocean: "innocean.com", gutsaopaulo: "gut.agency", ogilvybrasil: "ogilvy.com.br"
  };
  function chave(t) {
    return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "").replace(/[^0-9a-z]/g, "");
  }
  function siteDaAgencia(ag) {
    var k = chave(ag);
    if (!k) return "";
    if (AG_SITE[k]) return AG_SITE[k];
    var best = "";
    Object.keys(AG_SITE).forEach(function (n) { if (n.length >= 3 && k.indexOf(n) === 0 && n.length > best.length) best = n; });
    return best ? AG_SITE[best] : "";
  }
  var igDe = null; // agência -> @ do Instagram, aprendido das próprias campanhas que vêm do Instagram
  function handleDaAgencia(ag) {
    if (!igDe) {
      igDe = {};
      state.items.forEach(function (x) {
        var m = (x.source || "").match(/^Instagram\s*·\s*@([\w.]+)/i);
        if (m && x.agency) igDe[chave(x.agency)] = m[1];
      });
    }
    return igDe[chave(ag)] || "";
  }
  function hostDe(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function logoSite(host) {
    return "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://" + host;
  }
  function fotosDoPerfil(c, ag) {
    var out = [], m = (c.source || "").match(/^Instagram\s*·\s*@([\w.]+)/i);
    var ig = m ? m[1] : (ag ? handleDaAgencia(ag) : "");
    if (ig) out.push("https://unavatar.io/instagram/" + ig + "?fallback=false");
    var site = ag ? siteDaAgencia(ag) : "";
    if (site) out.push(logoSite(site));
    var h = hostDe(c.url);
    if (h && !/(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|vimeo\.com)$/.test(h)) out.push(logoSite(h));
    return out;
  }
  function avatar(nome, fotos) {
    var box = el("span", "av ini");
    box.setAttribute("aria-hidden", "true");
    box.textContent = iniciais(nome);
    var i = 0;
    (function tenta() {
      if (i >= (fotos || []).length) return;
      var im = new Image();
      im.alt = ""; im.referrerPolicy = "no-referrer"; im.decoding = "async";
      im.onload = function () {
        if (im.naturalWidth < 24) { i++; tenta(); return; } // ícone minúsculo fica borrado: tenta o próximo
        box.textContent = ""; box.classList.remove("ini"); box.appendChild(im);
      };
      im.onerror = function () { i++; tenta(); };
      im.src = fotos[i];
    })();
    return box;
  }
  function fraseDe(c) {
    var f = str(c.frase) || c.summary || c.title;
    return f;
  }
  function fmtT(t) { t = Math.max(0, Math.floor(t || 0)); var m = Math.floor(t / 60), s = t % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function setTime(art, t, d) { var tg = art.querySelector(".ptime"); if (tg && d) tg.textContent = t > 0.5 ? fmtT(t) + " / " + fmtT(d) : fmtT(d); }
  var MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  function selo(d) { return d === TODAY ? tr("Estreou hoje") : d === shift(TODAY, -1) ? tr("Estreou ontem") : tr("Estreou {d}", { d: (+d.slice(8, 10)) + " " + MESES[+d.slice(5, 7) - 1] }); }
  // "há 2 h" a partir da hora em que entrou no site
  function haQuanto(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 0) return "";
    if (m < 60) return tr("há {n} min", { n: Math.max(1, m) });
    if (m < 24 * 60) return tr("há {n} h", { n: Math.round(m / 60) });
    return "";
  }
  var ICON_DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="3" height="3"/><rect x="10.5" y="11" width="3" height="3"/><rect x="17" y="11" width="3" height="3"/></svg>';

  /* Instagram: o post inteiro (cabeçalho, filme e rodapé) entra reduzido no quadro 16:9, sem cortar.
     O embed avisa a própria altura por postMessage (MEASURE); até lá, vale uma altura típica. */
  var CELULAR = window.matchMedia("(max-width: 760px)");
  var IG_W = 400, IG_CROP_H = 494, igRO = "ResizeObserver" in window ? new ResizeObserver(function (es) { es.forEach(function (e) { scaleIG(e.target); }); }) : null;
  // onde fica a mídia dentro do embed (o robô mede: "igm" = [topo, altura]); sem medida, o padrão 4:5
  function recorteIG(box, c) {
    var topo = c.igm ? c.igm[0] + 2 : 58, alt = c.igm ? c.igm[1] - 4 : IG_CROP_H;
    box.dataset.ch = alt;
    box.style.setProperty("--igt", -topo + "px");
  }
  function scaleIG(media) {
    var box = media.querySelector(".igbox");
    if (!box) return;
    // só o vídeo/foto do post: o embed do Instagram (400 px de largura) mostra a mídia em 4:5, 400×500,
    // logo abaixo de um cabeçalho de 54 px; o quadro recorta esse pedaço (o CSS sobe o iframe)
    var h = +box.dataset.ch || IG_CROP_H, w = media.clientWidth, bh = media.clientHeight;
    if (!w || !bh) return;
    box.style.setProperty("--igh", h + "px");
    // o quadro fica da altura do post do Instagram (sem faixas em cima/embaixo e sem cortar o rodapé);
    // no celular ocupa a largura toda, no computador cabe em 80% da altura da tela
    // o vídeo recortado ocupa a largura do quadro (no computador, sem passar de 80% da altura da tela)
    // altura máxima: o que sobra da tela depois do cabeçalho, texto e botões do post (pra "Comentar" ficar sempre visível)
    var cabe = Math.max(CELULAR.matches ? 320 : 360, window.innerHeight - (CELULAR.matches ? 300 : 330));
    var s = Math.min(w / IG_W, cabe / h);
    var alt = Math.round(h * s) + "px";
    if (media.style.height !== alt) media.style.height = alt;
    box.style.transform = "translate(-50%,-50%) scale(" + s.toFixed(4) + ")";
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
    // começa mostrando pouco (umas 3 linhas); "Ver mais" abre o resto
    var ver = el("button", "ver-mais", tr("Ver mais"));
    ver.type = "button";
    ver.hidden = true;
    ver.addEventListener("click", function (e) {
      e.stopPropagation();
      var abrir = body.classList.contains("fechado");
      if (abrir) {
        body.style.maxHeight = body.offsetHeight + "px"; body.classList.remove("fechado");
        void body.offsetHeight; body.style.maxHeight = body.scrollHeight + "px";
      }
      else { body.style.maxHeight = ""; body.classList.add("fechado"); }
      ver.textContent = abrir ? tr("Ver menos") : tr("Ver mais");
      ver.setAttribute("aria-expanded", abrir ? "true" : "false");
    });
    box.appendChild(ver);
    function fill(story) {
      var shown = fraseDe(c).slice(0, 60), total = 0;
      body.textContent = "";
      (story || []).some(function (t) {
        t = str(t);
        if (!t || t.slice(0, 60) === shown || LIXO.test(t)) return false;
        body.appendChild(el("p", null, t));
        total += t.length;
        return body.children.length >= 6 || total > 1600;
      });
      var longo = total > 70 || body.children.length > 1; // fechado mostra só 1 linha
      body.classList.toggle("fechado", longo);
      ver.hidden = !longo;
    }
    fill(c.story);
    if (c.st && !body.children.length) {
      buscarHistoria(c)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { fill(j.story); })
        .catch(function () { /* fica só com o título e o link */ });
    }
    if (c.url) box.appendChild(link("news-more", tr("Ler a matéria completa em {s} ↗", { s: c.source || tr("fonte") }), c.url));
    return box;
  }

  /* texto do post; se vier cortado ("…"), os três pontinhos abrem o resto da notícia ali mesmo */
  var CORTE = /\s*(\.\.\.|…|\[…\]|\[\.\.\.\])\s*$/;
  function historia(c) {
    if (c.story && c.story.length) return Promise.resolve(c.story);
    if (!c.st) return Promise.resolve([]);
    if (!c._hist) c._hist = buscarHistoria(c)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { return Array.isArray(j.story) ? j.story.map(str).filter(Boolean) : []; })
      .catch(function () { c._hist = null; return []; });
    return c._hist;
  }
  function textoDoPost(c) {
    var p = el("p", "txt"), t = fraseDe(c);
    p.title = c.title;
    if (!CORTE.test(t)) { p.textContent = t; return p; }
    var inicio = t.replace(CORTE, "");
    p.appendChild(document.createTextNode(inicio));
    var more = el("button", "txt-more", "…");
    more.type = "button";
    more.setAttribute("aria-label", tr("Ler o resto do texto"));
    more.title = tr("Ler mais");
    more.addEventListener("click", function (e) {
      e.stopPropagation();
      more.disabled = true;
      historia(c).then(function (story) {
        var chave = inicio.slice(0, 40).toLowerCase(), i = -1;
        story.some(function (s, k) { if (s.toLowerCase().indexOf(chave) === 0) { i = k; return true; } return false; });
        var mostrar = i >= 0 ? story.slice(i, i + 4) : story.slice(0, 3);
        mostrar = mostrar.filter(function (s) { return !LIXO.test(s); });
        if (!mostrar.length) { // sem o texto aqui: abre a matéria
          more.disabled = false;
          if (c.url) window.open(c.url, "_blank", "noopener");
          return;
        }
        // nos cards a notícia já vem embaixo: aqui só completa o primeiro parágrafo
        if (!c.fl.length) mostrar = mostrar.slice(0, 1);
        p.textContent = "";
        p.classList.add("open");
        mostrar.forEach(function (s, k) { if (k) p.appendChild(el("br")), p.appendChild(el("br")); p.appendChild(document.createTextNode(s)); });
        if (c.url) { p.appendChild(document.createTextNode(" ")); p.appendChild(link("news-more", tr("Ler a matéria completa ↗"), c.url)); }
      });
    });
    p.appendChild(more);
    return p;
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
    head.appendChild(avatar(ag || marca, fotosDoPerfil(c, ag)));
    var who = el("div", "who");
    var b = el("b", null, ag || marca);
    if (ag && marca && marca.toLowerCase() !== ag.toLowerCase()) {
      b.appendChild(el("i", null, tr(" para ")));
      b.appendChild(document.createTextNode(marca));
    }
    who.appendChild(b);
    var sm = el("small");
    var bits = [tr("via {s}", { s: c.source || "—" })];
    if (c.region) bits.push(tr(c.region));
    var ha = haQuanto(c.addedAt);
    if (ha) bits.push(ha);
    if (c.url) sm.appendChild(link("", bits.join(" · "), c.url)); else sm.textContent = bits.join(" · ");
    who.appendChild(sm);
    head.appendChild(who);
    // no canto, a data da campanha (o ano só aparece se não for o atual)
    head.appendChild(el("span", "num", (+c.date.slice(8, 10)) + " " + MESES[+c.date.slice(5, 7) - 1] +
      (c.date.slice(0, 4) !== TODAY.slice(0, 4) ? " " + c.date.slice(0, 4) : "")));
    var mb = el("button", "more-btn");
    mb.type = "button";
    mb.setAttribute("aria-label", tr("Mais opções"));
    mb.innerHTML = ICON_DOTS;
    mb.addEventListener("click", function (e) { e.stopPropagation(); share(c, mb); });
    head.appendChild(mb);
    head.classList.add("rv"); head.style.setProperty("--i", 0);
    art.appendChild(head);

    // a frase
    var txt = textoDoPost(c);
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
        if (f0.reel) box0.dataset.reel = "1";
        if (f0.kind === "ig") recorteIG(box0, c);
        var fr0 = el("iframe");
        fr0.src = f0.src;
        fr0.loading = "lazy";
        fr0.allow = "autoplay; encrypted-media; picture-in-picture; clipboard-write";
        fr0.setAttribute("allowfullscreen", "");
        fr0.setAttribute("scrolling", "no");
        fr0.title = tr("{b} no {p}", { b: c.brand, p: f0.kind === "ig" ? "Instagram" : "TikTok" });
        box0.appendChild(fr0);
        host0.appendChild(box0);
        art.classList.add("embed-on");
        if (f0.kind === "ig") fitIG(media);
      }
      media.appendChild(cover);
      media.appendChild(host0);
      media.appendChild(el("span", "bigplay"));
      media.appendChild(el("span", "ptime"));
      media.appendChild(el("span", "fail", tr("Este filme só toca no YouTube ↗")));
      media.appendChild(endCard(art, c));
      var mute = el("button", "mute");
      mute.type = "button";
      mute.setAttribute("aria-label", tr("Ligar ou desligar o som"));
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
          d.setAttribute("aria-label", tr("Filme {i} de {n}", { i: i + 1, n: c.fl.length }));
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
        if (c.url) {
          media.classList.add("abre");
          media.setAttribute("role", "link");
          media.setAttribute("aria-label", tr("Ler a matéria em {s}", { s: c.source || tr("fonte") }));
          media.addEventListener("click", function (e) { e.stopPropagation(); window.open(c.url, "_blank", "noopener"); });
        }
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
    cm.setAttribute("aria-label", tr("Comentários sobre esta campanha"));
    cm.innerHTML = ICON_CMT; cm.appendChild(el("span", null, tr("Comentar")));
    cm.appendChild(el("span", "n"));
    cm.addEventListener("click", function (e) { e.stopPropagation(); openComments(c); });
    acts.appendChild(cm);
    var sh = el("button", "act share");
    sh.type = "button";
    sh.setAttribute("aria-label", tr("Compartilhar esta campanha"));
    sh.innerHTML = ICON_SHARE; sh.appendChild(el("span", null, tr("Compartilhar")));
    sh.addEventListener("click", function (e) { e.stopPropagation(); share(c, sh); });
    acts.appendChild(sh);
    if (c.url) acts.appendChild(link("link", tr("Ver matéria ↗"), c.url));
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
  // link para compartilhar: a página própria da campanha (aparece no Google e gera a prévia com imagem no
  // WhatsApp/LinkedIn), na língua de quem compartilha quando ela já foi traduzida
  function linkOf(c) {
    var pre = c.tl && LANG !== "pt" ? (LANG === "es" ? "/es" : "/en") : "";
    return "https://dropp.ad" + pre + "/c/" + encodeURIComponent(c.id) + "/";
  }
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
  window.addEventListener("scroll", function () { if (menu && !menu._form) closeMenu(); }, { passive: true });
  function share(c, btn) {
    if (menu && menu._for === btn) { closeMenu(); return; }
    closeMenu();
    var url = linkOf(c);
    var title = (c.brand ? c.brand + ": " : "") + c.title;
    var txt = title + " · droppad";
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
    item(tr("Copiar link"), function () {
      copy(url).then(function (ok) {
        if (ok) { toast(tr("Link copiado")); closeMenu(); } else { field.focus(); field.select(); toast(tr("Selecione e copie o link")); }
      });
    });
    item("WhatsApp", function () { open("https://wa.me/?text=" + encodeURIComponent(txt + " " + url)); });
    item("X / Twitter", function () { open("https://x.com/intent/post?text=" + encodeURIComponent(txt) + "&url=" + encodeURIComponent(url)); });
    item("LinkedIn", function () { open("https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(url)); });
    item("E-mail", function () { location.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(txt + "\n\n" + url); closeMenu(); });
    if (navigator.share) item(tr("Mais opções…"), function () { navigator.share({ title: title, text: txt, url: url }).catch(function () {}); closeMenu(); });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(), w = menu.offsetWidth;
    var hgt = menu.offsetHeight;
    menu.style.top = (r.bottom + 8 + hgt > window.innerHeight - 8 && r.top - 8 - hgt > 8 ? r.top - 8 - hgt : r.bottom + 8) + "px";
    menu.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + "px";
  }

  /* ---------- Contato: menu ao lado do calendário, na língua do país de quem entra ---------- */
  var CONTATO_EMAIL = "contato@dropp.ad";
  // [botão, pauta, comercial, sugestões, seu e-mail, mensagem, enviar, enviado, erro, e-mail inválido]
  var CONTATO_TXT = {
    pt: ["Contato", "Sugerir pauta", "Comercial", "Sugestões", "Seu e-mail", "Escreva sua mensagem…", "Enviar", "Mensagem enviada. Obrigado!", "Não deu para enviar. Tente de novo.", "Confira o seu e-mail."],
    en: ["Contact", "Suggest a story", "Business", "Feedback", "Your email", "Write your message…", "Send", "Message sent. Thank you!", "Couldn't send it. Please try again.", "Please check your email."],
    es: ["Contacto", "Sugerir una noticia", "Comercial", "Sugerencias", "Tu correo", "Escribe tu mensaje…", "Enviar", "Mensaje enviado. ¡Gracias!", "No se pudo enviar. Inténtalo de nuevo.", "Revisa tu correo."],
    fr: ["Contact", "Proposer un sujet", "Commercial", "Suggestions", "Votre e-mail", "Écrivez votre message…", "Envoyer", "Message envoyé. Merci !", "Échec de l'envoi. Réessayez.", "Vérifiez votre e-mail."],
    de: ["Kontakt", "Thema vorschlagen", "Geschäftliches", "Vorschläge", "Ihre E-Mail", "Ihre Nachricht…", "Senden", "Nachricht gesendet. Danke!", "Senden fehlgeschlagen. Bitte erneut versuchen.", "Bitte E-Mail prüfen."],
    it: ["Contatti", "Suggerisci una notizia", "Commerciale", "Suggerimenti", "La tua e-mail", "Scrivi il tuo messaggio…", "Invia", "Messaggio inviato. Grazie!", "Invio non riuscito. Riprova.", "Controlla la tua e-mail."],
    nl: ["Contact", "Onderwerp voorstellen", "Zakelijk", "Suggesties", "Je e-mail", "Schrijf je bericht…", "Versturen", "Bericht verstuurd. Bedankt!", "Versturen mislukt. Probeer opnieuw.", "Controleer je e-mail."],
    ja: ["お問い合わせ", "ネタを提案する", "広告・提携", "ご意見", "メールアドレス", "メッセージを入力…", "送信", "送信しました。ありがとうございます！", "送信できませんでした。もう一度お試しください。", "メールアドレスをご確認ください。"],
    ko: ["문의", "기사 제보", "비즈니스 문의", "제안", "이메일", "메시지를 입력하세요…", "보내기", "전송되었습니다. 감사합니다!", "전송하지 못했습니다. 다시 시도해 주세요.", "이메일을 확인해 주세요."],
    zh: ["联系", "提供选题", "商务合作", "建议", "你的邮箱", "写下你的留言…", "发送", "已发送，谢谢！", "发送失败，请重试。", "请检查邮箱地址。"]
  };
  var LINGUA_DO_PAIS = {
    pt: "BR PT AO MZ CV GW ST TL", es: "ES MX AR CO CL PE VE EC GT CU BO DO HN PY SV NI CR PA UY PR GQ",
    fr: "FR BE LU MC SN CI CM ML BF NE TG BJ GA CG CD MG HT", de: "DE AT CH LI", it: "IT SM VA", nl: "NL SR",
    ja: "JP", ko: "KR", zh: "CN TW HK MO"
  };
  var paisVisita = "";
  function linguaContato() {
    var cc = paisVisita;
    if (!cc) try { cc = localStorage.getItem("ddrop-cc") || ""; } catch (e) { /* sem storage */ }
    for (var l in LINGUA_DO_PAIS) if (cc && LINGUA_DO_PAIS[l].split(" ").indexOf(cc) >= 0) return l;
    var nav = (navigator.language || "").slice(0, 2).toLowerCase();
    return cc ? "en" : (CONTATO_TXT[nav] ? nav : "en");
  }
  function pintarContato() {
    if (!$("contato")) return; // página antiga em cache, sem o botão
    var t = CONTATO_TXT[linguaContato()];
    $("contato-txt").textContent = t[0];
    $("contato").setAttribute("aria-label", t[0]);
    $("contato").title = t[0];
  }
  function abrirContato(btn) {
    if (menu && menu._for === btn) { closeMenu(); return; }
    closeMenu();
    var t = CONTATO_TXT[linguaContato()];
    var lang = linguaContato();
    menu = el("div", "sharemenu contatomenu");
    menu._for = btn;
    menu._form = true; // rolar a página (ex.: teclado do celular subindo) não fecha a caixa
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", t[0]);
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    // abas: pauta, comercial, sugestões
    var tipos = ["pauta", "comercial", "sugestao"], tipo = "pauta";
    var abas = el("div", "ct-abas");
    tipos.forEach(function (k, i) {
      var b = el("button", "ct-aba", t[i + 1]); b.type = "button";
      b.setAttribute("aria-pressed", k === tipo ? "true" : "false");
      b.addEventListener("click", function () {
        tipo = k;
        abas.querySelectorAll(".ct-aba").forEach(function (x, j) { x.setAttribute("aria-pressed", tipos[j] === k ? "true" : "false"); });
        msg.focus();
      });
      abas.appendChild(b);
    });
    menu.appendChild(abas);
    var form = el("form", "ct-form");
    form.noValidate = true;
    var mail = el("input", "ct-in");
    mail.type = "email"; mail.placeholder = t[4]; mail.setAttribute("aria-label", t[4]);
    mail.autocomplete = "email"; mail.maxLength = 200; mail.required = true;
    var msg = el("textarea", "ct-in ct-msg");
    msg.placeholder = t[5]; msg.setAttribute("aria-label", t[5]); msg.maxLength = 2000; msg.rows = 5; msg.required = true;
    var mel = el("input", "ct-mel"); // armadilha para robôs: gente não vê nem preenche
    mel.tabIndex = -1; mel.autocomplete = "off"; mel.setAttribute("aria-hidden", "true");
    var env = el("button", "ct-send", t[6]); env.type = "submit";
    var aviso = el("p", "ct-aviso"); aviso.setAttribute("role", "status");
    form.appendChild(mail); form.appendChild(msg); form.appendChild(mel); form.appendChild(env); form.appendChild(aviso);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var em = mail.value.trim(), tx = msg.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { aviso.textContent = t[9]; mail.focus(); return; }
      if (!tx) { msg.focus(); return; }
      if (mel.value) { closeMenu(); toast(t[7]); return; }
      env.disabled = true; aviso.textContent = "";
      fetch(SUPABASE_URL + "/rest/v1/contacts", {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ kind: tipo, email: em, message: tx, lang: lang, country: (paisVisita || "").slice(0, 2) || null })
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        closeMenu(); toast(t[7]);
      }).catch(function () { env.disabled = false; aviso.textContent = t[8]; });
    });
    menu.appendChild(form);
    document.body.appendChild(menu);
    if (!CELULAR.matches) {
      var r = btn.getBoundingClientRect(), w = menu.offsetWidth;
      menu.style.top = (r.bottom + 8) + "px";
      menu.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + "px";
    }
    setTimeout(function () { mail.focus(); }, 50);
  }
  if ($("contato")) $("contato").addEventListener("click", function (e) { e.stopPropagation(); abrirContato($("contato")); });
  pintarContato();

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
    // país, cidade e rede (empresa ou provedor) de quem entra; o IP em si não é guardado
    geoVisita().then(function (g) {
      corpo.country = g.cc || null; corpo.country_name = g.pais || null;
      corpo.city = g.cidade || null; corpo.region = g.estado || null; corpo.org = g.org || null;
      return fetch(SUPABASE_URL + "/rest/v1/visits", {
        method: "POST", keepalive: true,
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(corpo)
      });
    }).catch(function () { /* contador nunca atrapalha o site */ });
  }
  function geoVisita() {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 3000);
    return fetch("https://get.geojs.io/v1/ip/geo.json", ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(to);
        var cc = String(j && j.country_code || "").toUpperCase();
        return {
          cc: /^[A-Z]{2}$/.test(cc) ? cc : "", pais: str(j.country).slice(0, 80),
          cidade: str(j.city).slice(0, 120), estado: str(j.region).slice(0, 120),
          org: str(j.organization_name || j.organization).replace(/^AS\d+\s*/i, "").slice(0, 200)
        };
      })
      .catch(function () { clearTimeout(to); return {}; });
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
    return m.full_name || m.name || tr("Você");
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
    hd.appendChild(el("b", null, k.author_name || tr("Leitor")));
    hd.appendChild(el("span", null, ago(k.created_at)));
    if (me && k.user_id === me.id) {
      var del = el("button", "cmt-del", "apagar"); del.type = "button";
      del.addEventListener("click", function () {
        del.disabled = true;
        sb.from("comments").delete().eq("id", k.id).then(function (r) {
          if (r.error) { del.disabled = false; toast(tr("Não deu para apagar agora.")); } else li.remove();
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
        if (r.error) { list.appendChild(el("li", "drawer-note", tr("Não foi possível carregar os comentários agora."))); return; }
        if (!r.data.length) list.appendChild(el("li", "drawer-note cmt-empty", tr("Ninguém comentou ainda. Comece a conversa.")));
        r.data.forEach(function (k) { list.appendChild(cmtItem(k)); });
      });
  }
  function refreshForm() {
    if (!drawer || !cur) return;
    var f = drawer.querySelector(".cmt-form");
    if (!f) return;
    f.textContent = "";
    if (!me) {
      f.appendChild(el("p", "cmt-ask", tr("Entre para comentar:")));
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
    ta.maxLength = 1000; ta.rows = 3; ta.placeholder = tr("Escreva seu comentário…");
    ta.setAttribute("aria-label", tr("Seu comentário"));
    var bar = el("div", "cmt-bar");
    var who = el("span", "cmt-me", tr("Comentando como {s} · ", { s: nameOf(me) }));
    var out = el("button", "cmt-out", "sair"); out.type = "button";
    out.addEventListener("click", function () { sb.auth.signOut(); });
    who.appendChild(out);
    var send = el("button", "cmt-send", tr("Comentar")); send.type = "button";
    function post() {
      var txt = ta.value.trim();
      if (!txt || send.disabled) return;
      send.disabled = true;
      var c = cur;
      sb.from("comments").insert({ campaign_id: c.id, body: txt }).select("id,user_id,author_name,author_avatar,body,created_at").single()
        .then(function (r) {
          send.disabled = false;
          if (r.error) { toast(/rapido|devagar/i.test(r.error.message) ? tr("Calma: espere um pouco antes de comentar de novo.") : tr("Não deu para enviar. Tente de novo.")); return; }
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
    // no celular o teclado sobe: some o que fica fixo na tela e a página mantém caixa + botão à vista
    var raiz = document.documentElement;
    function aVista() {
      if (document.activeElement !== ta) return;
      var vv = window.visualViewport, base = vv ? vv.offsetTop + vv.height : window.innerHeight;
      var r = bar.getBoundingClientRect(), topo = ta.getBoundingClientRect().top;
      if (r.bottom > base - 8) window.scrollBy(0, Math.min(r.bottom - base + 12, topo - 8));
    }
    ta.addEventListener("focus", function () {
      raiz.classList.add("digitando");
      setTimeout(aVista, 350); setTimeout(aVista, 700);
    });
    ta.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== ta) raiz.classList.remove("digitando"); }, 150); });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", aVista);
    bar.appendChild(who); bar.appendChild(send);
    f.appendChild(ta); f.appendChild(bar);
  }

  /* comentários abrem dentro do próprio post, logo abaixo dos botões */
  var drawer = null; // painel de comentários aberto (no post da campanha "cur")
  function closeComments(semAnimar) {
    if (!drawer) return;
    var p = drawer, btn = p.parentNode && p.parentNode.querySelector(".act.cmt");
    drawer = null; cur = null;
    window.removeEventListener("scroll", vigiaGaveta);
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (semAnimar) {
      // fecha na hora; se a gaveta estava acima da tela, compensa a rolagem pra nada pular
      var r = p.getBoundingClientRect(), acima = Math.max(0, Math.min(r.bottom, 0) - r.top);
      p.remove();
      if (acima) window.scrollBy({ top: -acima, behavior: "instant" });
    } else {
      p.style.height = p.scrollHeight + "px";
      requestAnimationFrame(function () { p.classList.remove("on"); p.style.height = "0px"; });
      setTimeout(function () { p.remove(); }, 450);
    }
    snap(true);
  }
  // se a pessoa rola pra outro post com os comentários abertos, fecha a gaveta e a rolagem volta a parar em cada post
  function vigiaGaveta() {
    if (!drawer || !drawer.parentNode) return;
    var r = drawer.parentNode.getBoundingClientRect(), vh = window.innerHeight;
    if (r.bottom < vh * 0.3 || r.top > vh * 0.7) closeComments(true);
  }
  // a rolagem "para em cada post" (scroll-snap); desliga enquanto os comentários estão abertos
  function snap(on) {
    var h = document.documentElement;
    h.classList.toggle("nosnap", !on);
    h.classList.toggle("cmt-open", !on);
    if (on) h.classList.remove("digitando");
  }
  function mostrarGaveta(p) {
    if (!p || drawer !== p) return;
    var r = p.getBoundingClientRect(), vh = window.innerHeight;
    var desce = Math.min(r.bottom - vh + 16, r.top - 90); // mostra a gaveta inteira, sem esconder o topo dela
    if (desce > 0) window.scrollBy({ top: desce, behavior: REDUCE ? "auto" : "smooth" });
  }
  function openComments(c) {
    closeMenu();
    var art = document.querySelector('.post[data-id="' + (window.CSS && CSS.escape ? CSS.escape(c.id) : c.id) + '"]');
    if (!art) return;
    if (drawer && drawer.parentNode === art) { closeComments(); return; } // segundo clique fecha
    closeComments();
    snap(false);
    drawer = el("section", "cmts");
    drawer.setAttribute("aria-label", tr("Comentários"));
    var body = el("div", "drawer-body"), form = el("div", "cmt-form");
    drawer.appendChild(body);
    drawer.appendChild(form);
    art.appendChild(drawer);
    var btn = art.querySelector(".act.cmt");
    if (btn) btn.setAttribute("aria-expanded", "true");
    cur = c;
    window.addEventListener("scroll", vigiaGaveta, { passive: true });
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      body.appendChild(el("p", "drawer-note", tr("Comentários chegando em breve.")));
    } else {
      var list = el("ul", "cmt-list");
      list.appendChild(el("li", "drawer-note", tr("Carregando comentários…")));
      body.appendChild(list);
      loadSb().then(function () { if (cur !== c) return; loadList(c, body); refreshForm(); },
        function () { body.textContent = ""; body.appendChild(el("p", "drawer-note", tr("Não foi possível carregar os comentários agora."))); });
    }
    // abre deslizando pra baixo; depois fica com a altura natural (cresce com a lista)
    var p = drawer;
    p.style.height = "0px";
    requestAnimationFrame(function () {
      p.classList.add("on");
      p.style.height = p.scrollHeight + "px";
      setTimeout(function () { if (p.classList.contains("on")) p.style.height = "auto"; mostrarGaveta(p); }, 460);
      setTimeout(function () { mostrarGaveta(p); }, 1300); // de novo quando a lista carrega
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
    inner.appendChild(el("span", "end-k", tr("A ideia")));
    inner.appendChild(el("h3", "end-brand", c.brand || c.title));
    if (c.brand) inner.appendChild(el("p", "end-title", c.title));
    var idea = c.idea || c.summary;
    if (idea) inner.appendChild(el("p", "end-idea", idea));
    var rows = [];
    if (c.agency) rows.push([tr("Agência"), c.agency]);
    c.credits.forEach(function (k) { if (!((k[0] === "Agência" || k[0] === tr("Agência")) && k[1] === c.agency)) rows.push(k); });
    rows.push([tr("Origem"), flagOf(c.cc) + " " + tr(c.region || "Global")]);
    var dl = el("dl", "end-cred");
    rows.forEach(function (k) { dl.appendChild(el("dt", null, k[0])); dl.appendChild(el("dd", null, k[1])); });
    inner.appendChild(dl);
    var acts = el("div", "end-acts");
    var again = el("button", "end-btn", tr("↺ Ver de novo")); again.type = "button";
    again.addEventListener("click", function (e) { e.stopPropagation(); art.classList.remove("ended"); art.dataset.part = 0; activate(art, true); });
    acts.appendChild(again);
    var next = el("button", "end-btn", tr("Próxima ↓")); next.type = "button";
    next.addEventListener("click", function (e) { e.stopPropagation(); var n = art.nextElementSibling; if (n && n.classList.contains("post")) n.scrollIntoView({ behavior: "smooth", block: "center" }); });
    acts.appendChild(next);
    var shr = el("button", "end-btn share-end"); shr.type = "button";
    shr.setAttribute("aria-label", tr("Compartilhar esta campanha"));
    shr.innerHTML = ICON_SHARE + "<span>Compartilhar</span>";
    shr.addEventListener("click", function (e) { e.stopPropagation(); share(c, shr); });
    acts.appendChild(shr);
    if (c.url) acts.appendChild(link("end-btn ghost", tr("Ler em {s} ↗", { s: c.source || tr("fonte") }), c.url));
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
      var back = el("button", "newer", tr("↑ Ver as campanhas mais recentes"));
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
  // tela cheia e giro do celular: o vídeo fica em tela cheia por cima da página, mas a página por trás
  // muda de tamanho e o observador acha que o filme saiu da tela, e aí ele parava. Enquanto estiver em
  // tela cheia, e por um instante depois de girar ou sair dela, ninguém troca nem para o filme.
  var travadoAte = 0;
  function emTelaCheia() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function segurarFilme() {
    travadoAte = Date.now() + 1800;
    if (emTelaCheia()) return;
    var a = active && active.art;
    if (!a) return;
    [250, 700, 1300].forEach(function (ms) {
      setTimeout(function () {
        if (active && active.art === a && !emTelaCheia()) a.scrollIntoView({ block: "center", behavior: "auto" });
      }, ms);
    });
  }
  var larguraAntes = window.innerWidth;
  window.addEventListener("orientationchange", segurarFilme);
  window.addEventListener("resize", function () {
    if (window.innerWidth !== larguraAntes) { larguraAntes = window.innerWidth; segurarFilme(); }
  });
  document.addEventListener("fullscreenchange", segurarFilme);
  document.addEventListener("webkitfullscreenchange", segurarFilme);
  function pick() {
    if (emTelaCheia() || Date.now() < travadoAte) {
      clearTimeout(pickTimer);
      pickTimer = setTimeout(pick, 400); // decide de novo quando a tela assentar
      return;
    }
    var best = null, br = 0;
    ratios.forEach(function (r, m) { if (r > br) { br = r; best = m._art; } });
    if (best && br >= 0.6) {
      if (active && active.art === best) return;
      // filme não toca sozinho: só começa quando a pessoa clica; rolar para outro post para o que tocava
      if (best._c.fl.length) { if (active) deactivate(); paintChrome(best); }
      else activate(best, false);
    }
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
      fr.title = tr("{b} no {p}", { b: c.brand, p: f.kind === "ig" ? "Instagram" : "TikTok" });
      if (f.kind === "ig") { slot.className = "igbox"; if (f.reel) slot.dataset.reel = "1"; recorteIG(slot, c); fitIG(art._media); }
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
    } else if (antigo.anos.length) {
      var w = el("div", "more");
      w.id = "more";
      feed.appendChild(w);
      carregarProximoAno().then(function () { filtrarLista(); renderCal(); renderMore(); });
    } else {
      feed.appendChild(el("p", "end", state.list.length ? tr("Você chegou ao início do arquivo.") :
        state.region === "home" ? tr("Ainda não há campanhas de {s} no arquivo. Veja o Mundo.", { s: state.home.label }) : tr("Nenhuma campanha com esse filtro.")));
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
  /* ---------- Arquivo antigo: anos anteriores ao feed.json, baixados sob demanda ---------- */
  var antigo = { anos: [], min: "" }; // anos que ainda não foram baixados, do mais novo ao mais velho
  var baixandoAno = null;
  function carregarIndice() {
    return fetch("antigo/indice.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && Array.isArray(j.anos)) {
          antigo.anos = j.anos.map(str).filter(function (a) { return /^\d{4}$/.test(a); }).sort().reverse();
          antigo.min = isDay(str(j.min)) ? str(j.min) : "";
        }
      })
      .catch(function () { /* sem arquivo antigo */ });
  }
  function carregarProximoAno() {
    if (baixandoAno) return baixandoAno;
    if (!antigo.anos.length) return Promise.resolve(false);
    var ano = antigo.anos.shift();
    baixandoAno = fetch("antigo/" + ano + sufixoCarregado + ".json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return fetch("antigo/" + ano + ".json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); })
      .then(function (raw) {
        var ids = {};
        state.items.forEach(function (c) { ids[c.id] = 1; });
        state.items = state.items.concat(normalize(raw).filter(function (c) { return !ids[c.id]; }));
        return true;
      })
      .catch(function () { return false; })
      .then(function (v) { baixandoAno = null; return v; });
    return baixandoAno;
  }
  function diaMaisAntigo() {
    var m = "";
    state.items.forEach(function (c) { if (!m || c.date < m) m = c.date; });
    return m;
  }
  // baixa os anos necessários para a timeline poder começar no dia escolhido
  function carregarAte(dia) {
    if (!dia || !antigo.anos.length) return Promise.resolve();
    var m = diaMaisAntigo();
    if (m && dia >= m) return Promise.resolve();
    return carregarProximoAno().then(function (ok) { if (ok || antigo.anos.length) return carregarAte(dia); });
  }
  function filtrarLista() {
    state.list = state.items.filter(function (c) {
      if (state.upTo && c.date > state.upTo) return false;
      // Mundo = tudo; a outra aba é o país de quem entra
      return state.region !== "home" || homeMatch(c);
    });
    state.perDay = {};
    state.list.forEach(function (c) { c._k = state.perDay[c.date] || 0; state.perDay[c.date] = c._k + 1; });
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
    filtrarLista();
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
    var opts = [["", tr("Mundo")], ["home", h.label]];
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
    if (left > 0 && nextPost(art)) t = tr("MAIS {n} " + (left === 1 ? "ESTREIA" : "ESTREIAS") + quando, { n: left });
    $("cue-txt").textContent = t;
    $("cue").hidden = !t;
    $("cue-btn").setAttribute("aria-label", t ? tr("Rolar para a próxima campanha. {s}", { s: t.toLowerCase() }) : "");
  }
  $("cue-btn").addEventListener("click", function () {
    var a = active ? active.art : document.querySelector(".post");
    var n = a && nextPost(a);
    if (n) n.scrollIntoView({ block: "center", behavior: REDUCE ? "auto" : "smooth" });
  });

  /* ---------- Voltar ao topo: desliga o scroll-snap durante a subida (no iPhone ele travava) ---------- */
  var topoT = 0;
  function irAoTopo() {
    closeComments(); closeMenu();
    var h = document.documentElement;
    h.classList.add("nosnap");
    var suave = !REDUCE && !window.matchMedia("(max-width: 760px)").matches;
    window.scrollTo({ top: 0, behavior: suave ? "smooth" : "auto" });
    clearTimeout(topoT);
    (function fim(t0) {
      if (window.scrollY <= 2 || Date.now() - t0 > 2500) { topoT = setTimeout(function () { if (!drawer) h.classList.remove("nosnap"); }, 120); return; }
      requestAnimationFrame(function () { fim(t0); });
    })(Date.now());
  }

  /* ---------- Botão de voltar ao topo: aparece depois do primeiro post ---------- */
  (function () {
    var b = el("button", "to-top");
    b.type = "button";
    b.setAttribute("aria-label", tr("Voltar ao topo"));
    b.title = tr("Voltar ao topo");
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M5 12l7-7 7 7"/></svg>';
    b.addEventListener("click", irAoTopo);
    document.body.appendChild(b);
    var on = false;
    window.addEventListener("scroll", function () {
      var v = window.scrollY > window.innerHeight * 0.8;
      if (v !== on) { on = v; b.classList.toggle("on", v); }
    }, { passive: true });
  })();

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
    if (datas.length) { inp.min = antigo.min && antigo.min < datas[0] ? antigo.min : datas[0]; inp.max = datas[datas.length - 1]; }
    inp.value = state.upTo || "";
    $("cal-txt").textContent = state.upTo ? (+state.upTo.slice(8, 10)) + " " + MESES[+state.upTo.slice(5, 7) - 1].toLowerCase() : tr("Hoje");
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
      carregarAte(state.upTo).then(function () { renderAll(); });
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
        pill.textContent = tr(n === 1 ? "↑ {n} campanha nova" : "↑ {n} campanhas novas", { n: n });
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
  $("top").addEventListener("click", function (e) { e.preventDefault(); irAoTopo(); });
  document.addEventListener("visibilitychange", function () {
    if (!active || !active.player) return;
    try {
      if (document.hidden) { if (active.kind === "yt") active.player.pauseVideo(); else active.player.pause(); }
      else { if (active.kind === "yt") active.player.playVideo(); else active.player.play(); }
    } catch (e) { /* nada */ }
  });
  setupIO();
  // logo animado (~750 KB): só começa a baixar depois que a página e as campanhas carregaram;
  // com "economia de dados" ou movimento reduzido, fica só a imagem parada
  (function () {
    var v = $("logo-vid");
    if (!v || REDUCE || (navigator.connection && navigator.connection.saveData)) return;
    function liga() { v.preload = "auto"; var p = v.play(); if (p && p.catch) p.catch(function () { /* fica a imagem */ }); }
    function depois() { (window.requestIdleCallback || function (f) { setTimeout(f, 1200); })(liga, { timeout: 4000 }); }
    if (document.readyState === "complete") setTimeout(depois, 1500);
    else window.addEventListener("load", function () { setTimeout(depois, 1500); }, { once: true });
  })();
  // feed.json é a versão enxuta (gerada na publicação); campaigns.json fica de reserva.
  // "no-cache" revalida com o servidor: se nada mudou, o navegador usa a cópia que já tem.
  // título e resumo vêm na língua de quem lê: feed-en.json (inglês, também para as outras línguas) e
  // feed-es.json; em português, feed.json. Os anos antigos seguem o mesmo padrão (antigo/2024-en.json).
  // texto longo da campanha (o que abre em "Ver mais"), na língua de quem lê quando já foi traduzido
  function buscarHistoria(c) {
    var base = "historia/" + encodeURIComponent(c.id);
    var suf = sufixoConteudo();
    var pt = function () { return fetch(base + ".json"); };
    if (!suf) return pt();
    return fetch(base + suf + ".json").then(function (r) { return r.ok ? r : pt(); }, pt);
  }
  function sufixoConteudo() { return LANG === "pt" ? "" : LANG === "es" ? "-es" : "-en"; }
  var sufixoCarregado = "";
  function loadData(mode) {
    function get(f) { return fetch(f, { cache: mode }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
    var suf = sufixoConteudo();
    sufixoCarregado = suf;
    return get("feed" + suf + ".json")
      .catch(function () { sufixoCarregado = ""; return get("feed.json"); })
      .catch(function () { return get("campaigns.json"); });
  }
  // dados e país de quem entra chegam ao mesmo tempo
  aplicarLingua(linguaContato()); // primeiro palpite (país salvo ou língua do navegador)
  Promise.all([loadData("no-cache"), detectCountry(), carregarIndice()])
    .then(function (res) {
      paisVisita = res[1] || "";
      aplicarLingua(linguaContato()); // a língua do país de onde vem o acesso
      // o país mostrou outra língua que a do primeiro palpite: baixa o feed na língua certa
      if (sufixoConteudo() !== sufixoCarregado) return loadData("no-cache").then(function (d) { res[0] = d; return res; });
      return res;
    })
    .then(function (res) {
      state.items = normalize(res[0]);
      setHome(res[1]);
      pintarContato();
      $("status").hidden = true;
      renderAll();
      goTo(sharedId());
      resumeLogin();
      registrarVisita();
    })
    .catch(function (err) {
      console.log("ERRO", err && err.stack);
      $("status").textContent = tr("Não foi possível carregar as campanhas. Recarregue a página em alguns minutos.");
    });
})();
