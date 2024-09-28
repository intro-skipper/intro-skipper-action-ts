import * as core from '@actions/core'

import https from 'https'
import crypto from 'crypto'
import fs from 'fs'
import { URL } from 'url'

const repository = process.env.GITHUB_REPOSITORY
const version = process.env.NEW_FILE_VERSION
const gitHubRepoVisibilty = process.env.GITHUB_REPO_VISIBILITY
let currentVersion: Version | undefined
let targetAbi = ''

type Version = {
  version: string | undefined
  changelog: string
  targetAbi: string
  sourceUrl: string
  checksum: string
  timestamp: string
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

const jsonData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

export async function updateManifest(): Promise<void> {
  try {
    currentVersion = await getNugetPackageVersion('Jellyfin.Model', '10.*-*')
    targetAbi = `${currentVersion}.0`
    const newVersion = {
      version,
      changelog: `- See the full changelog at [GitHub](https://github.com/${repository}/releases/tag/10.9/v${version})\n`,
      targetAbi,
      sourceUrl: `https://github.com/${repository}/releases/download/10.9/v${version}/intro-skipper-v${version}.zip`,
      checksum: getMD5FromFile(),
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    console.log(`Repo is ${gitHubRepoVisibilty}.`)
    if (gitHubRepoVisibilty === 'public') {
      await validVersion(newVersion)
    }

    // Add the new version to the manifest
    jsonData[0].versions.unshift(newVersion)

    core.info('Manifest updated successfully.')
    updateDocsVersion(readmePath)
    updateDocsVersion(bugReportFormPath)

    cleanUpOldReleases()

    // Write the modified JSON data back to the file
    fs.writeFileSync(manifestPath, JSON.stringify(jsonData, null, 4), 'utf8')

    core.info('All operations completed successfully.')
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

function getMD5FromFile(): string {
  const fileBuffer = fs.readFileSync(`intro-skipper-v${version}.zip`)
  return crypto.createHash('md5').update(fileBuffer).digest('hex')
}

function updateDocsVersion(docsPath: string): void {
  const readMeContent = fs.readFileSync(docsPath, 'utf8')

  const updatedContent = readMeContent.replace(
    /Jellyfin.*\(or newer\)/,
    `Jellyfin ${currentVersion} (or newer)`
  )
  if (readMeContent !== updatedContent) {
    fs.writeFileSync(docsPath, updatedContent)
    core.info(`Updated ${docsPath} with new Jellyfin version.`)
  } else {
    core.info(`${docsPath} has already newest Jellyfin version.`)
  }
}

function cleanUpOldReleases(): void {
  // Extract all unique targetAbi values
  const abiSet = new Set()
  for (const entry of jsonData) {
    for (const v of entry.versions as Version[]) {
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
  for (const entry of jsonData) {
    entry.versions = (entry.versions as Version[]).filter(
      v => v.targetAbi === highestAbi || v.targetAbi === secondHighestAbi
    )
  }
}

async function getNugetPackageVersion(
  packageName: string,
  versionPattern: string
): Promise<Version | undefined> {
  // Convert package name to lowercase for the NuGet API
  const url = `https://api.nuget.org/v3-flatcontainer/${packageName.toLowerCase()}/index.json`

  try {
    // Fetch data using the built-in fetch API
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(
        `Failed to fetch package information: ${response.statusText}`
      )
    }

    const data = await response.json()
    const versions: Version[] = data.versions

    // Create a regular expression from the version pattern
    const versionRegex = new RegExp(
      versionPattern.replace(/\./g, '\\.').replace('*', '.*')
    )

    // Filter versions based on the provided pattern
    const matchingVersions = versions.filter(v =>
      versionRegex.test(v.version as string)
    )

    // Check if there are any matching versions
    if (matchingVersions.length > 0) {
      const latestVersion = matchingVersions[matchingVersions.length - 1]
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
    core.setFailed(
      `Error fetching package information for ${packageName}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
