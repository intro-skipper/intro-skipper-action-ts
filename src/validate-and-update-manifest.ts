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

let currentVersion: string
let targetAbi = ''

type Nuget = {
  versions: string[]
}

// Read README.md
const readmePath = './README.md'
if (!fs.existsSync(readmePath)) {
  core.setFailed('README.md file not found')
}

// Read .github/ISSUE_TEMPLATE/bug_report_form.yml
const bugReportFormPath = './.github/ISSUE_TEMPLATE/bug_report_form.yml'
if (!fs.existsSync(bugReportFormPath)) {
  core.setFailed(`${bugReportFormPath} file not found`)
}

export async function updateManifest(): Promise<void> {
  if (!token) {
    core.setFailed('GITHUB_PAT environment variable is not set')
  }
  try {
    if (mainVersion && isBeta === 'false') {
      currentVersion = await getNugetPackageVersion(
        'Jellyfin.Model',
        mainVersion + '.*-*'
      )
      if (currentVersion == null) {
        core.setFailed('Failed to get current version of Jellyfin.Model')
        return
      }
    } else {
      currentVersion = `${mainVersion}.0`
    }
    targetAbi = `${currentVersion}.0`
    const client_payload = {
      pluginName: 'Intro Skipper',
      version: version!,
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

    if (repository?.includes('test')) {
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

    if (response.ok) {
      // response.ok is true if status is 200-299
      console.log(
        `Successfully triggered dispatch event 'update-manifest'. Status: ${response.status}`
      )
      if (response.status === 204) {
        console.log('No content returned, which is expected for dispatches.')
      } else {
        const responseData = await response.text() // Or response.json() if expecting JSON
        console.log('Response data:', responseData)
      }
    } else {
      console.error(
        `Failed to trigger dispatch event. Status: ${response.status}`
      )
      const errorText = await response.text()
      console.error('Error details:', errorText)
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
    process.exit(0)
  } catch (error) {
    core.setFailed(
      `Error updating manifest: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function getMD5FromFile(file: string): string {
  if (!fs.existsSync(file)) {
    core.setFailed(`File ${file} not found`)
    return ''
  }
  const fileBuffer = fs.readFileSync(file)
  return crypto.createHash('md5').update(fileBuffer).digest('hex')
}

export function updateDocsVersion(
  content: string,
  currentVersion?: string
): { updatedContent: string; wasUpdated: boolean } {
  if (currentVersion == null) {
    core.setFailed('Failed to get current version of Jellyfin.Model')
    return { updatedContent: content, wasUpdated: false }
  }
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
      }`
    )
  }
}

export function filterVersions(
  versions: string[],
  versionPattern: string
): string | undefined {
  const versionRegex = new RegExp(
    versionPattern.replace(/\./g, '\\.').replace('*', '.*')
  )
  const matchingVersions = versions.filter((v) => versionRegex.test(v))

  if (matchingVersions.length > 0) {
    const latestVersion = matchingVersions[matchingVersions.length - 1]
    return latestVersion
  }
  core.setFailed(`No versions match the pattern ${versionPattern}`)
  return undefined
}

async function getNugetPackageVersion(
  packageName: string,
  versionPattern: string
): Promise<string> {
  try {
    const versions = await fetchNugetPackageVersions(packageName)
    const latestVersion = filterVersions(versions, versionPattern)

    if (latestVersion) {
      core.info(
        `Latest version of ${packageName} matching ${versionPattern}: ${latestVersion}`
      )
      return latestVersion
    } else {
      core.setFailed(
        `No versions of ${packageName} match the pattern ${versionPattern}`
      )
    }
  } catch (error) {
    core.setFailed(String(error))
  }
  core.setFailed(`Something went wrong while fetching ${packageName}`)
  return ''
}
