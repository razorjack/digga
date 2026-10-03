#!/usr/bin/env node
import {
  cmdBackup,
  cmdDumpCensus,
  cmdDumpDownload,
  cmdDumpLoad,
  cmdDumpUpdate,
  cmdImport,
  cmdRestore,
  cmdServe,
  cmdStats,
} from "./commands.ts";
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
      if (args[0] === "download") return cmdDumpDownload(runtime);
      if (args[0] === "update") return cmdDumpUpdate(runtime);
      if (args[0] === "census") return cmdDumpCensus(runtime, args.slice(1));
      if (args[0] !== "load")
        throw new Error("usage: digga dump download | update | load <file|-> | census <file>");
      return cmdDumpLoad(runtime, args.slice(1));
    case "import":
      return cmdImport(runtime, args);
    case "stats":
      return cmdStats(runtime);
    case "backup":
      return cmdBackup(runtime);
    case "restore":
      return cmdRestore(runtime, args);
    case "serve":
      return cmdServe(runtime, args);
    default:
      throw new Error(`unknown command "${command}"\n\n${HELP}`);
  }
}

// A parent that stops reading the output closes the pipe; the next log line must not end the
// command, least of all a server.
for (const output of [process.stdout, process.stderr])
  output.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`digga: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
