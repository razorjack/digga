import { expect, it } from "vite-plus/test";
import { normalizeNote } from "../src/shared/notes.ts";

it("saves a note trimmed, and a blank one as no note", () => {
  expect(normalizeNote("  warehouse roller \n")).toBe("warehouse roller");
  expect(normalizeNote(" \t\n")).toBeNull();
  expect(normalizeNote("")).toBeNull();
});
