/**
 * Chrome's user agent from Electron's, without the app's and Electron's own tokens: YouTube
 * refuses some embeds to a browser it does not recognise.
 */
export function chromeUserAgent(electronUserAgent: string): string {
  return electronUserAgent.replace(/ (?!(?:AppleWebKit|Chrome|Safari)\/)[^\s()/]+\/\S+/g, "");
}
