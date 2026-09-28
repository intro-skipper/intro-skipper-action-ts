import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  filterVersions,
  updateDocsVersion
} from '../src/validate-and-update-manifest.js'

const core = vi.hoisted(() => ({
  info: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn()
}))

vi.mock('@actions/core', () => core)

describe('filterVersions', () => {
  const versions = [
    '10.9.11',
    '10.10.0-rc1',
    '10.10.0',
    '10.10.3',
    '10.10.7',
    '10.11.0-rc1',
    '10.11.0'
  ]

  it('returns the last stable version matching the pattern', () => {
    expect(filterVersions(versions, '10.10.*')).toBe('10.10.7')
  })

  it('ignores pre-release versions', () => {
    expect(filterVersions(['10.11.0-rc1', '10.11.0-rc2'], '10.11.*')).toBe(
      undefined
    )
  })

  it('treats dots in the pattern literally', () => {
    expect(filterVersions(['10x10x1'], '10.10.*')).toBe(undefined)
  })

  it('anchors the pattern to the whole version', () => {
    expect(filterVersions(['110.10.1', '10.100.1'], '10.10.*')).toBe(undefined)
  })

  it('returns undefined when nothing matches', () => {
    expect(filterVersions(versions, '11.*')).toBe(undefined)
  })
})

describe('updateDocsVersion', () => {
  it('replaces the Jellyfin version', () => {
    const content = 'Requires Jellyfin 10.10.3 (or newer).'

    expect(updateDocsVersion(content, '10.10.7')).toEqual({
      updatedContent: 'Requires Jellyfin 10.10.7 (or newer).',
      wasUpdated: true
    })
  })

  it('reports no update when already current', () => {
    const content = 'Requires Jellyfin 10.10.7 (or newer).'

    expect(updateDocsVersion(content, '10.10.7')).toEqual({
      updatedContent: content,
      wasUpdated: false
    })
  })

  it('leaves content without a version marker unchanged', () => {
    const content = 'Nothing to see here.'

    expect(updateDocsVersion(content, '10.10.7').wasUpdated).toBe(false)
  })
})

describe('updateManifest', () => {
  const zipContent = 'fake zip content'
  const readme = '# Intro Skipper\n\nRequires Jellyfin 10.10.3 (or newer).\n'
  const bugReport =
    'description: Jellyfin 10.10.3 (or newer)\nbody:\n  - type: input\n'

  let tmpDir: string
  let originalCwd: string
  let fetchMock: ReturnType<typeof vi.fn>

  function setEnv(overrides: Record<string, string | undefined> = {}): void {
    const env: Record<string, string | undefined> = {
      GITHUB_REPOSITORY: 'intro-skipper/intro-skipper',
      NEW_FILE_VERSION: '1.10.10.20',
      IS_BETA: 'true',
      MAIN_VERSION: '10.10',
      GITHUB_PAT: 'secret-token',
      ...overrides
    }
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value)
    }
  }

  // The module reads its environment at import time, so load a fresh copy
  // after the environment has been set up.
  async function runUpdateManifest(): Promise<void> {
    vi.resetModules()
    const { updateManifest } =
      await import('../src/validate-and-update-manifest.js')
    await updateManifest()
  }

  function dispatchCall(): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/dispatches')
    )
    expect(call).toBeDefined()
    return { url: String(call![0]), init: call![1] as RequestInit }
  }

  function dispatchPayload(): {
    event_type: string
    client_payload: Record<string, string>
  } {
    return JSON.parse(dispatchCall().init.body as string)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    originalCwd = process.cwd()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-manifest-'))
    process.chdir(tmpDir)

    fs.writeFileSync('README.md', readme)
    fs.mkdirSync('.github/ISSUE_TEMPLATE', { recursive: true })
    fs.writeFileSync('.github/ISSUE_TEMPLATE/bug_report_form.yml', bugReport)
    fs.writeFileSync('intro-skipper-v1.10.10.20.zip', zipContent)

    fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    setEnv()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('dispatches a beta manifest update and updates docs', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-02T03:04:05.678Z') })
    try {
      await runUpdateManifest()
    } finally {
      vi.useRealTimers()
    }

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setSecret).toHaveBeenCalledWith('secret-token')
    // Beta releases never query NuGet.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const { url, init } = dispatchCall()
    expect(url).toBe(
      'https://api.github.com/repos/intro-skipper/manifest/dispatches'
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer secret-token'
    })

    const md5 = crypto.createHash('md5').update(zipContent).digest('hex')
    expect(dispatchPayload()).toEqual({
      event_type: 'update-manifest-node',
      client_payload: {
        pluginName: 'Intro Skipper',
        version: '1.10.10.20',
        changelog:
          '- See the full changelog at [GitHub](https://github.com/intro-skipper/intro-skipper/releases/tag/10.10/v1.10.10.20)\n',
        targetAbi: '10.10.0.0',
        sourceUrl:
          'https://github.com/intro-skipper/intro-skipper/releases/download/10.10/v1.10.10.20/intro-skipper-v1.10.10.20.zip',
        checksum: md5,
        timestamp: '2026-01-02T03:04:05Z'
      }
    })

    expect(fs.readFileSync('README.md', 'utf8')).toContain(
      'Jellyfin 10.10.0 (or newer)'
    )
    expect(
      fs.readFileSync('.github/ISSUE_TEMPLATE/bug_report_form.yml', 'utf8')
    ).toContain('Jellyfin 10.10.0 (or newer)')
  })

  it('uses the latest stable NuGet version for non-beta releases', async () => {
    setEnv({ IS_BETA: 'false' })
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.nuget.org')) {
        return Response.json({
          versions: ['10.9.11', '10.10.3', '10.10.7', '10.10.8-rc1', '10.11.0']
        })
      }
      return new Response(null, { status: 204 })
    })

    await runUpdateManifest()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nuget.org/v3-flatcontainer/jellyfin.model/index.json'
    )
    expect(dispatchPayload().client_payload.targetAbi).toBe('10.10.7.0')
    expect(fs.readFileSync('README.md', 'utf8')).toContain(
      'Jellyfin 10.10.7 (or newer)'
    )
  })

  it('dispatches to the test manifest for test repositories', async () => {
    setEnv({ GITHUB_REPOSITORY: 'intro-skipper/intro-skipper-test' })

    await runUpdateManifest()

    expect(dispatchCall().url).toBe(
      'https://api.github.com/repos/intro-skipper/manifest_test/dispatches'
    )
  })

  it('leaves docs untouched when already up to date', async () => {
    const current = readme.replace('10.10.3', '10.10.0')
    fs.writeFileSync('README.md', current)

    await runUpdateManifest()

    expect(fs.readFileSync('README.md', 'utf8')).toBe(current)
    expect(core.info).toHaveBeenCalledWith(
      './README.md has already newest Jellyfin version.'
    )
  })

  it.each([
    ['GITHUB_PAT', 'GITHUB_PAT environment variable is not set'],
    ['MAIN_VERSION', 'MAIN_VERSION environment variable is not set'],
    ['NEW_FILE_VERSION', 'NEW_FILE_VERSION environment variable is not set'],
    ['GITHUB_REPOSITORY', 'GITHUB_REPOSITORY environment variable is not set']
  ])('fails when %s is missing', async (name, message) => {
    setEnv({ [name]: undefined })

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['README.md', './README.md file not found'],
    [
      '.github/ISSUE_TEMPLATE/bug_report_form.yml',
      './.github/ISSUE_TEMPLATE/bug_report_form.yml file not found'
    ]
  ])('fails when %s is missing', async (file, message) => {
    fs.rmSync(file)

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the release zip is missing', async () => {
    fs.rmSync('intro-skipper-v1.10.10.20.zip')

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Error updating manifest: File intro-skipper-v1.10.10.20.zip not found'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails and leaves docs untouched when the dispatch fails', async () => {
    fetchMock.mockResolvedValue(
      new Response('Bad credentials', { status: 401 })
    )

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Error updating manifest: Failed to trigger dispatch event. Status: 401. Details: Bad credentials'
    )
    expect(fs.readFileSync('README.md', 'utf8')).toBe(readme)
  })

  it('fails when no NuGet version matches', async () => {
    setEnv({ IS_BETA: 'false' })
    fetchMock.mockResolvedValue(Response.json({ versions: ['10.9.11'] }))

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Error updating manifest: No versions of Jellyfin.Model match the pattern 10.10.*'
    )
    expect(dispatchPayloadCalls()).toBe(0)
  })

  it('fails when the NuGet request fails', async () => {
    setEnv({ IS_BETA: 'false' })
    fetchMock.mockResolvedValue(
      new Response(null, { status: 503, statusText: 'Service Unavailable' })
    )

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Error updating manifest: Error fetching package information for Jellyfin.Model: Failed to fetch package information: Service Unavailable'
    )
    expect(dispatchPayloadCalls()).toBe(0)
  })

  function dispatchPayloadCalls(): number {
    return fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/dispatches')
    ).length
  }
})
