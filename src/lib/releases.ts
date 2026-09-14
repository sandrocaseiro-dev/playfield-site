// Every release on this page comes from GitHub at build time.
//
// Nothing about a release is committed here — no version number, no changelog,
// no file list. The release itself is the record, so correcting a release on
// GitHub and rebuilding is the whole of correcting this site.

// process.env, not import.meta.env: this runs at build time in Node, and a
// variable exported by a workflow step never reaches import.meta.env — only
// what a .env file declares does. Reading the wrong one fails quietly, as an
// unauthenticated request that works locally and rate-limits in CI.
const REPO = process.env.RELEASES_REPO ?? "sandrocaseiro-dev/playfield-site";
const TOKEN = process.env.GITHUB_TOKEN;

export type AssetKind = "installer" | "msi" | "appimage" | "deb" | "checksums" | "other";
export type Platform = "windows" | "linux";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  kind: AssetKind;
  platform: Platform | null;
}

export interface Release {
  version: string;
  tag: string;
  headline: string;
  body: string;
  date: string;
  prerelease: boolean;
  url: string;
  assets: ReleaseAsset[];
}

function kindOf(name: string): AssetKind {
  if (name.endsWith("-setup.exe")) return "installer";
  if (name.endsWith(".msi")) return "msi";
  if (name.endsWith(".AppImage")) return "appimage";
  if (name.endsWith(".deb")) return "deb";
  if (name.startsWith("SHA256SUMS")) return "checksums";
  return "other";
}

// The checksums file covers both platforms at once, so it belongs to neither.
const PLATFORM_OF: Record<AssetKind, Platform | null> = {
  installer: "windows",
  msi: "windows",
  appimage: "linux",
  deb: "linux",
  checksums: null,
  other: null,
};

// The pipeline titles a public release "Playfield 0.2.0 — one sentence". The
// sentence is the only part worth showing; the version has its own heading.
function headlineOf(title: string): string {
  const dash = title.indexOf("—");
  return dash === -1 ? "" : title.slice(dash + 1).trim();
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  // A checksums file is a few hundred bytes, and rounding it to whole megabytes
  // printed "0 MB" beside it on every release the site has ever drawn.
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${Math.round(mb)} MB`;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

let cache: Release[] | null = null;

export async function getReleases(): Promise<Release[]> {
  if (cache) return cache;

  // A failure here is not a build failure. The site has to go up before the
  // first release exists, and it has to build on a machine with no network.
  let raw: any[] = [];
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    if (response.ok) raw = await response.json();
    else console.warn(`[releases] ${REPO} answered ${response.status} — building with no releases`);
  } catch (error) {
    console.warn(`[releases] could not reach GitHub (${error}) — building with no releases`);
  }

  cache = raw
    .filter((r) => !r.draft)
    .map((r): Release => {
      const version = String(r.tag_name ?? "").replace(/^v/, "");
      return {
        version,
        tag: r.tag_name,
        headline: headlineOf(r.name ?? ""),
        body: r.body ?? "",
        date: r.published_at ?? r.created_at ?? "",
        prerelease: Boolean(r.prerelease),
        url: r.html_url,
        assets: (r.assets ?? []).map((a: any): ReleaseAsset => {
          const kind = kindOf(a.name);
          return {
            name: a.name,
            url: a.browser_download_url,
            size: a.size,
            kind,
            platform: PLATFORM_OF[kind],
          };
        }),
      };
    });

  return cache;
}

// The newest thing a person should actually install: a pre-release is offered
// on the downloads page but never as *the* download.
export async function getLatest(): Promise<Release | null> {
  const releases = await getReleases();
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null;
}

// The one file to offer a person on this platform, in the order a person who
// has not chosen would want them: the installer over the MSI, the AppImage over
// the .deb — the AppImage runs on any distribution, and the .deb only runs on
// the ones that take one.
const PREFERRED: Record<Platform, AssetKind[]> = {
  windows: ["installer", "msi"],
  linux: ["appimage", "deb"],
};

export function pickInstaller(
  release: Release | null,
  platform: Platform = "windows",
): ReleaseAsset | null {
  if (!release) return null;
  for (const kind of PREFERRED[platform]) {
    const asset = release.assets.find((a) => a.kind === kind);
    if (asset) return asset;
  }
  return null;
}
