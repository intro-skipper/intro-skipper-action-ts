import * as core from '@actions/core'

import crypto from 'crypto'
import fs from 'fs'

const repository = process.env.GITHUB_REPOSITORY
const version = process.env.NEW_FILE_VERSION
const isBeta = process.env.IS_BETA
const mainVersion = process.env.MAIN_VERSION
const token = process.env.GITHUB_PAT

if (token) {
  // Ensure the token is masked in any log output produced by the Actions runtime.
  core.setSecret(token)
}

type Nuget = {
  versions: string[]
}

const readmePath = './README.md'
const bugReportFormPath = './.github/ISSUE_TEMPLATE/bug_report_form.yml'

export async function updateManifest(): Promise<void> {
  if (!token) {
    core.setFailed('GITHUB_PAT environment variable is not set')
    return
  }
  if (!mainVersion) {
    core.setFailed('MAIN_VERSION environment variable is not set')
    return
  }
  if (!version) {
    core.setFailed('NEW_FILE_VERSION environment variable is not set')
    return
  }
  if (!repository) {
    core.setFailed('GITHUB_REPOSITORY environment variable is not set')
    return
  }
  if (!fs.existsSync(readmePath)) {
    core.setFailed(`${readmePath} file not found`)
    return
  }
  if (!fs.existsSync(bugReportFormPath)) {
    core.setFailed(`${bugReportFormPath} file not found`)
    return
  }

  try {
    let currentVersion: string
    if (isBeta === 'false') {
      currentVersion = await getNugetPackageVersion(
        'Jellyfin.Model',
        `${mainVersion}.*`
      )
    } else {
      currentVersion = `${mainVersion}.0`
    }
    const targetAbi = `${currentVersion}.0`
    const client_payload = {
      pluginName: 'Intro Skipper',
      version,
      changelog: `- See the full changelog at [GitHub](https://github.com/${repository}/releases/tag/${mainVersion}/v${version})\n`,
      targetAbi,
      sourceUrl: `https://github.com/${repository}/releases/download/${mainVersion}/v${version}/intro-skipper-v${version}.zip`,
      checksum: getMD5FromFile(`intro-skipper-v${version}.zip`),
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    const payload = {
      event_type: 'update-manifest-node',
      client_payload
    }

    let apiUrl: string

    if (repository.includes('test')) {
      apiUrl = `https://api.github.com/repos/intro-skipper/manifest_test/dispatches`
    } else {
      apiUrl = `https://api.github.com/repos/intro-skipper/manifest/dispatches`
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json', // Or application/vnd.github+json
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Failed to trigger dispatch event. Status: ${response.status}. Details: ${errorText}`
      )
    }

    // response.ok is true if status is 200-299
    core.info(
      `Successfully triggered dispatch event 'update-manifest'. Status: ${response.status}`
    )
    if (response.status === 204) {
      core.info('No content returned, which is expected for dispatches.')
    } else {
      const responseData = await response.text() // Or response.json() if expecting JSON
      core.info(`Response data: ${responseData}`)
    }

    const readmeContent = fs.readFileSync(readmePath, 'utf8')
    const { updatedContent: updatedReadme, wasUpdated: readmeWasUpdated } =
      updateDocsVersion(readmeContent, currentVersion)
    if (readmeWasUpdated) {
      fs.writeFileSync(readmePath, updatedReadme)
      core.info(`Updated ${readmePath} with new Jellyfin version.`)
    } else {
      core.info(`${readmePath} has already newest Jellyfin version.`)
    }

    const bugReportFormContent = fs.readFileSync(bugReportFormPath, 'utf8')
    const {
      updatedContent: updatedBugReport,
      wasUpdated: bugReportWasUpdated
    } = updateDocsVersion(bugReportFormContent, currentVersion)
    if (bugReportWasUpdated) {
      fs.writeFileSync(bugReportFormPath, updatedBugReport)
      core.info(`Updated ${bugReportFormPath} with new Jellyfin version.`)
    } else {
      core.info(`${bugReportFormPath} has already newest Jellyfin version.`)
    }

    core.info('All operations completed successfully.')
  } catch (error) {
    core.setFailed(
      `Error updating manifest: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function getMD5FromFile(file: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(`File ${file} not found`)
  }
  const fileBuffer = fs.readFileSync(file)
  return crypto.createHash('md5').update(fileBuffer).digest('hex')
}

export function updateDocsVersion(
  content: string,
  currentVersion: string
): { updatedContent: string; wasUpdated: boolean } {
  const updatedContent = content.replace(
    /Jellyfin.*\(or newer\)/,
    `Jellyfin ${currentVersion} (or newer)`
  )
  const wasUpdated = content !== updatedContent
  return { updatedContent, wasUpdated }
}

async function fetchNugetPackageVersions(
  packageName: string
): Promise<string[]> {
  const url = `https://api.nuget.org/v3-flatcontainer/${packageName.toLowerCase()}/index.json`

  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(
        `Failed to fetch package information: ${response.statusText}`
      )
    }

    const data = (await response.json()) as Nuget
    return data.versions
  } catch (error) {
    throw new Error(
      `Error fetching package information for ${packageName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    )
  }
}

/**
 * Returns the latest stable version matching `versionPattern`, where `*`
 * acts as a wildcard (e.g. `10.11.*`). Pre-release versions (containing a
 * `-`) are ignored. Relies on NuGet returning versions in ascending order.
 */
export function filterVersions(
  versions: string[],
  versionPattern: string
): string | undefined {
  const escaped = versionPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  const versionRegex = new RegExp(`^${escaped}$`)
  const matchingVersions = versions.filter(
    (v) => !v.includes('-') && versionRegex.test(v)
  )

  if (matchingVersions.length > 0) {
    return matchingVersions[matchingVersions.length - 1]
  }
  return undefined
}

async function getNugetPackageVersion(
  packageName: string,
  versionPattern: string
): Promise<string> {
  const versions = await fetchNugetPackageVersions(packageName)
  const latestVersion = filterVersions(versions, versionPattern)

  if (!latestVersion) {
    throw new Error(
      `No versions of ${packageName} match the pattern ${versionPattern}`
    )
  }
  core.info(
    `Latest version of ${packageName} matching ${versionPattern}: ${latestVersion}`
  )
  return latestVersion
}
