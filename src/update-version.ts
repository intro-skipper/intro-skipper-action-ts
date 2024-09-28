import * as core from '@actions/core'

import fs from 'fs'

// Function to increment version string
export function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number)
  parts[parts.length - 1] += 1 // Increment the last part of the version
  return parts.join('.')
}

export async function updateVersion(): Promise<void> {
  const csprojPath =
    './ConfusedPolarBear.Plugin.IntroSkipper/ConfusedPolarBear.Plugin.IntroSkipper.csproj'
  if (!fs.existsSync(csprojPath)) {
    core.setFailed(
      'ConfusedPolarBear.Plugin.IntroSkipper.csproj file not found'
    )
  }
  // Read the .csproj file
  fs.readFile(csprojPath, 'utf8', (err, data) => {
    if (err) {
      return core.setFailed(`Failed to read .csproj file:${err}`)
    }

    let newAssemblyVersion = null
    let newFileVersion = null

    // Use regex to find and increment versions
    const updatedData = data
      .replace(
        /<AssemblyVersion>(.*?)<\/AssemblyVersion>/,
        (_match, version) => {
          newAssemblyVersion = incrementVersion(version)
          return `<AssemblyVersion>${newAssemblyVersion}</AssemblyVersion>`
        }
      )
      .replace(/<FileVersion>(.*?)<\/FileVersion>/, (match, version) => {
        newFileVersion = incrementVersion(version)
        return `<FileVersion>${newFileVersion}</FileVersion>`
      })

    // Write the updated XML back to the .csproj file
    fs.writeFileSync(csprojPath, updatedData, 'utf8')
    core.info('Version incremented successfully!')

    // Write the new versions to GitHub Actions environment files
    core.exportVariable('NEW_ASSEMBLY_VERSION', newAssemblyVersion)
    core.exportVariable('NEW_FILE_VERSION', newFileVersion)
  })
}
