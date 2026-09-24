<div align="center">

# Hermes Desktop - Mac Intel | Bleeding Edge & Stable

**The [Hermes Agent](https://github.com/NousResearch/hermes-agent) desktop app, built for Intel-based Macs (`x86_64`). Two release tracks, automatic builds, native in-app updates.**

[![Upstream](https://img.shields.io/badge/upstream-NousResearch%2Fhermes--agent-111827?logo=github)](https://github.com/NousResearch/hermes-agent)
[![Platform](https://img.shields.io/badge/macOS-Intel%20x86__64-111827?logo=apple)](#downloads)
[![Tracks](https://img.shields.io/badge/tracks-bleeding%20edge%20%2B%20stable-f97316)](#update-tracks)
[![Latest release](https://img.shields.io/github/v/release/Anon-Nickname/Hermes-Desktop-Mac-Intel-Unofficial?display_name=tag&sort=semver)](../../releases/latest)

[Download bleeding edge](../../releases/latest) · [All releases](../../releases) · [Browse upstream](https://github.com/NousResearch/hermes-agent)

</div>

> [!WARNING]
> These are unofficial builds, not supported by Nous Research, and **not signed or notarized by Apple**. The bleeding-edge track builds upstream `main`, which may include unfinished changes or regressions. Use the stable track if you want tagged-release quality.

## Update tracks

This repository publishes two tracks of the same app. The **only** difference between them is what they are built from:

| | Bleeding edge | Stable |
|---|---|---|
| **Built from** | latest commit on upstream `main` | latest tagged upstream release (e.g. `v2026.9.14`) |
| **Checked for** | every 15 minutes | hourly |
| **Release tags** | `bleeding-edge-<sha>` | `stable-<version>` |
| **Upstream cadence** | many commits per day | roughly one tag per week |

The DMG you install decides the starting track: a bleeding-edge DMG starts on bleeding edge, a stable DMG starts on stable. You can switch at any time inside the app - see below.

## Downloads

Pick one track - you can change it later in the app:

| Track | Direct download (Intel DMG) | Release page |
|---|---|---|
| **Bleeding edge** - newest upstream `main` | **[⬇ Hermes-bleeding-edge-mac-x64.dmg](../../releases/latest/download/Hermes-bleeding-edge-mac-x64.dmg)** | [Latest release](../../releases/latest) (always carries the Latest badge) |
| **Stable** - newest tagged upstream release | **[⬇ Hermes-stable-v2026.9.14-mac-x64.dmg](../../releases/download/stable-v2026.9.24/Hermes-stable-mac-x64.dmg)** | [stable-v2026.9.14](../../releases/tag/stable-v2026.9.14) |

Both links download the `-mac-x64.dmg` for an Intel Mac directly - no hunting through asset lists. The bleeding-edge link is permanent: it always serves the newest bleeding-edge build. The stable link is updated automatically every time a new stable build is published.

Every release also offers a ZIP and a `SHA256SUMS.txt` checksum file, and names the exact upstream commit it was built from. The footer in the app shows your build's version and its commit distance from the track you follow.

> [!CAUTION]
> Review the upstream commit or tag and the checksums before installing. Because the app is unsigned and not notarized, macOS may block the first launch. Only install if you understand and accept the risks of an independent build.

## Switching tracks in the app

Open the update dialog (the update button in the app footer, or **Settings - About - Open updates**). A track picker at the top of the dialog - and in **Settings - About** itself - offers **Bleeding edge** and **Stable**:

- Switching re-checks updates against that track immediately.
- **Install** then downloads that track's latest build from this repository, so you can move between tracks in either direction without reinstalling.
- Your choice is remembered across restarts.

**Config-file fallback:** if the picker is ever unavailable, the track is stored in `~/Library/Application Support/Hermes/update-channel.json`:

```json
{ "channel": "stable" }
```

Valid values are `"bleeding-edge"` and `"stable"`. Quit the app, edit the file, and relaunch. If the file is missing, the app recreates it from the build's own track on first launch - it never overwrites a choice you made.

## In-app updater

The workflow injects an updater override into the Electron main process at build time ([`updater/`](updater)). For the active track it:

1. checks this repository's releases for the track's latest build;
2. downloads the Intel DMG only when it packages a different upstream SHA;
3. mounts it and replaces `/Applications/Hermes.app`;
4. removes the quarantine attribute;
5. detaches the image and relaunches Hermes.

The check itself compares build identity only: the running build's upstream commit (baked at build time) against the newest published build's upstream commit (recorded in its release notes). An update is offered exactly when the published build is newer - upstream's own main branch and tags are never consulted, so a fast-moving upstream can never produce a permanent false update offer, and the commit list shown for an available update is the upstream history between the two builds. If the running build's commit is unknown to upstream (rewritten history), the newest build is offered without a distance count.

Update checks use the unauthenticated GitHub API, which allows 60 requests per hour per IP. To stay well under that, each check costs two API calls and results are cached for ten minutes. If GitHub rate-limits a check, the dialog says so plainly and shows when to retry; if a previous check succeeded, the app keeps showing that result instead of an error.

The updater force-overwrites the app and removes quarantine for this independent unsigned release channel. It can fail if the current user cannot write to `/Applications`, Hermes is running from another location, or GitHub or the network is unavailable. Inspect the workflows before relying on it.

## How the pipeline works

Two workflows, one per track, sharing the same build steps:

- A lightweight check compares upstream (`main` HEAD or the latest tag) with the newest release here on that track. If nothing changed, the run exits without using a macOS runner.
- On change, an Intel runner builds DMG and ZIP artifacts from the exact upstream commit, verifies the `x86_64` architecture, stamps the canonical Hermes version into the app, records checksums, and publishes the release under the track's tag namespace.
- Builds never overlap. A five-minute cooldown holds the queue after each build.
- Only bleeding-edge releases are marked as GitHub's Latest release, so the downloads above never jump between tracks.

## Changes from the original Intel rebuild

This standalone repository builds on the Intel macOS groundwork in [evencj11/hermes-agent-desktop-intel-mac-rebuild](https://github.com/evencj11/hermes-agent-desktop-intel-mac-rebuild). Compared with that project, this one adds:

- two update tracks (bleeding-edge and stable) with in-app track switching;
- unattended upstream polling and release publication per track;
- skip-when-unchanged builds, no overlap, and a five-minute cooldown;
- a native updater pointed at this repository's releases;
- upstream commit distance in the client footer, relative to the active track;
- automatic stamping of the canonical Hermes version into packaged apps;
- artifact architecture checks and release checksums.

The automation lives in [`.github/workflows/`](.github/workflows) and [`updater/`](updater).

## Credits and license

Hermes Agent is developed by [NousResearch](https://github.com/NousResearch/hermes-agent). Intel macOS rebuild groundwork by [evencj11](https://github.com/evencj11/hermes-agent-desktop-intel-mac-rebuild).

The workflows and documentation in this repository are available under the [MIT License](LICENSE). Upstream Hermes Agent remains subject to its own license. This repository is not affiliated with or endorsed by Nous Research.
<!-- Updater behavior documented above reflects release-identity checking. -->
