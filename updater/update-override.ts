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
 * Update decisions compare build identity only: the running build's baked
 * upstream commit against the newest PUBLISHED build on this track. Upstream
 * main and upstream tags are never consulted, so a fast-moving upstream can
 * never produce a permanent false "N commits behind" offer, and an update is
 * offered exactly when a newer build exists to install. The compare API
 * doubles as the changelog source: the commits between the two builds.
 *
 * All GitHub API calls are unauthenticated (60 requests/hour per IP), so
 * checks are kept to at most two calls, cached for ten minutes, and fall back
 * to the last successful check when the API is unavailable. A rate-limit 403
 * is reported to the dialog as what it is, with the reset time.
 *
 * updater/inject.py substitutes the __PLACEHOLDER__ values during the build.
 */

const execFileAsync = promisify(execFile)

const channels = ['bleeding-edge', 'stable'] as const
type UpdateChannel = (typeof channels)[number]

const releaseRepo = '__RELEASE_REPO__'
const currentSha = '__CURRENT_SHA__'
const defaultChannel: UpdateChannel = '__DEFAULT_CHANNEL__' as UpdateChannel

const CHECK_CACHE_TTL_MS = 10 * 60 * 1000

const githubHeaders = { Accept: 'application/vnd.github+json', 'User-Agent': 'Hermes-Intel-Updater' }

function userDataFile(name: string): string {
  return path.join(app.getPath('userData'), name)
}

async function writeJsonAtomic(name: string, value: unknown): Promise<void> {
  const target = userDataFile(name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2))
  await fs.rename(tmp, target)
}

async function readJson(name: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(userDataFile(name), 'utf8'))
  } catch {
    return null
  }
}

// The active channel lives in update-channel.json. The file is seeded once
// from this build's baked default; after that it belongs to the user and is
// never overwritten by the app - only by the in-app track picker.
async function readChannel(): Promise<UpdateChannel> {
  const parsed = await readJson('update-channel.json')
  if ((channels as readonly string[]).includes(parsed?.channel)) return parsed.channel as UpdateChannel
  await writeJsonAtomic('update-channel.json', { channel: defaultChannel })
  return defaultChannel
}

class GitHubRateLimitError extends Error {
  retryInMinutes: number | null
  constructor(retryInMinutes: number | null) {
    super(
      'GitHub API rate limit reached (unauthenticated requests are limited to 60/hour).' +
        (retryInMinutes ? ` Try again in about ${retryInMinutes} minute${retryInMinutes === 1 ? '' : 's'}.` : ' Try again later.')
    )
    this.retryInMinutes = retryInMinutes
  }
}

async function githubJson(apiPath: string) {
  const response = await fetch('https://api.github.com/' + apiPath, { headers: githubHeaders })
  if (!response.ok) {
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000
      const minutes = reset > Date.now() ? Math.max(1, Math.round((reset - Date.now()) / 60000)) : null
      throw new GitHubRateLimitError(minutes)
    }
    throw Object.assign(new Error('GitHub API request failed: ' + response.status), { httpStatus: response.status })
  }
  return response.json()
}

function releaseSha(release: any): string | null {
  return /^Upstream-SHA: ([0-9a-f]{40})$/m.exec(release.body || '')?.[1] ?? null
}

// Newest published own release on the given track. The release list comes
// back in creation order, not upstream-commit order (a recreated release
// scrambles it), so the newest published_at wins instead of the first list
// entry. Releases without a parseable Upstream-SHA predate the
// identity-in-notes convention and cannot be identity-compared, so they are
// ignored. /releases/latest is never used: the Latest badge is shared
// between both tracks and says nothing about either track's newest build.
async function latestOwnRelease(channel: UpdateChannel) {
  const releases = await githubJson('repos/' + releaseRepo + '/releases?per_page=50')
  if (!Array.isArray(releases)) throw new Error('Unexpected releases response')
  const candidates = releases.filter(
    (release: any) =>
      !release?.draft &&
      !release?.prerelease &&
      typeof release?.tag_name === 'string' &&
      release.tag_name.startsWith(channel + '-') &&
      typeof release?.published_at === 'string' &&
      releaseSha(release) !== null
  )
  if (candidates.length === 0) throw new Error('No ' + channel + ' build has been published yet')
  candidates.sort((a: any, b: any) => Date.parse(b.published_at) - Date.parse(a.published_at))
  return candidates[0]
}

// The update decision, one compare call at most. Every state of the running
// build relative to the newest published build is handled explicitly:
// - identical: nothing to offer.
// - ahead: the published build is newer - offer it, with the real distance
//   and the commits between the two builds as the changelog.
// - behind: the running build is newer than anything published yet (the
//   pipeline is still building the next one) - nothing to offer.
// - diverged or 404: upstream history no longer contains the running build's
//   commit (rewrite or shallow oddity), so ordering is unknowable - offer
//   the newest build to get back onto the track, with no invented count.
async function releaseStatus(channel: UpdateChannel) {
  const release = await latestOwnRelease(channel)
  const targetSha = releaseSha(release) as string
  const upToDate = { targetSha, behind: 0 as number | null, commits: [] as any[], updateAvailable: false }
  if (targetSha === currentSha) return upToDate

  let compared: any
  try {
    compared = await githubJson('repos/NousResearch/hermes-agent/compare/' + currentSha + '...' + targetSha)
  } catch (error) {
    if ((error as { httpStatus?: number })?.httpStatus === 404) {
      return { targetSha, behind: null, commits: [], updateAvailable: true }
    }
    throw error
  }

  const status = compared?.status
  if (status === 'identical') return upToDate
  if (status === 'behind') return upToDate
  if (status === 'ahead') {
    const behind = Number.isInteger(compared?.ahead_by) && compared.ahead_by >= 0 ? compared.ahead_by : null
    const commits = Array.isArray(compared?.commits)
      ? compared.commits.slice().reverse().map((entry: any) => ({
          sha: entry.sha,
          summary: String(entry.commit?.message || '').split('\n')[0],
          author: String(entry.commit?.author?.name || ''),
          at: Date.parse(entry.commit?.committer?.date || '') || 0
        }))
      : []
    return { targetSha, behind, commits, updateAvailable: true }
  }
  return { targetSha, behind: null, commits: [], updateAvailable: true }
}

async function readCheckCache(channel: UpdateChannel): Promise<any | null> {
  const cached = await readJson('update-check-cache.json')
  if (cached?.channel === channel && cached?.status?.fetchedAt) return cached
  return null
}

async function writeCheckCache(channel: UpdateChannel, status: unknown): Promise<void> {
  try {
    await writeJsonAtomic('update-check-cache.json', { channel, status })
  } catch {}
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

  ipcMain.handle('hermes:updates:check', async (_event, opts) => {
    const channel = await readChannel()
    const force = opts?.force === true
    const cached = await readCheckCache(channel)
    if (!force && cached && Date.now() - cached.status.fetchedAt < CHECK_CACHE_TTL_MS) {
      return cached.status
    }
    try {
      const release = await releaseStatus(channel)
      const status = {
        supported: true,
        branch: channel,
        currentSha,
        targetSha: release.targetSha,
        behind: release.behind,
        commits: release.commits,
        updateAvailable: release.updateAvailable,
        fetchedAt: Date.now()
      }
      await writeCheckCache(channel, status)
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (cached) {
        // API down or rate-limited: the last successful check is better than
        // a hard failure. Its fetchedAt stays honest about its age.
        return { ...cached.status, message: 'Live check failed (' + message + ') Showing the last successful check.' }
      }
      return {
        supported: true,
        branch: channel,
        currentSha,
        error: 'check-failed',
        message,
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
    await writeJsonAtomic('update-channel.json', { channel })
    return { branch: channel }
  })
}

// Injected at build time by updater/inject.py; do not edit the placeholders by hand.
