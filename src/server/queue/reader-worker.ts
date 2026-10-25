import { parentPort, workerData } from "node:worker_threads";
import { followCatalogueVersion } from "../db/catalogue-memo.ts";
import { openDb } from "../db/db.ts";
import { answerReaderRequest, type ReaderMessage, type ReaderReply } from "./reader.ts";

const { dbFile } = workerData as { dbFile: string };
const port = parentPort;
if (!port) throw new Error("reader-worker must run inside a Worker");

const db = openDb(dbFile, { readonly: true });

port.on("message", (message: ReaderMessage) => {
  followCatalogueVersion(db, message.version);
  let reply: ReaderReply;
  try {
    reply = { id: message.id, ok: true, result: answerReaderRequest(db, message.request) };
  } catch (error) {
    reply = {
      id: message.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(reply);
});
