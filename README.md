<div align="center">

# Hermes Desktop for Intel Mac

**Bleeding-edge `x86_64` builds of [NousResearch/Hermes Agent](https://github.com/NousResearch/hermes-agent), packaged automatically for Intel-based Macs.**

[![Upstream](https://img.shields.io/badge/upstream-NousResearch%2Fhermes--agent-111827?logo=github)](https://github.com/NousResearch/hermes-agent)
[![Platform](https://img.shields.io/badge/macOS-Intel%20x86__64-111827?logo=apple)](#downloads)
[![Channel](https://img.shields.io/badge/channel-bleeding%20edge-f97316)](#before-you-install)
[![Latest release](https://img.shields.io/github/v/release/Anon-Nickname/hermes-intel-bleeding-edge?display_name=tag&sort=semver)](https://github.com/Anon-Nickname/hermes-intel-bleeding-edge/releases/latest)

[Download latest build](https://github.com/Anon-Nickname/hermes-intel-bleeding-edge/releases/latest) · [View build workflow](https://github.com/Anon-Nickname/hermes-intel-bleeding-edge/actions/workflows/build-intel-macos-release.yml) · [Browse upstream](https://github.com/NousResearch/hermes-agent)

</div>

> [!WARNING]
> These are unofficial development builds from upstream `main`. They may include unfinished changes or regressions, are not supported by Nous Research, and are **not signed or notarized by Apple**.

## What this repository does

Every 15 minutes, the workflow checks the latest commit on `NousResearch/hermes-agent:main`.

- If that upstream commit already has a release here, the run exits without using a macOS runner.
- If it is new, the workflow builds Intel macOS DMG and ZIP artifacts, verifies their `x86_64` architecture, records checksums, and publishes a release tied to the exact upstream commit.
- Builds never overlap. A five-minute cooldown holds the queue after each build before the next check proceeds.

| | |
|---|---|
| **Upstream** | `NousResearch/hermes-agent:main` |
| **Target** | Intel macOS (`x86_64`) |
| **Artifacts** | DMG, ZIP, SHA-256 checksums |
| **Schedule** | Every 15 minutes; build only on change |
| **Release channel** | Unofficial bleeding edge |

## Downloads

Get the current build from [**Latest release**](https://github.com/Anon-Nickname/hermes-intel-bleeding-edge/releases/latest). Each release identifies the exact upstream commit and includes SHA-256 checksums.

> [!CAUTION]
> Review the upstream commit and checksums before installing. Because the app is unsigned and not notarized, macOS may block the first launch. Only install it if you understand and accept the risks of an independent bleeding-edge build.

## In-app updater

The workflow injects an updater override into the Electron main process at build time. The client footer shows the packaged Hermes version and its commit distance from official upstream `main`. The native update action:

1. checks this repository's latest release;
2. downloads the Intel DMG only when a newer packaged upstream SHA exists;
3. mounts it and replaces `/Applications/Hermes.app`;
4. removes the quarantine attribute;
5. detaches the image and relaunches Hermes.

The updater force-overwrites the app and removes quarantine for this independent unsigned release channel. It can fail if the current user cannot write to `/Applications`, Hermes is running from another location, or GitHub or the network is unavailable. Inspect the workflow before relying on it.

## Changes from the original Intel rebuild

This standalone repository builds on the Intel macOS groundwork in [evencj11/hermes-agent-desktop-intel-mac-rebuild](https://github.com/evencj11/hermes-agent-desktop-intel-mac-rebuild). Compared with that project, this one adds:

- unattended upstream polling and release publication;
- skip-when-unchanged builds, no overlap, and a five-minute cooldown;
- a native updater pointed at this repository's releases;
- upstream-main commit distance in the client footer;
- automatic stamping of the canonical Hermes version into packaged apps;
- artifact architecture checks and release checksums.

The automation and updater injection live in [`.github/workflows/build-intel-macos-release.yml`](.github/workflows/build-intel-macos-release.yml).

## Credits and license

Hermes Agent is developed by [NousResearch](https://github.com/NousResearch/hermes-agent). Intel macOS rebuild groundwork by [evencj11](https://github.com/evencj11/hermes-agent-desktop-intel-mac-rebuild).

The workflow and documentation in this repository are available under the [MIT License](LICENSE). Upstream Hermes Agent remains subject to its own license. This repository is not affiliated with or endorsed by Nous Research.
