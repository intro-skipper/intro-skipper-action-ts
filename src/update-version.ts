import * as core from '@actions/core'

import fs from 'fs'

// Function to increment version string
export function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number)
  parts[parts.length - 1] += 1 // Increment the last part of the version
  return parts.join('.')
}

export async function updateVersion(
  csprojPath = './ConfusedPolarBear.Plugin.IntroSkipper/ConfusedPolarBear.Plugin.IntroSkipper.csproj',
  fileSystem: typeof fs = fs,
  logger: typeof core = core
): Promise<void> {
  if (!fileSystem.existsSync(csprojPath)) {
    logger.setFailed(`${csprojPath} file not found`)
    return
  }

  try {
    const data = await fileSystem.promises.readFile(csprojPath, 'utf8')
    const { updatedData, newAssemblyVersion, newFileVersion } =
      updateVersionsInData(data)

    await fileSystem.promises.writeFile(csprojPath, updatedData, 'utf8')
    logger.info('Version incremented successfully!')

    logger.exportVariable('NEW_ASSEMBLY_VERSION', newAssemblyVersion)
    logger.exportVariable('NEW_FILE_VERSION', newFileVersion)
  } catch (error) {
    logger.setFailed(`Error updating version: ${error}`)
  }
}

export function updateVersionsInData(data: string): {
  updatedData: string
  newAssemblyVersion: string
  newFileVersion: string
} {
  let newAssemblyVersion = ''
  let newFileVersion = ''

  const updatedData = data
    .replace(/<AssemblyVersion>(.*?)<\/AssemblyVersion>/, (_match, version) => {
      newAssemblyVersion = incrementVersion(version)
      return `<AssemblyVersion>${newAssemblyVersion}</AssemblyVersion>`
    })
    .replace(/<FileVersion>(.*?)<\/FileVersion>/, (_match, version) => {
      newFileVersion = incrementVersion(version)
      return `<FileVersion>${newFileVersion}</FileVersion>`
    })

  return { updatedData, newAssemblyVersion, newFileVersion }
}
