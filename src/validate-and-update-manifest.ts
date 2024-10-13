import * as core from '@actions/core'

import https from 'https'
import crypto from 'crypto'
import fs from 'fs'
import { URL } from 'url'

const repository = process.env.GITHUB_REPOSITORY
const version = process.env.NEW_FILE_VERSION
const gitHubRepoVisibilty = process.env.GITHUB_REPO_VISIBILITY
const forcedCurrentVersion = process.env.CURRENT_VERSION
const mainVersion = process.env.MAIN_VERSION
let currentVersion: string
let targetAbi = ''

type Manifest = {
  guid: string
  name: string
  overview: string
  description: string
  owner: string
  category: string
  imageUrl: string
  versions: Version[]
}

type Version = {
  version: string
  changelog: string
  targetAbi: string
  sourceUrl: string
  checksum: string
  timestamp: string
}

type Nuget = {
  versions: string[]
}

// Read manifest.json
const manifestPath = './manifest.json'
if (!fs.existsSync(manifestPath)) {
  core.setFailed('manifest.json file not found')
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
  let jsonData: Manifest[] = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  try {
    if (!forcedCurrentVersion) {
      currentVersion = await getNugetPackageVersion(
        'Jellyfin.Model',
        mainVersion + '.*-*'
      )
      if (currentVersion == null) {
        core.setFailed('Failed to get current version of Jellyfin.Model')
        return
      }
    } else {
      currentVersion = forcedCurrentVersion
    }
    targetAbi = `${currentVersion}.0`
    const newVersion = {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      version: version!,
      changelog: `- See the full changelog at [GitHub](https://github.com/${repository}/releases/tag/${mainVersion}/v${version})\n`,
      targetAbi,
      sourceUrl: `https://github.com/${repository}/releases/download/${mainVersion}/v${version}/intro-skipper-v${version}.zip`,
      checksum: getMD5FromFile(`intro-skipper-v${version}.zip`),
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    core.info(`Repo is ${gitHubRepoVisibilty}.`)
    if (gitHubRepoVisibilty === 'public') {
      await validVersion(newVersion)
    }

    // Add the new version to the manifest
    jsonData[0].versions.unshift(newVersion)

    core.info('Manifest updated successfully.')
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

    jsonData = cleanUpOldReleases(jsonData)

    // Write the modified JSON data back to the file
    fs.writeFileSync(manifestPath, JSON.stringify(jsonData, null, 4), 'utf8')

    core.info('All operations completed successfully.')
    process.exit(0)
  } catch (error) {
    core.setFailed(
      `Error updating manifest: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function validVersion(v: Version): Promise<void> {
  core.info(`Validating version ${v.version}...`)

  const isValidChecksum = await verifyChecksum(v.sourceUrl, v.checksum)
  if (!isValidChecksum) {
    core.setFailed(`Checksum mismatch for URL: ${v.sourceUrl}`)
  } else {
    core.info(`Version ${v.version} is valid.`)
  }
}

async function verifyChecksum(
  url: string,
  expectedChecksum: string
): Promise<boolean> {
  try {
    const hash = await downloadAndHashFile(url)
    return hash === expectedChecksum
  } catch (error) {
    core.setFailed(`Error verifying checksum for URL: ${url} ${error}`)
    return false
  }
}

async function downloadAndHashFile(
  url: string,
  redirects = 5
): Promise<string> {
  if (redirects === 0) {
    throw new Error('Too many redirects')
  }

  return new Promise((resolve, reject) => {
    https
      .get(url, async response => {
        try {
          if (
            response.statusCode != null &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            // Follow redirect
            const redirectUrl = new URL(
              response.headers.location,
              url
            ).toString()
            const hash = await downloadAndHashFile(redirectUrl, redirects - 1)
            resolve(hash)
          } else if (response.statusCode === 200) {
            const hash = crypto.createHash('md5')
            response.pipe(hash)
            response.on('end', () => {
              resolve(hash.digest('hex'))
            })
            response.on('error', err => {
              reject(err)
            })
          } else {
            reject(new Error(`Failed to get '${url}' (${response.statusCode})`))
          }
        } catch (err) {
          reject(err)
        }
      })
      .on('error', err => {
        reject(err)
      })
  })
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

export function cleanUpOldReleases(jsonData: Manifest[]): Manifest[] {
  // Extract all unique targetAbi values
  const abiSet = new Set()
  for (const entry of jsonData) {
    for (const v of entry.versions) {
      abiSet.add(v.targetAbi)
    }
  }

  // Convert the Set to an array and sort it in descending order
  const abiArray = Array.from(abiSet).sort((a, b) => {
    const aParts = (a as string).split('.').map(Number)
    const bParts = (b as string).split('.').map(Number)

    for (let i = 0; i < aParts.length; i++) {
      if (aParts[i] > bParts[i]) return -1
      if (aParts[i] < bParts[i]) return 1
    }
    return 0
  })

  // Identify the highest and second highest targetAbi
  const highestAbi = abiArray[0]
  const secondHighestAbi = abiArray[1]

  // Filter the versions array to keep only those with the highest or second highest targetAbi
  return jsonData.map(entry => ({
    ...entry,
    versions: entry.versions.filter(
      v => v.targetAbi === highestAbi || v.targetAbi === secondHighestAbi
    )
  }))
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
  const matchingVersions = versions.filter(v => versionRegex.test(v))

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
