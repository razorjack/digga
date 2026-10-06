import { describe, expect, it } from "vite-plus/test";
import { chromeUserAgent } from "../electron/user-agent.ts";

describe("the window's user agent", () => {
  it("is Chrome's, without the app's and Electron's tokens", () => {
    expect(
      chromeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Digga/0.0.0 Chrome/146.0.7680.80 Electron/44.5.1 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.80 Safari/537.36",
    );
    expect(
      chromeUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) digga/1.2.3 Chrome/146.0.7680.80 Electron/44.5.1 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.80 Safari/537.36",
    );
  });
});
