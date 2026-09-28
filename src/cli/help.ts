export const HELP = `digga - dig Discogs vinyl by ear

Usage: digga <command> [options]

Commands:
  dump load <file|->        Stream a Discogs releases dump (.xml.gz, .xml or XML on stdin)
                            into the local universe, filtered by config universe.styles.
      --limit N             Stop after N matching releases (dev aid)
      --dry-run             Count matches without writing
      --labels FILE         Match by label ids listed in FILE (one per line), any style
      --artists FILE        Match by artist ids listed in FILE, any style
  import collection         Seed verdicts from your Discogs collection
  import wantlist           Seed verdicts from your Discogs wantlist
  import history            Mark releases you already opened on discogs.com as seen
      --browser NAME        brave (default) | chrome | firefox
      --path FILE           Explicit History / places.sqlite file
  import list               Mark the releases on your Discogs Maybe list as maybe
      --list ID             Another list than discogs.maybeListId
  enrich [--ahead N]        Fetch price, have/want and fresh videos for the next N queue items (default 200)
  stats                     Print universe size, verdict counts, remaining and ETA
  backup                    Copy the database into data/backups now (serve does it once a day)
  serve [--port N] [--host H]
                            Start the local server (default 127.0.0.1:3456; --port 0 picks a free port)
  help                      Show this help

Environment:
  DIGGA_DATA_DIR            Data directory (default ./data)
  DIGGA_CONFIG_FILE         Config file (default ./digga.config.json)
  DISCOGS_TOKEN             Personal access token (or put it in .env)
  DIGGA_LOG_LEVEL           debug | info | warn | error
`;
