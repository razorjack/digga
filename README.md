# Digga

Local-first app for exhaustively digging Discogs vinyl by ear. Load the Discogs releases dump for
the styles you care about, seed what you already own, want or have seen, then listen to a few
seconds of every remaining record through its YouTube links and decide with one key.

Digga is the app, your twelves are what it finds.

```sh
npm install
cp .env.example .env            # add DISCOGS_TOKEN
cp digga.config.example.json digga.config.json   # optional: the first run creates it; set discogs.username
npm run digga -- dump load data/dumps/discogs_YYYYMMDD_releases.xml.gz
npm run digga -- import collection && npm run digga -- import wantlist && npm run digga -- import history
npm run digga -- enrich
vp build && npm run digga -- serve   # open http://localhost:3456
```

See `CLAUDE.md` for the full command list and layout, `docs/` for architecture, data model, Discogs
notes, the design brief, keymap, roadmap, decisions and the Electron plan.

Status: triage, Twelves and settings are complete. The app starts in sandbox mode: verdicts,
track marks and listens stay in the browser tab and nothing is sent to Discogs. Turn it off in
Settings (or click the sandbox stamp in the header) to save verdicts and let `A` add releases to
your Discogs wantlist, which needs `DISCOGS_TOKEN` in `.env`. Keys are listed in
`docs/KEYMAP.md` and on screen with `?`.
