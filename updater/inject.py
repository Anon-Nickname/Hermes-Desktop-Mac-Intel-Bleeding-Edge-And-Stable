#!/usr/bin/env python3
"""Inject the Intel updater override into the checked-out upstream tree.

Reads pipeline/updater/update-override.ts, substitutes the build's release
repository, upstream commit and baked default channel, writes it into the
Electron main process sources, and registers it from the bundle entry.
Current upstream main enters through entry.ts; older trees (tagged stable
releases before entry.ts existed) enter through main.ts directly - both
shapes are handled. Fails loudly if no known entry exists so a build never
ships a silently missing override.
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

entry = workspace / 'apps/desktop/electron/entry.ts'
main_ts = workspace / 'apps/desktop/electron/main.ts'
if entry.exists():
    text = entry.read_text()
    anchor = "  await import('./main')"
    if text.count(anchor) != 1:
        sys.exit(f'entry.ts anchor not unique/found: {anchor!r} ({text.count(anchor)}x)')
    text = text.replace(
        anchor,
        anchor
        + "\n  const { installBleedingEdgeUpdater } = await import('./bleeding-edge-updater')\n  installBleedingEdgeUpdater()",
        1,
    )
    entry.write_text(text)
    via = 'entry.ts'
elif main_ts.exists():
    text = main_ts.read_text()
    if 'installBleedingEdgeUpdater' in text:
        sys.exit('main.ts already references installBleedingEdgeUpdater')
    # Import declarations hoist; appending runs the installer after main.ts's
    # own module-scope handler registrations and before app.whenReady fires.
    text += (
        "\nimport { installBleedingEdgeUpdater } from './bleeding-edge-updater'\n"
        'installBleedingEdgeUpdater()\n'
    )
    main_ts.write_text(text)
    via = 'main.ts'
else:
    sys.exit('Neither entry.ts nor main.ts found under apps/desktop/electron')

print(f"Injected updater override via {via} (release repo {replacements['__RELEASE_REPO__']}, default channel {replacements['__DEFAULT_CHANNEL__']})")
