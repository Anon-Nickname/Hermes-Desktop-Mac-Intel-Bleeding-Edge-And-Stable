#!/usr/bin/env python3
"""Patch the upstream About settings page with a permanent update entry point.

Upstream's About page only renders "Update now" / "See what's new" while an
update is available, so an up-to-date install has no path from About to the
updates window - the track picker lives in that window's idle view or behind
the status-bar client tab. This patch adds an always-visible "Open updates"
button and embeds the same bleeding-edge/stable track picker in the About
updates card, wired to the existing branch bridge (updates.getBranch /
setBranch), which the injected override re-registers to carry the track.

Strict single-match anchors, same convention as patch-updates-overlay.py:
if upstream changes about-settings.tsx so an anchor is missing or ambiguous,
the build fails loudly here instead of shipping an About page without the
entry point.
"""
import os
import sys
from pathlib import Path

workspace = Path(os.environ.get('GITHUB_WORKSPACE', '.'))
target = workspace / 'apps/desktop/src/app/settings/about-settings.tsx'
text = target.read_text()


def replace_once(anchor: str, replacement: str) -> None:
    global text
    count = text.count(anchor)
    if count != 1:
        sys.exit(f'about-settings.tsx anchor missing or ambiguous ({count}x): {anchor[:70]!r}')
    text = text.replace(anchor, replacement, 1)


picker_component = '''function UpdateChannelPicker({
  channel,
  disabled,
  onSwitch
}: {
  channel: 'bleeding-edge' | 'stable'
  disabled: boolean
  onSwitch: (next: 'bleeding-edge' | 'stable') => void
}) {
  return (
    <div className="flex items-center justify-center gap-1 rounded-lg bg-muted p-1">
      {(['bleeding-edge', 'stable'] as const).map(option => (
        <button
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            option === channel
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          disabled={disabled}
          key={option}
          onClick={() => onSwitch(option)}
          type="button"
        >
          {option === 'stable' ? 'Stable' : 'Bleeding edge'}
        </button>
      ))}
    </div>
  )
}

'''

# 1. Define the picker component above AboutSettings.
replace_once(
    'export function AboutSettings({ subpage }: AboutSettingsProps = {}) {',
    picker_component + 'export function AboutSettings({ subpage }: AboutSettingsProps = {}) {',
)

# 2. Track the active channel in AboutSettings and re-check after a switch.
channel_state = '''
  const [updateChannel, setUpdateChannel] = useState<'bleeding-edge' | 'stable'>('bleeding-edge')
  useEffect(() => {
    let live = true
    void window.hermesDesktop?.updates
      ?.getBranch?.()
      .then(result => {
        if (live && (result?.branch === 'stable' || result?.branch === 'bleeding-edge')) {
          setUpdateChannel(result.branch)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const handleChannelSwitch = (next: 'bleeding-edge' | 'stable') => {
    if (next === updateChannel) {
      return
    }
    setUpdateChannel(next)
    void window.hermesDesktop?.updates
      ?.setBranch?.(next)
      .then(() => checkUpdates({ force: true }))
      .catch(() => {})
  }
'''

replace_once(
    '  const [justChecked, setJustChecked] = useState(false)',
    '  const [justChecked, setJustChecked] = useState(false)\n' + channel_state,
)

# 3. Always offer a path to the updates window next to "Check now" - not
#    only while an update is available.
replace_once(
    '              {checking ? a.checking : a.checkNow}\n            </Button>',
    '              {checking ? a.checking : a.checkNow}\n            </Button>\n\n'
    '            <Button onClick={() => openUpdatesWindow(\'client\')} size="sm" variant="textStrong">\n'
    '              Open updates\n'
    '            </Button>',
)

# 4. Render the picker at the bottom of the updates card.
replace_once(
    '                {a.releaseNotes}\n              </a>\n            </Button>\n          </div>',
    '                {a.releaseNotes}\n              </a>\n            </Button>\n\n'
    '            <div className="mt-3">\n'
    '              <UpdateChannelPicker channel={updateChannel} disabled={checking || applying} onSwitch={handleChannelSwitch} />\n'
    '            </div>\n'
    '          </div>',
)

# 5. Surface the informational upstream distance in the About track line.
replace_once(
    "          hint={a.branchCommit(status?.branch ?? 'unknown', status?.currentSha?.slice(0, 7) ?? 'unknown')}",
    "          hint={a.branchCommit(status?.branch ?? 'unknown', status?.currentSha?.slice(0, 7) ?? 'unknown') + ((status?.upstreamBehind ?? 0) > 0 ? ' - ' + status.upstreamBehind + ' commits behind upstream main' : '')}",
)

target.write_text(text)
print('Patched about-settings.tsx with update entry point and track picker')

# End-of-file marker: keep a trailing comment as the last line of this script.
