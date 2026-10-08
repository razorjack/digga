import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFileSink, createLogger } from "../src/server/logger.ts";

describe("the file log", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-log-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("appends each message to a file in a folder it creates, at the logger's level", () => {
    const file = path.join(tmp, "user-data", "digga.log");
    const logger = createLogger({ level: "info", sink: createFileSink(file) });

    logger.debug("not written");
    logger.info("listening on http://127.0.0.1:3456");
    logger.child("jobs").error("failed", new Error("boom"));

    const lines = fs.readFileSync(file, "utf8").split("\n");
    expect(lines[0]).toMatch(/^\S+Z INFO  \[digga\] listening on http:\/\/127\.0\.0\.1:3456$/);
    expect(lines[1]).toMatch(/^\S+Z ERROR \[digga:jobs\] failed Error: boom$/);
    expect(lines.at(-1)).toBe("");
    expect(fs.readFileSync(file, "utf8")).not.toContain("not written");
  });

  it("moves a log that has grown too large aside when it starts, replacing the earlier one", () => {
    const file = path.join(tmp, "digga.log");
    fs.writeFileSync(`${file}.1`, "the oldest start\n");
    fs.writeFileSync(file, "the last start\n");

    createLogger({ sink: createFileSink(file, { rotateAtBytes: 100 }) }).info("a small log stays");
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe("the oldest start\n");
    expect(fs.readFileSync(file, "utf8")).toMatch(/^the last start\n.* a small log stays\n$/);

    createLogger({ sink: createFileSink(file, { rotateAtBytes: 10 }) }).info("a new start");
    expect(fs.readFileSync(`${file}.1`, "utf8")).toMatch(
      /^the last start\n.* a small log stays\n$/,
    );
    expect(fs.readFileSync(file, "utf8")).toMatch(/^\S+Z INFO  \[digga\] a new start\n$/);
  });
});
