import { describe, expect, it } from "vite-plus/test";
import { youtubeIdFromUrl } from "../src/shared/youtube.ts";

describe("youtubeIdFromUrl", () => {
  it("extracts ids from the common URL shapes", () => {
    expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFromUrl("https://youtube.com/watch?v=dQw4w9WgXcQ&t=30")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFromUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFromUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFromUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x")).toBe(
      "dQw4w9WgXcQ",
    );
  });
  it("rejects other hosts and malformed ids", () => {
    expect(youtubeIdFromUrl("https://vimeo.com/123")).toBeNull();
    expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeIdFromUrl("garbage")).toBeNull();
  });
});
