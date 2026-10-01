export const HELP = `digga - dig Discogs vinyl by ear

Usage: digga <command> [options]

Commands:
  dump download             Download the newest releases dump from data.discogs.com into
                            the dumps folder, unless it is there already
  dump update               Download the newest dump unless it is there, then load it
  dump load <file|->        Stream a Discogs releases dump (.xml.gz, .xml or XML on stdin)
                            into the local universe, filtered by config universe.styles; with
                            universe.coverage, other styles on the labels and by the artists of
                            records you want or own too
      --limit N             Stop after N matching releases (dev aid; keeps no other styles)
      --dry-run             Count matches without writing
      --labels FILE         Add the label ids in FILE (one per line) to the coverage pass
      --artists FILE        Add the artist ids in FILE to the coverage pass
  dump census <file>        Count releases per style and year in a dump, for the setup's style
                            picker; writes the census shipped with Digga (docs/STYLE_CENSUS.md)
      --out FILE            Write it elsewhere
  import collection         Seed verdicts from your Discogs collection
  import wantlist           Seed verdicts from your Discogs wantlist
  import history            Mark releases you already opened on discogs.com as seen
      --browser NAME        brave (default) | chrome | firefox
      --path FILE           Explicit History / places.sqlite file
  import list               Mark the releases on your Discogs Maybe list as maybe
      --list ID             Another list than discogs.maybeListId
  import seller <username>  Read what a seller has for sale, to dig only that (F in Triage)
  stats                     Print universe size, verdict counts, remaining and ETA
  backup                    Copy the database and write the decisions backup into the backups folder
                            now (serve does both once a day)
  restore <file>            Restore a decisions backup (decisions-YYYY-MM-DD.json.gz, a path or a
                            name in the backups folder) into the library, after copying the database
  serve [--port N] [--host H]
                            Start the local server (default 127.0.0.1:3456; --port 0 picks a free port)
  help                      Show this help

Environment (also read from a .env in the current folder; variables already set win):
  DIGGA_DATA_DIR            Library folder: database, backups, config, saved token (default
                            ~/Library/Application Support/Digga on macOS, %APPDATA%\\Digga on
                            Windows, ~/.config/Digga elsewhere)
  DIGGA_DUMPS_DIR           Dumps folder (default the OS cache folder, such as ~/Library/Caches/
                            Digga/dumps; with DIGGA_DATA_DIR, dumps/ inside it)
  DIGGA_CONFIG_FILE         Config file (default digga.config.json in the library folder)
  DISCOGS_TOKEN             Personal access token; overrides the one saved in Settings
  DIGGA_DUMPS_URL           Another address for data.discogs.com, to rehearse the setup with
                            tools/dev/fake-services.ts
  DIGGA_DISCOGS_API_URL     Another address for the Discogs API, the same way
  DIGGA_YOUTUBE_OEMBED_URL  Another address for YouTube's oEmbed, the same way
  DIGGA_LOG_LEVEL           debug | info | warn | error
`;
