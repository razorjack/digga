#!/usr/bin/env node
import { cmdBackup, cmdDumpLoad, cmdEnrich, cmdImport, cmdServe, cmdStats } from "./commands.ts";
import { HELP } from "./help.ts";
import { boot } from "./runtime.ts";

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || ["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
    return;
  }
  const runtime = boot();
  switch (command) {
    case "dump":
      if (args[0] !== "load") throw new Error("usage: digga dump load <file|->");
      return cmdDumpLoad(runtime, args.slice(1));
    case "import":
      return cmdImport(runtime, args);
    case "enrich":
      return cmdEnrich(runtime, args);
    case "stats":
      return cmdStats(runtime);
    case "backup":
      return cmdBackup(runtime);
    case "serve":
      return cmdServe(runtime, args);
    default:
      throw new Error(`unknown command "${command}"\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`digga: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
