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

// The tag whose release woke this build, when a release is what woke it.
//
// GitHub answers the release list with a minute of cache (`s-maxage=60`), and a
// release event starts this workflow within seconds of the publish. The first
// read therefore lands, routinely, on the snapshot taken before the release was
// published — the tag missing from the list, or still sitting in it as a draft.
// A build that accepts that answer renders the release before it, deploys it
// green, and leaves nothing behind to say the site is a release out of date.
// That is exactly how 1.0.1 was published and never reached the page. So when
// the workflow knows which tag has to be there, the build waits for it.
const EXPECT_TAG = process.env.EXPECT_RELEASE_TAG || null;

// How long to wait for that: long enough to outlast the cached minute.
const ATTEMPTS = EXPECT_TAG ? 8 : 1;
const RETRY_MS = 12_000;

// Not reaching GitHub is survivable on a laptop and not in CI. Locally it is a
// build without a network; in CI it is a download page with no downloads on it,
// published over the one that had them.
const IN_CI = process.env.CI === "true";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AssetKind = "installer" | "msi" | "appimage" | "deb" | "checksums" | "other";

// Two things are released here: Playfield itself, tagged vX.Y.Z, and its Decky
// plugin, tagged decky-vX.Y.Z by the plugin's own pipeline. The version lines
// are unrelated, so the prefix is what tells them apart — and a plugin release
// is never the Playfield a person downloads.
export type Product = "app" | "decky";
const DECKY_TAG = "decky-";
export type Platform = "windows" | "linux";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  kind: AssetKind;
  platform: Platform | null;
}

export interface Release {
  product: Product;
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

function listed(raw: any[], tag: string): boolean {
  return raw.some((r) => r.tag_name === tag && !r.draft);
}

async function fetchReleases(): Promise<any[] | null> {
  // The timestamp is nothing the API reads. It is here so that two builds a
  // few seconds apart cannot be answered from the same cached minute, which is
  // the whole reason a fresh release goes missing.
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=50&_=${Date.now()}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "Cache-Control": "no-cache",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    if (response.ok) return await response.json();
    console.warn(`[releases] ${REPO} answered ${response.status}`);
  } catch (error) {
    console.warn(`[releases] could not reach GitHub (${error})`);
  }
  return null;
}

export async function getReleases(): Promise<Release[]> {
  if (cache) return cache;

  let raw: any[] | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const answer = await fetchReleases();
    if (answer) {
      raw = answer;
      if (!EXPECT_TAG || listed(answer, EXPECT_TAG)) break;
      console.warn(
        `[releases] ${EXPECT_TAG} is published but not in the list yet ` +
          `(attempt ${attempt}/${ATTEMPTS})`,
      );
    }
    if (attempt < ATTEMPTS) {
      console.warn(`[releases] waiting ${RETRY_MS / 1000}s out of GitHub's cache`);
      await sleep(RETRY_MS);
    }
  }

  // An empty list is a fine answer: the site has to go up before the first
  // release exists. No answer at all is not, and neither is an answer missing
  // the release this build was woken for — both would quietly publish a site
  // that is wrong about what you can download, so they stop the build instead.
  if (!raw && IN_CI) {
    throw new Error(
      `[releases] could not read ${REPO}'s releases after ${ATTEMPTS} attempt(s) — ` +
        `refusing to publish a site with no downloads on it`,
    );
  }
  if (EXPECT_TAG && !listed(raw ?? [], EXPECT_TAG)) {
    throw new Error(
      `[releases] ${EXPECT_TAG} was published, but GitHub's release list still does ` +
        `not show it ${ATTEMPTS} attempts later — refusing to publish a site that ` +
        `would not mention it`,
    );
  }

  cache = (raw ?? [])
    .filter((r) => !r.draft)
    .map((r): Release => {
      const tag = String(r.tag_name ?? "");
      const product: Product = tag.startsWith(DECKY_TAG) ? "decky" : "app";
      const version = tag.slice(product === "decky" ? DECKY_TAG.length : 0).replace(/^v/, "");
      return {
        product,
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

// Playfield's own releases, without the Decky plugin's.
export async function getAppReleases(): Promise<Release[]> {
  return (await getReleases()).filter((r) => r.product === "app");
}

// The newest Playfield a person should actually install: a pre-release is
// offered on the downloads page but never as *the* download, and a Decky plugin
// release never is.
export async function getLatest(): Promise<Release | null> {
  const releases = await getAppReleases();
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null;
}

// The newest Decky plugin to offer, on the same terms: a pre-release only when
// there is nothing else.
export async function getLatestDecky(): Promise<Release | null> {
  const releases = (await getReleases()).filter((r) => r.product === "decky");
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null;
}

// The plugin ships as one zip beside its checksums.
export function pickPluginZip(release: Release | null): ReleaseAsset | null {
  return release?.assets.find((a) => a.name.endsWith(".zip")) ?? null;
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
