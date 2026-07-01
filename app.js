/* Quire — engine + interface
   A content-based book recommender you point at a person. No backend,
   no accounts; everything lives in localStorage on this device.

   Keep a separate "reader" for each person you recommend to — each one
   learns on its own from the interests you pick and the ratings you give.
   The engine is transparent: every rating reweights a taste profile over
   shared tags, and every recommendation shows why it surfaced. */

window.Quire = (function () {
  "use strict";

  var BOOKS = window.BOOKS || [];
  var BY_ID = {}, BY_TITLE = {};
  BOOKS.forEach(function (b) { BY_ID[b.id] = b; BY_TITLE[b.title.toLowerCase()] = b; });

  /* ---- tuning ---- */
  var W = { tag: 1.0, genre: 1.6, author: 2.3 };
  var SEED_W = 2.2;
  var N_RECS = 12;
  var GENRE_CAP = 3;
  var STORE_KEY = "quire.v2";

  /* ---- safe storage (falls back to memory on file://) ---- */
  var mem = null;
  function read() { if (mem) return mem; try { var r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return mem; } }
  function persist() { mem = state; try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

  function blankReader(name) {
    return { name: name || "Reader", ratings: {}, interests: [], dismissed: [], saved: [], onboarded: false };
  }

  var state = read();
  if (!state || !state.readers) {
    // fresh, or migrate a legacy single-reader shape
    var first = "r" + Date.now();
    var r0 = blankReader("Reader 1");
    if (state && state.ratings) { r0.ratings = state.ratings; r0.interests = state.interests || []; r0.dismissed = state.dismissed || []; r0.saved = state.saved || []; r0.onboarded = !!state.onboarded; }
    state = { version: 2, activeReader: first, readers: {} };
    state.readers[first] = r0;
  }
  function R() { return state.readers[state.activeReader]; }
  var save = persist;

  /* ---- features & profile ---- */
  function featuresOf(b) {
    var f = [];
    (b.tags || []).forEach(function (t) { f.push("t:" + t); });
    (b.genres || []).forEach(function (g) { f.push("g:" + g); });
    f.push("a:" + b.author);
    return f;
  }
  function weightOf(f) { var c = f.charAt(0); return c === "a" ? W.author : c === "g" ? W.genre : W.tag; }
  function pretty(f) { return f.slice(2).replace(/-/g, " "); }

  function buildProfile(includeSeed) {
    var r = R(), p = Object.create(null);
    if (includeSeed !== false) r.interests.forEach(function (f) { p[f] = (p[f] || 0) + SEED_W; });
    Object.keys(r.ratings).forEach(function (id) {
      var b = BY_ID[id]; if (!b) return;
      var sig = r.ratings[id] - 3;
      featuresOf(b).forEach(function (f) { p[f] = (p[f] || 0) + sig * weightOf(f); });
    });
    return p;
  }
  function scoreBook(b, p) { var f = featuresOf(b), s = 0; for (var i = 0; i < f.length; i++) if (p[f[i]]) s += p[f[i]]; return s / Math.sqrt(f.length); }
  function overlap(a, b) { var set = {}, n = 0; a.forEach(function (x) { set[x] = 1; }); b.forEach(function (x) { if (set[x]) n++; }); return n; }

  function reasonsFor(book, p) {
    var feats = featuresOf(book).filter(function (f) { return f.charAt(0) !== "a" && p[f] > 0; });
    feats.sort(function (x, y) { return p[y] - p[x]; });
    var chips = feats.slice(0, 3).map(pretty);
    var best = null, bestOv = 0, bf = featuresOf(book), r = R();
    Object.keys(r.ratings).forEach(function (id) {
      if (r.ratings[id] < 4) return; var ob = BY_ID[id]; if (!ob) return;
      var ov = overlap(bf, featuresOf(ob)); if (ov > bestOv) { bestOv = ov; best = ob; }
    });
    return { chips: chips, because: (best && bestOv >= 2) ? best.title : null };
  }

  function coldSample(cands) {
    var arr = cands.slice(), seed = 11;
    for (var i = arr.length - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; var j = Math.floor((seed / 233280) * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  function getRecs() {
    var r = R(), p = buildProfile();
    var hasSignal = Object.keys(p).length > 0;
    var dis = {}; r.dismissed.forEach(function (id) { dis[id] = 1; });
    var cands = BOOKS.filter(function (b) { return !(b.id in r.ratings) && !dis[b.id]; });

    var scored;
    if (hasSignal) { scored = cands.map(function (b) { return { book: b, score: scoreBook(b, p) }; }); scored.sort(function (a, b) { return b.score - a.score; }); }
    else scored = coldSample(cands).map(function (b) { return { book: b, score: 0 }; });

    var pool = scored.slice(0, Math.max(N_RECS * 4, 44)), picked = [], gc = {};
    pool.forEach(function (it) { if (picked.length >= N_RECS) return; var g = it.book.genres[0]; if ((gc[g] || 0) >= GENRE_CAP) return; picked.push(it); gc[g] = (gc[g] || 0) + 1; });
    if (picked.length < N_RECS) pool.forEach(function (it) { if (picked.length >= N_RECS) return; if (picked.indexOf(it) === -1) picked.push(it); });

    var sc = picked.map(function (x) { return x.score; }), mn = Math.min.apply(null, sc), mx = Math.max.apply(null, sc);
    picked.forEach(function (it) {
      it.pct = hasSignal ? (mx > mn ? Math.round(73 + ((it.score - mn) / (mx - mn)) * 25) : 88) : null;
      it.reasons = hasSignal ? reasonsFor(it.book, p) : { chips: [], because: null };
    });
    return { list: picked, hasSignal: hasSignal };
  }

  function tasteProfile() {
    var r = R(), p = buildProfile(false), tags = [], genres = [];
    Object.keys(p).forEach(function (f) { if (p[f] <= 0) return; if (f.charAt(0) === "t") tags.push([pretty(f), p[f]]); else if (f.charAt(0) === "g") genres.push([pretty(f), p[f]]); });
    tags.sort(function (a, b) { return b[1] - a[1]; }); genres.sort(function (a, b) { return b[1] - a[1]; });
    var authors = {};
    Object.keys(r.ratings).forEach(function (id) { if (r.ratings[id] < 4) return; var b = BY_ID[id]; if (b) authors[b.author] = (authors[b.author] || 0) + 1; });
    var al = Object.keys(authors).map(function (a) { return [a, authors[a]]; }).sort(function (x, y) { return y[1] - x[1]; });
    var ids = Object.keys(r.ratings), sum = 0; ids.forEach(function (id) { sum += r.ratings[id]; });
    return { tags: tags.slice(0, 8), genres: genres.slice(0, 6), authors: al, rated: ids.length, avg: ids.length ? sum / ids.length : 0, saved: r.saved.length };
  }

  /* ---- view helpers ---- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var STAR_PATH = '<path d="M12 3.5l2.7 5.9 6.5.55-4.9 4.25 1.5 6.35L12 21.6l-5.8 3.35 1.5-6.35-4.9-4.25 6.5-.55z"/>';
  function stars(id, cur, size) {
    var o = '<div class="stars ' + (size || "") + '" role="group" aria-label="Rate">';
    for (var i = 1; i <= 5; i++) o += '<button class="' + (i <= cur ? "on" : "") + '" aria-label="Rate ' + i + ' of 5" onclick="Quire.rate(' + id + "," + i + ')"><svg viewBox="0 0 24 26">' + STAR_PATH + '</svg></button>';
    return o + "</div>";
  }
  function genreChips(gs) { return '<div class="genres">' + gs.map(function (g) { return '<span class="genre">' + esc(g) + "</span>"; }).join("") + "</div>"; }

  var IC = {
    recs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" stroke-linejoin="round"/></svg>',
    browse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4" stroke-linecap="round"/></svg>',
    shelf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 4h9a2 2 0 012 2v14l-6.5-3.2L5 20z" stroke-linejoin="round"/><path d="M16 6h3v14l-3-1.5"/></svg>',
    you: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4" stroke-linecap="round"/></svg>'
  };

  /* ---- interest vocabulary (neutral) ---- */
  var THEME_OPTS = ["existentialism", "absurdism", "nihilism", "morality", "free-will", "consciousness", "mortality", "meaning", "identity", "memory", "love", "desire", "power", "war", "dystopia", "technology", "ai", "space", "aliens", "nature", "crime", "madness", "coming-of-age", "survival", "family", "faith", "surreal", "mythology", "magic", "adventure"];
  var MOOD_OPTS = ["dark", "bleak", "lyrical", "atmospheric", "cerebral", "melancholic", "epic", "experimental", "hopeful", "gritty", "whimsical", "tense", "romantic", "contemplative", "minimalist"];
  var GENRE_OPTS = ["Literary Fiction", "Science Fiction", "Fantasy", "Philosophy", "Horror", "Mystery & Thriller", "Classic", "Poetry", "Nonfiction", "Historical", "Romance", "Short Stories"];
  var STARTER_TITLES = ["To Kill a Mockingbird", "1984", "Pride and Prejudice", "The Great Gatsby", "The Hobbit", "Dune", "The Name of the Wind", "Harry Potter and the Philosopher's Stone", "The Hunger Games", "Crime and Punishment", "The Alchemist", "The Kite Runner", "Gone Girl", "The Silent Patient", "Where the Crawdads Sing", "The Midnight Library", "Circe", "The Song of Achilles", "The Three-Body Problem", "Sapiens", "Educated", "The Secret History", "The Road", "Normal People"];

  /* ---- routing ---- */
  var route = "recs", browseQuery = "", browseFilter = "All", obStep = 1, obSel = [], intSel = [];

  function readerBar(setup) {
    var r = R();
    if (setup) return '<div class="readerbar"><span class="rb-label">setting up</span><span class="rb-name static">' + esc(r.name) + "</span></div>";
    return '<div class="readerbar"><span class="rb-label">recommending to</span><button class="rb-name" onclick="Quire.go(\'readers\')">' + esc(r.name) + ' <span class="rb-caret">▾</span></button></div>';
  }
  function eyebrow(txt) { return '<div class="section-label">' + esc(txt) + '<span class="line"></span></div>'; }

  function renderTabs() {
    var nav = document.getElementById("tabs");
    if (!R().onboarded) { nav.style.display = "none"; return; }
    nav.style.display = "flex";
    var items = [["recs", "For You"], ["browse", "Browse"], ["shelf", "Shelf"], ["you", "You"]];
    nav.innerHTML = items.map(function (it) {
      var active = (route === it[0] || (route === "interests" && it[0] === "you") || (route === "readers" && it[0] === "you")) ? "active" : "";
      return '<button class="' + active + '" onclick="Quire.go(\'' + it[0] + '\')">' + IC[it[0]] + "<span>" + it[1] + "</span></button>";
    }).join("");
  }

  function render() {
    var v = document.getElementById("view");
    if (!R().onboarded) { v.innerHTML = renderOnboarding(); renderTabs(); return; }
    renderTabs();
    if (route === "recs") v.innerHTML = readerBar() + renderRecs();
    else if (route === "browse") { v.innerHTML = readerBar() + renderBrowse(); focusSearch(); }
    else if (route === "shelf") v.innerHTML = readerBar() + renderShelf();
    else if (route === "you") v.innerHTML = readerBar() + renderYou();
    else if (route === "interests") v.innerHTML = readerBar() + renderInterests();
    else if (route === "readers") v.innerHTML = renderReaders();
  }

  /* ---- For You ---- */
  function renderRecs() {
    var r = getRecs(), ratedN = Object.keys(R().ratings).length;
    var sub = ratedN === 0
      ? "Starting from the interests you picked. Rate a few below and the list sharpens."
      : "Tuned to <em>" + ratedN + (ratedN === 1 ? " rating</em>" : " ratings</em>") + " and the chosen interests.";
    if (!r.list.length) return '<div class="view">' + eyebrow("chosen for this reader") + '<div class="empty"><div class="mark">fin.</div><p>Everything in the library has been rated or set aside for this reader. Add more titles to books.js, or reset from the You tab.</p></div></div>';

    var cards = r.list.map(function (it) {
      var b = it.book, saved = R().saved.indexOf(b.id) !== -1;
      var top = it.pct != null ? '<div class="match"><span class="pct">' + it.pct + '%</span><span class="lbl">match</span></div>' : '<div class="match"><span class="lbl">a place<br>to start</span></div>';
      var why = "";
      if (it.reasons.because || it.reasons.chips.length) {
        why = '<div class="why">';
        if (it.reasons.because) why += '<div class="because">Because they rated <b>' + esc(it.reasons.because) + "</b> highly</div>";
        if (it.reasons.chips.length) why += '<div class="why-chips">' + it.reasons.chips.map(function (c) { return '<span class="wchip">' + esc(c) + "</span>"; }).join("") + "</div>";
        why += "</div>";
      }
      return '<article class="book">' + top +
        "<h3>" + esc(b.title) + "</h3>" +
        '<div class="meta">' + esc(b.author) + ' <span class="yr">· ' + b.year + "</span></div>" +
        genreChips(b.genres) +
        '<p class="blurb">' + esc(b.blurb) + "</p>" + why +
        '<div class="card-actions">' + stars(b.id, 0) +
        '<div class="mini-actions"><button class="dismiss" onclick="Quire.saveToggle(' + b.id + ')">' + (saved ? "saved ✓" : "save") + '</button>' +
        '<button class="dismiss" onclick="Quire.dismiss(' + b.id + ')">not for them</button></div></div></article>';
    }).join("");

    return '<div class="view">' + eyebrow("chosen for this reader") +
      '<div class="view-head"><h2>For You</h2><p>' + sub + "</p></div>" + cards + "</div>";
  }

  /* ---- Browse ---- */
  var GENRE_SET = (function () { var s = {}; BOOKS.forEach(function (b) { b.genres.forEach(function (g) { s[g] = 1; }); }); return ["All"].concat(Object.keys(s).sort()); })();
  function browseMatches() {
    var q = browseQuery.trim().toLowerCase();
    return BOOKS.filter(function (b) {
      if (browseFilter !== "All" && b.genres.indexOf(browseFilter) === -1) return false;
      if (!q) return true;
      return (b.title + " " + b.author + " " + b.tags.join(" ")).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.title < b.title ? -1 : 1; });
  }
  function browseRowsHTML() {
    var list = browseMatches(), r = R();
    if (!list.length) return '<p class="count">No titles match. Try another word.</p>';
    var rows = list.map(function (b) {
      return '<div class="row"><div class="info"><h4>' + esc(b.title) + "</h4><div class=\"m\">" + esc(b.author) + " · " + b.year + " · " + esc(b.genres[0]) + "</div></div>" + stars(b.id, r.ratings[b.id] || 0) + "</div>";
    }).join("");
    return '<div class="count">' + list.length + " titles</div>" + rows;
  }
  function renderBrowse() {
    var filters = GENRE_SET.map(function (g) { return '<button class="filter ' + (browseFilter === g ? "active" : "") + '" onclick="Quire.setFilter(\'' + g.replace(/'/g, "\\'") + "')\">" + esc(g) + "</button>"; }).join("");
    return '<div class="view">' + eyebrow("the whole library") +
      '<div class="view-head"><h2>Browse</h2><p>Rate anything this reader has already read — that is how Quire learns their <em>past</em>.</p></div>' +
      '<div class="searchbar">' + IC.search + '<input id="q" type="text" placeholder="Search title, author, theme" oninput="Quire.onSearch(this.value)" value="' + esc(browseQuery) + '" /></div>' +
      '<div class="filters">' + filters + '</div><div id="browse-results">' + browseRowsHTML() + "</div></div>";
  }
  function focusSearch() { var el = document.getElementById("q"); if (el && browseQuery) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }

  /* ---- Shelf ---- */
  function renderShelf() {
    var r = R();
    var rated = Object.keys(r.ratings).map(function (id) { return BY_ID[id]; }).filter(Boolean).sort(function (a, b) { return r.ratings[b.id] - r.ratings[a.id]; });
    var saved = r.saved.map(function (id) { return BY_ID[id]; }).filter(Boolean);
    var head = '<div class="view">' + eyebrow("this reader's record") + '<div class="view-head"><h2>Shelf</h2><p>What you have recorded for this reader. Ratings here retune <em>For You</em> at once.</p></div>';
    if (!rated.length && !saved.length) return head + '<div class="empty"><div class="mark">empty</div><p>Nothing yet. Go to Browse and rate a few books this reader has read.</p></div></div>';
    var body = "";
    if (rated.length) {
      body += eyebrow("rated · " + rated.length);
      body += rated.map(function (b) { return '<div class="row"><div class="info"><h4>' + esc(b.title) + "</h4><div class=\"m\">" + esc(b.author) + " · " + b.year + "</div></div>" + stars(b.id, r.ratings[b.id]) + "</div>"; }).join("");
    }
    if (saved.length) {
      body += eyebrow("saved to suggest · " + saved.length);
      body += saved.map(function (b) { return '<div class="row"><div class="info"><h4>' + esc(b.title) + "</h4><div class=\"m\">" + esc(b.author) + " · " + b.year + "</div></div><button class=\"dismiss\" onclick=\"Quire.saveToggle(" + b.id + ')">remove</button></div>'; }).join("");
    }
    return head + body + "</div>";
  }

  /* ---- You / taste ---- */
  function renderYou() {
    var t = tasteProfile();
    var head = '<div class="view">' + eyebrow("this reader's taste") + '<div class="view-head"><h2>You</h2><p>The shape Quire has inferred for <em>' + esc(R().name) + '</em> from their ratings.</p></div>';
    var statsHTML = '<div class="stats"><div class="stat"><div class="v">' + t.rated + '</div><div class="k">books rated</div></div><div class="stat"><div class="v">' + (t.rated ? t.avg.toFixed(1) : "—") + '</div><div class="k">avg rating</div></div><div class="stat"><div class="v">' + t.saved + '</div><div class="k">saved</div></div></div>';
    var taste = "";
    if (t.tags.length) {
      var max = t.tags[0][1];
      taste += eyebrow("strongest themes") + '<div class="bars">' + t.tags.map(function (x) { var w = Math.max(8, Math.round((x[1] / max) * 100)); return '<div class="bar"><span class="lab">' + esc(x[0]) + '</span><span class="track"><span class="fill" style="width:' + w + '%"></span></span></div>'; }).join("") + "</div>";
    } else {
      taste += '<p class="tiny" style="margin-top:16px">Rate a few books in Browse and this reader\'s taste map fills in here.</p>';
    }
    if (t.genres.length) taste += eyebrow("leaning genres") + '<div class="genres" style="margin-top:6px">' + t.genres.map(function (x) { return '<span class="genre">' + esc(x[0]) + "</span>"; }).join("") + "</div>";
    if (t.authors.length) taste += eyebrow("favourite authors") + '<div class="authors">' + t.authors.slice(0, 8).map(function (x) { return '<span class="author-chip">' + esc(x[0]) + (x[1] > 1 ? '<span class="via">×' + x[1] + "</span>" : "") + "</span>"; }).join("") + "</div>";

    var interests = eyebrow("chosen interests") + '<div class="genres" style="margin-top:6px">' + (R().interests.length ? R().interests.map(function (f) { return '<span class="genre">' + esc(pretty(f)) + "</span>"; }).join("") : '<span class="tiny">none set</span>') + '</div><div class="btnrow" style="margin-top:14px"><button class="btn ghost" onclick="Quire.editInterests()">Edit interests</button><button class="btn ghost" onclick="Quire.go(\'readers\')">Switch reader</button></div>';

    var how = '<details class="datapanel" style="margin-top:22px"><summary style="cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)">How Quire chooses</summary><p class="tiny" style="margin-top:12px">Each book is tagged with its themes, mood, genre and author. A high rating adds those tags to the reader\'s profile; a low rating subtracts them. Every unread book is scored by how well its tags line up with that profile, then the list is spread across genres so it never collapses into one. The match percentage is relative within each batch — a ranking, not a promise.</p></details>';

    var data = eyebrow("backup") + '<div class="datapanel"><h4>Export — all readers</h4><textarea id="exportbox" readonly>' + esc(JSON.stringify(state)) + '</textarea><div class="btnrow" style="margin-top:10px"><button class="btn" onclick="Quire.copyBackup()">Copy</button></div><h4 style="margin-top:18px">Import — paste a backup</h4><textarea id="importbox" placeholder="Paste exported text here"></textarea><div class="btnrow" style="margin-top:10px"><button class="btn ghost" onclick="Quire.importData()">Load backup</button><span id="io-status" class="tiny"></span></div></div>' +
      '<div class="btnrow" style="margin-top:16px"><button class="btn danger" onclick="Quire.resetActive()">Reset this reader</button><button class="btn danger" onclick="Quire.resetAll()">Erase everything</button></div>';

    return head + statsHTML + taste + interests + how + data + "</div>";
  }

  /* ---- interests editor ---- */
  function chipset(opts, prefix, sel) {
    return '<div class="chipset">' + opts.map(function (o) {
      var f = prefix + o, on = sel.indexOf(f) !== -1;
      return '<button class="chip ' + (on ? "sel" : "") + '" onclick="Quire.toggleChip(this,\'' + f.replace(/'/g, "\\'") + "')\">" + esc(o) + "</button>";
    }).join("") + "</div>";
  }
  function interestPicker(sel) {
    return eyebrow("themes") + chipset(THEME_OPTS, "t:", sel) +
      eyebrow("mood") + chipset(MOOD_OPTS, "t:", sel) +
      eyebrow("genres") + chipset(GENRE_OPTS, "g:", sel);
  }
  function renderInterests() {
    intSel = R().interests.slice();
    return '<div class="view">' + eyebrow("tune the profile") +
      '<div class="view-head"><h2>Interests</h2><p>Pick what pulls this reader in. These give Quire a starting point before any ratings.</p></div>' +
      interestPicker(intSel) +
      '<div class="btnrow"><button class="btn" onclick="Quire.saveInterests()">Save interests</button><button class="skip" onclick="Quire.go(\'you\')">Cancel</button></div></div>';
  }

  /* ---- readers ---- */
  function renderReaders() {
    var ids = Object.keys(state.readers);
    var rows = ids.map(function (id) {
      var rd = state.readers[id], active = id === state.activeReader, n = Object.keys(rd.ratings).length;
      return '<div class="reader-row ' + (active ? "active" : "") + '">' +
        '<button class="reader-pick" onclick="Quire.switchReader(\'' + id + '\')"><span class="rn">' + esc(rd.name) + (active ? ' <span class="cur">current</span>' : "") + '</span><span class="rmeta">' + n + " rated · " + rd.interests.length + " interests</span></button>" +
        '<div class="reader-tools"><button class="dismiss" onclick="Quire.renameReader(\'' + id + '\')">rename</button>' + (ids.length > 1 ? '<button class="dismiss" onclick="Quire.deleteReader(\'' + id + '\')">delete</button>' : "") + "</div></div>";
    }).join("");
    return '<div class="view">' + eyebrow("people you recommend to") +
      '<div class="view-head"><h2>Readers</h2><p>Keep one profile per person. Each learns on its own.</p></div>' +
      rows +
      '<div class="datapanel" style="margin-top:18px"><h4>Add a reader</h4><div class="searchbar" style="margin-top:0"><input id="newreader" type="text" placeholder="Name (e.g. Gabriele, Mom, a friend)" /></div><div class="btnrow" style="margin-top:12px"><button class="btn" onclick="Quire.addReader()">Add &amp; set up</button><button class="skip" onclick="Quire.go(\'recs\')">Back</button></div></div></div>';
  }

  /* ---- onboarding (neutral) ---- */
  function renderOnboarding() {
    if (obStep === 1) {
      obSel = obSel.length ? obSel : R().interests.slice();
      return '<div class="view">' + readerBar(true) + eyebrow("step 1 of 2") +
        '<div class="view-head"><h2>What pulls them in?</h2><p>Pick a handful of themes, moods, or genres for <em>' + esc(R().name) + '</em>. You can skip and rate books instead.</p></div>' +
        interestPicker(obSel) +
        '<div class="btnrow"><button class="btn" onclick="Quire.obContinue()">Continue</button><button class="skip" onclick="Quire.obContinue(true)">Skip setup</button></div></div>';
    }
    var r = R();
    var starters = STARTER_TITLES.map(function (t) { return BY_TITLE[t.toLowerCase()]; }).filter(Boolean);
    var rows = starters.map(function (b) { return '<div class="row"><div class="info"><h4>' + esc(b.title) + "</h4><div class=\"m\">" + esc(b.author) + " · " + esc(b.genres[0]) + "</div></div>" + stars(b.id, r.ratings[b.id] || 0) + "</div>"; }).join("");
    return '<div class="view">' + readerBar(true) + eyebrow("step 2 of 2") +
      '<div class="view-head"><h2>Anything they have read?</h2><p>Rate a few they know — loved or hated both help. Skip any you are unsure of.</p></div>' +
      '<div style="margin-top:8px">' + rows + "</div>" +
      '<div class="btnrow"><button class="btn" onclick="Quire.obFinish()">See recommendations</button><button class="skip" onclick="Quire.obBack()">Back</button></div></div>';
  }

  /* ---- actions ---- */
  function reRenderKeepScroll() { var y = window.scrollY; render(); window.scrollTo(0, y); }

  var api = {
    go: function (r) { route = r; if (r === "browse") browseQuery = browseQuery; render(); window.scrollTo(0, 0); },
    rate: function (id, i) { var r = R(); if (r.ratings[id] === i) delete r.ratings[id]; else r.ratings[id] = i; save(); if (!r.onboarded) render(); else reRenderKeepScroll(); },
    dismiss: function (id) { var r = R(); if (r.dismissed.indexOf(id) === -1) r.dismissed.push(id); save(); reRenderKeepScroll(); },
    saveToggle: function (id) { var r = R(), i = r.saved.indexOf(id); if (i === -1) r.saved.push(id); else r.saved.splice(i, 1); save(); reRenderKeepScroll(); },
    onSearch: function (v) { browseQuery = v; var el = document.getElementById("browse-results"); if (el) el.innerHTML = browseRowsHTML(); },
    setFilter: function (g) { browseFilter = g; render(); },

    toggleChip: function (btn, f) { var arr = (route === "interests" ? intSel : obSel); var i = arr.indexOf(f); if (i === -1) { arr.push(f); btn.classList.add("sel"); } else { arr.splice(i, 1); btn.classList.remove("sel"); } },
    obContinue: function (skip) { if (!skip) R().interests = obSel.slice(); save(); obStep = 2; render(); window.scrollTo(0, 0); },
    obBack: function () { obStep = 1; render(); window.scrollTo(0, 0); },
    obFinish: function () { R().onboarded = true; obStep = 1; obSel = []; route = "recs"; save(); render(); window.scrollTo(0, 0); },
    editInterests: function () { route = "interests"; render(); window.scrollTo(0, 0); },
    saveInterests: function () { R().interests = intSel.slice(); save(); route = "you"; render(); window.scrollTo(0, 0); },

    switchReader: function (id) { state.activeReader = id; save(); route = R().onboarded ? "recs" : "recs"; obStep = 1; obSel = []; render(); window.scrollTo(0, 0); },
    addReader: function () { var el = document.getElementById("newreader"); var name = (el && el.value.trim()) || ("Reader " + (Object.keys(state.readers).length + 1)); var id = "r" + Date.now(); state.readers[id] = blankReader(name); state.activeReader = id; obStep = 1; obSel = []; save(); render(); window.scrollTo(0, 0); },
    renameReader: function (id) { var cur = state.readers[id].name; var name = window.prompt("Rename reader", cur); if (name && name.trim()) { state.readers[id].name = name.trim(); save(); render(); } },
    deleteReader: function (id) { var ids = Object.keys(state.readers); if (ids.length <= 1) return; if (!window.confirm("Delete " + state.readers[id].name + " and their ratings?")) return; delete state.readers[id]; if (state.activeReader === id) state.activeReader = Object.keys(state.readers)[0]; save(); render(); window.scrollTo(0, 0); },

    copyBackup: function () { var el = document.getElementById("exportbox"); if (!el) return; el.select(); try { navigator.clipboard.writeText(el.value); } catch (e) { document.execCommand("copy"); } var s = document.getElementById("io-status"); },
    importData: function () {
      var el = document.getElementById("importbox"), st = document.getElementById("io-status");
      try {
        var data = JSON.parse(el.value);
        if (!data.readers || !data.activeReader) throw new Error("bad");
        state = data; save(); route = "recs"; obStep = 1; render(); window.scrollTo(0, 0);
      } catch (e) { if (st) { st.textContent = "That does not look like a Quire backup."; st.style.color = "var(--warn)"; } }
    },
    resetActive: function () { if (!window.confirm("Clear all ratings and interests for " + R().name + "?")) return; var n = R().name; state.readers[state.activeReader] = blankReader(n); obStep = 1; obSel = []; route = "recs"; save(); render(); window.scrollTo(0, 0); },
    resetAll: function () { if (!window.confirm("Erase every reader and all data on this device?")) return; try { localStorage.removeItem(STORE_KEY); } catch (e) {} mem = null; var id = "r" + Date.now(); state = { version: 2, activeReader: id, readers: {} }; state.readers[id] = blankReader("Reader 1"); obStep = 1; obSel = []; route = "recs"; save(); render(); window.scrollTo(0, 0); },

    init: function () { if (!BOOKS.length) { document.getElementById("view").innerHTML = '<p class="tiny">Could not load books.js.</p>'; return; } render(); }
  };

  return api;
})();

document.addEventListener("DOMContentLoaded", function () { window.Quire.init(); });
