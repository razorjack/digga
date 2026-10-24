/** Accept short tags such as v0.1, but always package a three-part version. */
export function releaseVersion(tag: string): string {
  const match =
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      tag,
    );
  if (!match || match[0] !== tag)
    throw new Error(`Invalid release tag: ${tag}. Use v0.1.0 or v0.1.0-beta.1.`);

  const [, major, minor, patch = "0", prerelease] = match;
  if (![major, minor, patch].every((part) => Number.isSafeInteger(Number(part))))
    throw new Error(`Invalid release tag: ${tag}. Version components exceed npm's numeric limit.`);
  if (prerelease?.split(".").some((part) => /^0\d+$/.test(part)))
    throw new Error(
      `Invalid release tag: ${tag}. Numeric prerelease identifiers cannot start with 0.`,
    );

  const core = `${major}.${minor}.${patch}`;
  const version = prerelease ? `${core}-${prerelease}` : core;
  // npm's semver parser limits the complete version, including prerelease identifiers.
  if (version.length > 256)
    throw new Error(`Invalid release tag: ${tag}. Versions cannot exceed 256 characters.`);
  return version;
}

if (import.meta.main) console.log(releaseVersion(process.argv[2] ?? ""));
