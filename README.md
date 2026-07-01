# Quire

A book recommender you point at a person. Pick what a reader is drawn to, rate a
few books they already know, and Quire suggests what to read next — and tells you
*why* each title surfaced. It works across every genre, runs entirely in the
browser, and needs no server, account, or build step.

Keep a separate **reader** for each person you recommend to (a sibling, a friend,
yourself). Each reader learns independently from its own interests and ratings.

## Run it

It's plain HTML/CSS/JS. Any of these work:

- **Open locally** — double-click `index.html`. (On `file://` some browsers won't
  keep data between sessions; use one of the options below if you want persistence.)
- **Local server** — `python3 -m http.server` in this folder, then open the shown
  address.
- **GitHub Pages** — push these files to a repo, then *Settings → Pages → Deploy
  from a branch → main / root*. Your app appears at
  `https://<username>.github.io/<repo>/`. Nothing else to configure.

## How it chooses

The engine is content-based and fully transparent:

1. Every book is tagged with its themes, mood, genre, and author.
2. Rating a book adds its tags to that reader's **taste profile**; a high rating
   pushes those tags up, a low rating pushes them down. The interests you pick at
   setup seed the profile before any ratings exist.
3. Each unread book is scored by how well its tags line up with the profile
   (length-normalised so densely tagged books don't win by default).
4. The results are spread across genres so the list never collapses into one, and
   each card shows its match, the themes that matched, and which loved book drove it.

The match percentage is relative *within a batch* — it's a ranking, not a promise.

## Add or edit books

All titles live in **`books.js`** as one array. Copy an existing entry and change
the fields:

```js
{ id: 271, title: "…", author: "…", year: 1999,
  genres: ["Science Fiction"],
  tags: ["identity","memory","dark","cerebral"],
  blurb: "One tight sentence — your own words." }
```

- `id` must be unique.
- `genres` and `tags` are how recommendations connect, so reuse the spellings
  already in the file (`dark`, `existentialism`, `found-family`, `Literary
  Fiction`, …) rather than inventing near-duplicates. Shared tags are the signal.
- Ships with 270 books across 13 genres. Grow it as much as you like.

## Files

| File | What it is |
|------|------------|
| `index.html` | Shell + styles; loads the two scripts. |
| `books.js` | The corpus — edit this to add books. |
| `app.js` | Engine (profile, scoring, explanations) + interface. |

## Data & privacy

Everything stays in your browser's `localStorage` on this device — nothing is sent
anywhere. Back up or move a setup from the **You** tab (Export → copy the text;
Import → paste it). *Reset this reader* clears one profile; *Erase everything*
wipes all readers on the device.
