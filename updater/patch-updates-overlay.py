#!/usr/bin/env python3
"""Patch the upstream update dialog with a bleeding-edge/stable track picker.

Strict single-match anchors: if upstream changes updates-overlay.tsx so an
anchor is missing or ambiguous, the build fails loudly here instead of
shipping a dialog without the picker. The picker uses the branch bridge the
upstream preload already exposes (updates.getBranch/setBranch), which the
injected override re-registers to carry the update track.
"""
import os
import sys
from pathlib import Path

workspace = Path(os.environ.get('GITHUB_WORKSPACE', '.'))
# Declare the override's informational upstreamBehind field on the status
# type (produced by the injected main-process override, consumed below and
# in the About patch). The build runs no typecheck, but keep tsc honest.
gd = workspace / 'apps/desktop/src/global.d.ts'
gd_text = gd.read_text()
old_anchor = """   *  literal number. */
  behind?: number | null
  currentSha?: string"""
new_anchor = """   *  literal number. */
  behind?: number | null
  currentSha?: string
  /** Intel builds, bleeding track only: informational distance of the running
   *  build to upstream main HEAD. A freshness signal, never an update offer. */
  upstreamBehind?: number | null"""
count = gd_text.count(old_anchor)
if count != 1:
    sys.exit(f'global.d.ts anchor missing or ambiguous ({count}x)')
gd.write_text(gd_text.replace(old_anchor, new_anchor, 1))

target = workspace / 'apps/desktop/src/app/updates-overlay.tsx'
text = target.read_text()


def replace_once(anchor: str, replacement: str) -> None:
    global text
    count = text.count(anchor)
    if count != 1:
        sys.exit(f'updates-overlay.tsx anchor missing or ambiguous ({count}x): {anchor[:70]!r}')
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

# 1. Define the picker component above IdleView.
replace_once('function IdleView({', picker_component + 'function IdleView({')

# 2. Track the active channel in UpdatesOverlay and re-check after a switch.
overlay_state = '''
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
      .then(() => check({ force: true }))
      .catch(() => {})
  }
'''

replace_once(
    '  const install = isBackend ? applyBackendUpdate : applyUpdates',
    '  const install = isBackend ? applyBackendUpdate : applyUpdates\n' + overlay_state,
)

# 3. Render the picker above the idle view (client updates only).
replace_once(
    "        {phase === 'idle' && (\n          <IdleView",
    "        {phase === 'idle' && (\n          <>\n            {!isBackend && (\n"
    '              <div className="px-6 pt-4">\n'
    '                <UpdateChannelPicker channel={updateChannel} disabled={checking} onSwitch={handleChannelSwitch} />\n'
    '                {(status?.upstreamBehind ?? 0) > 0 && (\n'
    '                  <p className="mt-1.5 text-center text-[0.625rem] text-muted-foreground">{status.upstreamBehind} commits behind upstream main</p>\n'
    '                )}\n'
    '              </div>\n'
    '            )}\n'
    '          <IdleView',
)
replace_once(
    '            updateAvailable={updateAvailable}\n          />\n        )}',
    '            updateAvailable={updateAvailable}\n          />\n          </>\n        )}',
)

target.write_text(text)
print('Patched updates-overlay.tsx with the update track picker')
