# playfield-site

The public face of [Playfield](https://github.com/sandrocaseiro-dev/playfield): the
website, and the releases people download.

**Nothing here is edited per release.** The app's private repository publishes a
release to *this* repository — the installers as assets, the readable changelog
as the body — and that release event rebuilds the site. The download buttons and
the changelog page are read from this repository's Releases through the GitHub
API at build time, so they are always whatever the releases currently say.

To correct a changelog, edit the release on GitHub. The site rebuilds itself.

A release's files are sorted onto the download page by their own names —
`-setup.exe`, `.msi`, `.AppImage`, `.deb`, `SHA256SUMS`. A package renamed
upstream lands under no platform and with no description until
`src/lib/releases.ts` is taught the new suffix.

## Running it

```
npm install
npm run dev      # localhost:4321/playfield-site/
npm run build    # into dist/
```

The build reaches GitHub for the release list. Without a network, or before the
first release exists, it builds anyway with an empty download page — that is
deliberate, because the site has to go up before there is anything to download.
In CI that licence is withdrawn: a build that cannot read the releases fails
rather than publish an empty download page over a full one.

`RELEASES_REPO` overrides which repository it reads, which is the only way to
see the changelog page populated before this one has releases of its own.

`EXPECT_RELEASE_TAG` is the tag this build has to find. GitHub answers its own
release list from a minute of cache, and a release event starts the workflow
seconds after the publish, so the list a release build reads is often the one
from before it — which is how 1.0.1 was published, built, and deployed green as
1.0.0. The workflow sets this to the tag that woke it; the build then re-reads
past the cache until the tag appears, and fails if it never does. Unset, as in
every local build and every push, the build takes the first answer it gets.

`PUBLIC_GA_MEASUREMENT_ID` is the Google Analytics 4 measurement ID (`G-…`).
It is only read in a production build, so `npm run dev` never reports, and a
build without it ships no analytics at all and still deploys. On GitHub it lives
as a repository *variable*, not a secret — the ID is public by nature, it is in
the page source of every visit.

## What is where

| | |
|---|---|
| `src/pages/` | The three pages — landing, download, changelog |
| `src/lib/releases.ts` | The GitHub read, and everything derived from a release |
| `src/styles/tokens.css` | The application's own tokens, copied, plus what a page needs |
| `src/assets/shots/` | Screenshots of the real screens, from the app's test suite |
| `.github/workflows/deploy.yml` | Builds and publishes to Pages on a push or a release |

The screenshots are of the seed library the app falls back to outside its own
shell — public catalogue artwork and invented playtimes, no account data.
