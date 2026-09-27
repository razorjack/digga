import { describe, expect, it } from "vite-plus/test";
import { parseDiscogsUrl } from "../src/shared/discogs-urls.ts";

describe("parseDiscogsUrl", () => {
  it("parses modern release and master URLs with and without slugs", () => {
    expect(parseDiscogsUrl("https://www.discogs.com/release/12345")).toEqual({
      kind: "release",
      id: 12345,
    });
    expect(parseDiscogsUrl("https://www.discogs.com/release/12345-Konflict-Messiah")).toEqual({
      kind: "release",
      id: 12345,
    });
    expect(parseDiscogsUrl("https://www.discogs.com/master/777")).toEqual({
      kind: "master",
      id: 777,
    });
    expect(
      parseDiscogsUrl("https://www.discogs.com/master/777-Ed-Rush-Optical-Wormhole?ev=mb"),
    ).toEqual({
      kind: "master",
      id: 777,
    });
  });

  it("parses legacy Artist-Title URLs", () => {
    expect(parseDiscogsUrl("https://www.discogs.com/Konflict-Messiah/release/12345")).toEqual({
      kind: "release",
      id: 12345,
    });
    expect(parseDiscogsUrl("http://www.discogs.com/Ed-Rush-Optical-Wormhole/master/777")).toEqual({
      kind: "master",
      id: 777,
    });
  });

  it("parses localized prefixes", () => {
    expect(parseDiscogsUrl("https://www.discogs.com/de/release/12345-Slug")).toEqual({
      kind: "release",
      id: 12345,
    });
    expect(parseDiscogsUrl("https://www.discogs.com/pl/master/777")).toEqual({
      kind: "master",
      id: 777,
    });
    expect(parseDiscogsUrl("https://www.discogs.com/fr/Konflict-Messiah/release/12345")).toEqual({
      kind: "release",
      id: 12345,
    });
  });

  it("parses marketplace release listings", () => {
    expect(parseDiscogsUrl("https://www.discogs.com/sell/release/12345?ev=rb")).toEqual({
      kind: "release",
      id: 12345,
    });
  });

  it("accepts bare and subdomain hosts", () => {
    expect(parseDiscogsUrl("https://discogs.com/release/1")).toEqual({ kind: "release", id: 1 });
    expect(parseDiscogsUrl("https://m.discogs.com/release/1")).toEqual({ kind: "release", id: 1 });
  });

  it("rejects everything else", () => {
    expect(parseDiscogsUrl("https://www.discogs.com/artist/123-Konflict")).toBeNull();
    expect(parseDiscogsUrl("https://www.discogs.com/label/456-Renegade-Hardware")).toBeNull();
    expect(parseDiscogsUrl("https://www.discogs.com/sell/item/999")).toBeNull();
    expect(parseDiscogsUrl("https://api.discogs.com/releases/12345")).toBeNull();
    expect(parseDiscogsUrl("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(parseDiscogsUrl("not a url")).toBeNull();
    expect(parseDiscogsUrl("https://www.discogs.com/release/abc")).toBeNull();
  });
});
