export const HELP = `digga - dig Discogs vinyl by ear

Usage: digga <command> [options]

Commands:
  dump download             Download the newest releases dump from data.discogs.com into
                            data/dumps/, unless it is there already
  dump update               Download the newest dump unless it is there, then load it
  dump load <file|->        Stream a Discogs releases dump (.xml.gz, .xml or XML on stdin)
                            into the local universe, filtered by config universe.styles; with
                            universe.coverage, other styles on the labels and by the artists of
                            records you want or own too
      --limit N             Stop after N matching releases (dev aid; keeps no other styles)
      --dry-run             Count matches without writing
      --labels FILE         Add the label ids in FILE (one per line) to the coverage pass
      --artists FILE        Add the artist ids in FILE to the coverage pass
  import collection         Seed verdicts from your Discogs collection
  import wantlist           Seed verdicts from your Discogs wantlist
  import history            Mark releases you already opened on discogs.com as seen
      --browser NAME        brave (default) | chrome | firefox
      --path FILE           Explicit History / places.sqlite file
  import list               Mark the releases on your Discogs Maybe list as maybe
      --list ID             Another list than discogs.maybeListId
  import seller <username>  Read what a seller has for sale, to dig only that (F in Triage)
  stats                     Print universe size, verdict counts, remaining and ETA
  backup                    Copy the database into data/backups now (serve does it once a day)
  serve [--port N] [--host H]
                            Start the local server (default 127.0.0.1:3456; --port 0 picks a free port)
  help                      Show this help

Environment:
  DIGGA_DATA_DIR            Data directory (default ./data)
  DIGGA_CONFIG_FILE         Config file (default ./digga.config.json)
  DISCOGS_TOKEN             Personal access token (or save it in Settings, which writes .env)
  DIGGA_LOG_LEVEL           debug | info | warn | error
`;
