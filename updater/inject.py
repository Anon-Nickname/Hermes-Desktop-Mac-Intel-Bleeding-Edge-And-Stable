#!/usr/bin/env python3
"""Inject the Intel updater override into the checked-out upstream tree.

Reads pipeline/updater/update-override.ts, substitutes the build's release
repository, upstream commit and baked default channel, writes it into the
Electron main process sources and registers it from the actual bundler
entrypoint: entry.ts on older tagged releases, main.ts on current upstream.
Fails closed if the bundler entry is unknown rather than shipping dead code.
"""
import os
import sys
from pathlib import Path

workspace = Path(os.environ.get('GITHUB_WORKSPACE', '.'))
template = (workspace / 'pipeline/updater/update-override.ts').read_text()

replacements = {
    '__RELEASE_REPO__': os.environ['RELEASE_REPO'],
    '__CURRENT_SHA__': os.environ['UPSTREAM_SHA'],
    '__DEFAULT_CHANNEL__': os.environ['TRACK'],
}
if replacements['__DEFAULT_CHANNEL__'] not in ('bleeding-edge', 'stable'):
    sys.exit(f"TRACK must be 'bleeding-edge' or 'stable', got {replacements['__DEFAULT_CHANNEL__']!r}")

for placeholder, value in replacements.items():
    if template.count(placeholder) != 1:
        sys.exit(f'Placeholder {placeholder} expected exactly once in template ({template.count(placeholder)}x)')
    template = template.replace(placeholder, value, 1)

target = workspace / 'apps/desktop/electron/bleeding-edge-updater.ts'
target.write_text(template)

# Select the entry actually used by this upstream revision's desktop builder.
# Older tagged releases bundle entry.ts; current main bundles main.ts directly.
bundler = workspace / 'apps/desktop/scripts/bundle-electron-main.mjs'
if not bundler.exists():
    sys.exit('Desktop Electron bundler missing; cannot verify the entrypoint')
bundler_text = bundler.read_text()
main_entry = "entryPoints: [join(source, 'apps/desktop/electron/main.ts')]"
legacy_entry = "const mainEntry = resolve(root, 'electron/entry.ts')"
if main_entry in bundler_text and legacy_entry not in bundler_text:
    via = 'main.ts'
elif legacy_entry in bundler_text and main_entry not in bundler_text:
    via = 'entry.ts'
else:
    sys.exit('Unknown or ambiguous Electron main entrypoint; refuse inert override')
entry = workspace / 'apps/desktop/electron' / via
if not entry.exists():
    sys.exit(f'Expected Electron entrypoint {via} missing')
text = entry.read_text()
if 'installBleedingEdgeUpdater' in text:
    sys.exit(f'{via} already references installBleedingEdgeUpdater')
if via == 'entry.ts':
    anchor = "  await import('./main')"
    if text.count(anchor) != 1:
        sys.exit(f'entry.ts anchor not unique/found ({text.count(anchor)}x)')
    text = text.replace(
        anchor,
        anchor
        + "\n  const { installBleedingEdgeUpdater } = await import('./bleeding-edge-updater')\n  installBleedingEdgeUpdater()",
        1,
    )
else:
    # Import hoists; invocation executes after main.ts's module-scope IPC
    # registrations and before app.whenReady callbacks run.
    text += (
        "\nimport { installBleedingEdgeUpdater } from './bleeding-edge-updater'\n"
        'installBleedingEdgeUpdater()\n'
    )
entry.write_text(text)

print(f"Injected updater override via {via} (release repo {replacements['__RELEASE_REPO__']}, default channel {replacements['__DEFAULT_CHANNEL__']})")
