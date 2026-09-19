# Hermes Intel Bleeding Edge

Automated unofficial `x86_64` macOS builds of [NousResearch/Hermes Agent](https://github.com/NousResearch/hermes-agent) from upstream `main`.

> These builds may contain unfinished changes or regressions. They are not supported by Nous Research and are not signed or notarized by Apple.

## Download

Download the latest DMG from [Releases](https://github.com/Anon-Nickname/hermes-intel-bleeding-edge/releases/latest).

Each release includes:

- an Intel macOS DMG and ZIP
- SHA-256 checksums
- the exact upstream commit SHA

## How it works

The workflow checks upstream every 15 minutes. It builds only when `NousResearch/hermes-agent:main` has moved, never overlaps builds, and waits five minutes after a build before the next queued check. Releases are built from the exact upstream commit and verified as `x86_64` before publication.

The packaged desktop version is stamped from upstream `hermes_cli/__init__.py`, so the client footer tracks the real Hermes version. The footer's `+N` count compares the packaged upstream SHA with official Hermes `main`. Installable updates still come only from this repository's Intel releases.

## Changes from the original Intel rebuild

This project began from the Intel macOS rebuild work by [evencj11](https://github.com/evencj11/hermes-agent-desktop-intel-mac-rebuild). Compared with that repository, this one adds:

- unattended upstream polling and release publication
- skip-when-unchanged builds, no overlap, and a five-minute cooldown
- a native updater pointed at this repository's releases
- upstream-main commit distance in the client footer
- automatic stamping of the canonical Hermes version into packaged apps
- artifact architecture checks and release checksums

## Credits

Hermes Agent is developed by [NousResearch](https://github.com/NousResearch/hermes-agent). Intel macOS rebuild groundwork by [evencj11](https://github.com/evencj11/hermes-agent-desktop-intel-mac-rebuild).

## License

This repository's workflow and documentation are provided under the MIT License. Upstream Hermes Agent remains subject to its own license.
