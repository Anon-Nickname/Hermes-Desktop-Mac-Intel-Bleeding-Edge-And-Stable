import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'

/**
 * Independent update override for the unofficial Intel macOS builds.
 * Injected at build time; replaces the upstream git-pull updater with
 * GitHub-release updates served from this repository. Two tracks exist:
 * bleeding-edge (upstream main) and stable (upstream tagged releases).
 * The only build-time difference between tracks is the baked default
 * channel below; the active channel is a user setting and can always be
 * changed in the app's update dialog.
 *
 * updater/inject.py substitutes the __PLACEHOLDER__ values during the build.
 */

const execFileAsync = promisify(execFile)

const channels = ['bleeding-edge', 'stable'] as const
type UpdateChannel = (typeof channels)[number]

const releaseRepo = '__RELEASE_REPO__'
const currentSha = '__CURRENT_SHA__'
const defaultChannel: UpdateChannel = '__DEFAULT_CHANNEL__' as UpdateChannel

const githubHeaders = { Accept: 'application/vnd.github+json', 'User-Agent': 'Hermes-Intel-Updater' }

function channelConfigPath(): string {
  return path.join(app.getPath('userData'), 'update-channel.json')
}

async function writeChannel(channel: UpdateChannel): Promise<void> {
  const target = channelConfigPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ channel }, null, 2))
  await fs.rename(tmp, target)
}

// The active channel lives in update-channel.json. The file is seeded once
// from this build's baked default; after that it belongs to the user and is
// never overwritten by the app - only by the in-app track picker.
async function readChannel(): Promise<UpdateChannel> {
  try {
    const parsed = JSON.parse(await fs.readFile(channelConfigPath(), 'utf8'))
    if ((channels as readonly string[]).includes(parsed?.channel)) return parsed.channel as UpdateChannel
  } catch {}
  await writeChannel(defaultChannel)
  return defaultChannel
}

async function githubJson(apiPath: string) {
  const response = await fetch('https://api.github.com/' + apiPath, { headers: githubHeaders })
  if (!response.ok) throw new Error('GitHub API request failed: ' + response.status)
  return response.json()
}

// Latest own release on the given track. /releases/latest only ever names one
// release, so both tracks filter the release list by tag prefix instead.
async function latestOwnRelease(channel: UpdateChannel) {
  const releases = await githubJson('repos/' + releaseRepo + '/releases?per_page=50')
  if (!Array.isArray(releases)) throw new Error('Unexpected releases response')
  const match = releases.find(
    (release: any) =>
      !release?.draft &&
      !release?.prerelease &&
      typeof release?.tag_name === 'string' &&
      release.tag_name.startsWith(channel + '-')
  )
  if (!match) throw new Error('No ' + channel + ' build has been published yet')
  return match
}

function releaseSha(release: any): string | null {
  return /^Upstream-SHA: ([0-9a-f]{40})$/m.exec(release.body || '')?.[1] ?? null
}

// Latest upstream tagged release, peeled to its commit. Upstream tags are
// annotated tag objects, so the ref must be peeled one level to the commit.
async function stableTarget(): Promise<{ ref: string; sha: string }> {
  const latest = await githubJson('repos/NousResearch/hermes-agent/releases/latest')
  const tag = typeof latest?.tag_name === 'string' ? latest.tag_name : null
  if (!tag) throw new Error('Official latest release returned no tag')
  const ref = await githubJson('repos/NousResearch/hermes-agent/git/refs/tags/' + tag)
  let sha = typeof ref?.object?.sha === 'string' ? ref.object.sha : null
  if (ref?.object?.type === 'tag' && sha) {
    const peeled = await githubJson('repos/NousResearch/hermes-agent/git/tags/' + sha)
    sha = typeof peeled?.object?.sha === 'string' ? peeled.object.sha : sha
  }
  if (!sha) throw new Error('Official release tag ' + tag + ' returned no commit SHA')
  return { ref: tag, sha }
}

async function upstreamStatus(channel: UpdateChannel) {
  let targetSha: string
  let compareRef: string
  if (channel === 'stable') {
    const target = await stableTarget()
    targetSha = target.sha
    compareRef = target.ref
  } else {
    const latest = await githubJson('repos/NousResearch/hermes-agent/commits/main')
    if (typeof latest?.sha !== 'string') throw new Error('Official main returned no commit SHA')
    targetSha = latest.sha
    compareRef = 'main'
  }
  if (targetSha === currentSha) return { targetSha, behind: 0, commits: [] }

  try {
    const compared = await githubJson('repos/NousResearch/hermes-agent/compare/' + currentSha + '...' + compareRef)
    const behind = Number.isInteger(compared?.ahead_by) && compared.ahead_by >= 0 ? compared.ahead_by : null
    const commits = Array.isArray(compared?.commits)
      ? compared.commits.slice().reverse().map((entry: any) => ({
          sha: entry.sha,
          summary: String(entry.commit?.message || '').split('\n')[0],
          author: String(entry.commit?.author?.name || ''),
          at: Date.parse(entry.commit?.committer?.date || '') || 0
        }))
      : []
    return { targetSha, behind, commits }
  } catch {
    return { targetSha, behind: null, commits: [] }
  }
}

export function installBleedingEdgeUpdater(): void {
  for (const channel of [
    'hermes:updates:check',
    'hermes:updates:apply',
    'hermes:updates:branch:get',
    'hermes:updates:branch:set'
  ]) {
    try {
      ipcMain.removeHandler(channel)
    } catch {}
  }

  ipcMain.handle('hermes:updates:check', async () => {
    const channel = await readChannel()
    try {
      const upstream = await upstreamStatus(channel)
      return {
        supported: true,
        branch: channel,
        currentSha,
        targetSha: upstream.targetSha,
        behind: upstream.behind,
        commits: upstream.commits,
        updateAvailable: upstream.targetSha !== currentSha,
        fetchedAt: Date.now()
      }
    } catch (error) {
      return {
        supported: true,
        branch: channel,
        currentSha,
        error: 'check-failed',
        message: error instanceof Error ? error.message : String(error),
        fetchedAt: Date.now()
      }
    }
  })

  ipcMain.handle('hermes:updates:apply', async () => {
    const channel = await readChannel()
    const release = await latestOwnRelease(channel)
    const installableSha = releaseSha(release)
    if (!installableSha || installableSha === currentSha) {
      throw new Error('No newer Intel ' + channel + ' build is available yet')
    }
    const asset = release.assets?.find((item: any) => item.name.endsWith('-mac-x64.dmg'))
    if (!asset?.browser_download_url) throw new Error('Latest ' + channel + ' release has no Intel macOS DMG')
    const script = `set -euo pipefail
DMG_URL="$1"
TMP_DMG="/tmp/Hermes-intel-update.dmg"
MOUNT_POINT="$(mktemp -d /tmp/hermes-intel-mount.XXXXXX)"
curl -fL "$DMG_URL" -o "$TMP_DMG"
hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT_POINT" -nobrowse
trap 'hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true' EXIT
rm -rf /Applications/Hermes.app
cp -R "$MOUNT_POINT/Hermes.app" /Applications/Hermes.app
xattr -dr com.apple.quarantine /Applications/Hermes.app
hdiutil detach "$MOUNT_POINT"
trap - EXIT`
    await execFileAsync('/bin/bash', ['-c', script, 'hermes-intel-updater', asset.browser_download_url])
    app.relaunch()
    app.quit()
    return { ok: true }
  })

  // Upstream already exposes this branch bridge to the renderer; here it
  // carries the update track instead of a git branch.
  ipcMain.handle('hermes:updates:branch:get', async () => ({ branch: await readChannel() }))

  ipcMain.handle('hermes:updates:branch:set', async (_event, name) => {
    const channel: UpdateChannel = (channels as readonly string[]).includes(name) ? (name as UpdateChannel) : defaultChannel
    await writeChannel(channel)
    return { branch: channel }
  })
}
