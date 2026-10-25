import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  filterVersions,
  getPackageReferenceVersion,
  resolveVersion,
  updateDocsVersion
} from '../src/validate-and-update-manifest.js'

const core = vi.hoisted(() => ({
  info: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn()
}))

vi.mock('@actions/core', () => core)

describe('getPackageReferenceVersion', () => {
  const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Jellyfin.Controller" Version="12.1.0" />
    <PackageReference Include="Jellyfin.Model" Version="12.2.0" />
  </ItemGroup>
</Project>`

  it('returns the referenced version of the package', () => {
    expect(getPackageReferenceVersion(csproj, 'Jellyfin.Model')).toBe('12.2.0')
  })

  it('returns a floating version as written', () => {
    const floating = csproj.replace('12.2.0', '10.11.*-*')

    expect(getPackageReferenceVersion(floating, 'Jellyfin.Model')).toBe(
      '10.11.*-*'
    )
  })

  it('accepts attributes in any order', () => {
    const reordered = csproj.replace(
      'Include="Jellyfin.Model" Version="12.2.0"',
      'Version="12.2.0" PrivateAssets="all" Include="Jellyfin.Model"'
    )

    expect(getPackageReferenceVersion(reordered, 'Jellyfin.Model')).toBe(
      '12.2.0'
    )
  })

  it('reads a <Version> child element', () => {
    const child = csproj.replace(
      '<PackageReference Include="Jellyfin.Model" Version="12.2.0" />',
      '<PackageReference Include="Jellyfin.Model">\n      <Version>12.2.0</Version>\n    </PackageReference>'
    )

    expect(getPackageReferenceVersion(child, 'Jellyfin.Model')).toBe('12.2.0')
  })

  it('ignores commented-out references', () => {
    const commented = csproj.replace(
      '<ItemGroup>',
      '<ItemGroup>\n    <!-- <PackageReference Include="Jellyfin.Model" Version="10.9.0" /> -->'
    )

    expect(getPackageReferenceVersion(commented, 'Jellyfin.Model')).toBe(
      '12.2.0'
    )
  })

  it('treats dots in the package name literally', () => {
    expect(() =>
      getPackageReferenceVersion(
        csproj.replace('Jellyfin.Model', 'JellyfinxModel'),
        'Jellyfin.Model'
      )
    ).toThrow('No PackageReference for Jellyfin.Model found in csproj')
  })

  it('throws when the package is not referenced', () => {
    expect(() => getPackageReferenceVersion(csproj, 'Newtonsoft.Json')).toThrow(
      'No PackageReference for Newtonsoft.Json found in csproj'
    )
  })
})

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
})

describe('resolveVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubNuget(versions: string[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => Response.json({ versions }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('strips a pre-release suffix without querying NuGet', async () => {
    const fetchMock = stubNuget([])

    expect(await resolveVersion('12.3.0-rc1', 'Jellyfin.Model')).toBe('12.3.0')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a floating version to the latest stable NuGet release', async () => {
    const fetchMock = stubNuget([
      '10.10.7',
      '10.11.0',
      '10.11.5',
      '10.11.6-rc1'
    ])

    expect(await resolveVersion('10.11.*-*', 'Jellyfin.Model')).toBe('10.11.5')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nuget.org/v3-flatcontainer/jellyfin.model/index.json'
    )
  })

  it('falls back to the .0 release when no stable release matches', async () => {
    stubNuget(['10.11.5', '10.12.0-rc1'])

    expect(await resolveVersion('10.12.*-*', 'Jellyfin.Model')).toBe('10.12.0')
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
  const csproj =
    '<Project>\n  <ItemGroup>\n    <PackageReference Include="Jellyfin.Model" Version="10.10.7" />\n  </ItemGroup>\n</Project>\n'

  let tmpDir: string
  let originalCwd: string
  let fetchMock: ReturnType<typeof vi.fn>

  function setEnv(overrides: Record<string, string | undefined> = {}): void {
    const env: Record<string, string | undefined> = {
      GITHUB_REPOSITORY: 'intro-skipper/intro-skipper',
      NEW_FILE_VERSION: '1.10.10.20',
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
    fs.mkdirSync('IntroSkipper')
    fs.writeFileSync('IntroSkipper/IntroSkipper.csproj', csproj)

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

  it('dispatches a manifest update and updates docs', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-02T03:04:05.678Z') })
    try {
      await runUpdateManifest()
    } finally {
      vi.useRealTimers()
    }

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setSecret).toHaveBeenCalledWith('secret-token')
    // The Jellyfin version comes from the csproj, never from NuGet.
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
        targetAbi: '10.10.7.0',
        sourceUrl:
          'https://github.com/intro-skipper/intro-skipper/releases/download/10.10/v1.10.10.20/intro-skipper-v1.10.10.20.zip',
        checksum: md5,
        timestamp: '2026-01-02T03:04:05Z'
      }
    })

    expect(fs.readFileSync('README.md', 'utf8')).toContain(
      'Jellyfin 10.10.7 (or newer)'
    )
    expect(
      fs.readFileSync('.github/ISSUE_TEMPLATE/bug_report_form.yml', 'utf8')
    ).toContain('Jellyfin 10.10.7 (or newer)')
  })

  it('uses the Jellyfin.Model version from the csproj, not MAIN_VERSION', async () => {
    // Jellyfin 12 bumps the minor version, so MAIN_VERSION (12.0) no longer
    // says which ABI the plugin was built against.
    setEnv({ MAIN_VERSION: '12.0' })
    fs.writeFileSync(
      'IntroSkipper/IntroSkipper.csproj',
      csproj.replace('10.10.7', '12.2.0')
    )

    await runUpdateManifest()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(dispatchPayload().client_payload.targetAbi).toBe('12.2.0.0')
    expect(fs.readFileSync('README.md', 'utf8')).toContain(
      'Jellyfin 12.2.0 (or newer)'
    )
  })

  it('resolves a floating 10.x reference against NuGet', async () => {
    setEnv({ MAIN_VERSION: '10.11' })
    fs.writeFileSync(
      'IntroSkipper/IntroSkipper.csproj',
      csproj.replace('10.10.7', '10.11.*-*')
    )
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.nuget.org')) {
        return Response.json({
          versions: ['10.10.7', '10.11.0', '10.11.5', '10.11.6-rc1']
        })
      }
      return new Response(null, { status: 204 })
    })

    await runUpdateManifest()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(dispatchPayload().client_payload.targetAbi).toBe('10.11.5.0')
    expect(fs.readFileSync('README.md', 'utf8')).toContain(
      'Jellyfin 10.11.5 (or newer)'
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
    const current = readme.replace('10.10.3', '10.10.7')
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
    ],
    [
      'IntroSkipper/IntroSkipper.csproj',
      './IntroSkipper/IntroSkipper.csproj file not found'
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

  it('fails when the csproj does not reference Jellyfin.Model', async () => {
    fs.writeFileSync('IntroSkipper/IntroSkipper.csproj', '<Project />\n')

    await runUpdateManifest()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Error updating manifest: No PackageReference for Jellyfin.Model found in csproj'
    )
    expect(dispatchPayloadCalls()).toBe(0)
  })

  function dispatchPayloadCalls(): number {
    return fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/dispatches')
    ).length
  }
})
