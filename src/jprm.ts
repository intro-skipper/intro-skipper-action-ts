import * as yaml from 'js-yaml'
import fs from 'fs'
import * as core from '@actions/core'
import path from 'path'

type JPRMBuildConfig = {
  name: string
  guid: string
  version: string
  targetAbi: string
  framework: string
  owner: string
  overview: string
  description: string
  category: string
  artifacts: string[]
  changelog?: string
  [key: string]: unknown
}

export async function findBuildYaml(): Promise<string | null> {
  const possiblePaths = [
    'build.yaml',
    'build.yml',
    'jprm.yaml',
    'jprm.yml',
    '.jprm/build.yaml',
    '.jprm/build.yml'
  ]

  for (const buildPath of possiblePaths) {
    if (fs.existsSync(buildPath)) {
      core.info(`Auto-detected build file: ${buildPath}`)

      if (await isValidJPRMBuildFile(buildPath)) {
        return buildPath
      } else {
        core.warning(
          `Found ${buildPath} but it doesn't appear to be a valid JPRM build file`
        )
      }
    }
  }

  core.info('No JPRM build file found in common locations')
  return null
}

async function isValidJPRMBuildFile(filePath: string): Promise<boolean> {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = yaml.load(content) as JPRMBuildConfig

    if (!parsed) {
      return false
    }

    const jprmFields = ['name', 'version', 'guid', 'targetAbi']
    const hasJprmFields = jprmFields.some((field) => parsed[field])

    return hasJprmFields
  } catch (error) {
    core.warning(`Error reading or parsing ${filePath}: ${error}`)
    return false
  }
}

export async function updateJPRMVersion(
  buildYamlPath: string,
  newVersion: string
): Promise<JPRMBuildConfig | null> {
  try {
    core.info(`Updating version in JPRM build file: ${buildYamlPath}`)

    const buildYamlContent = fs.readFileSync(buildYamlPath, 'utf8')

    if (!buildYamlContent.trim()) {
      throw new Error(`Build file is empty: ${buildYamlPath}`)
    }

    const buildConfig = yaml.load(buildYamlContent) as JPRMBuildConfig

    if (!buildConfig) {
      throw new Error(`Failed to parse YAML in: ${buildYamlPath}`)
    }

    if (!buildConfig.version) {
      throw new Error(`No version field found in ${buildYamlPath}`)
    }

    const oldVersion = buildConfig.version
    buildConfig.version = newVersion

    const updatedYaml = yaml.dump(buildConfig, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    })

    fs.writeFileSync(buildYamlPath, updatedYaml, 'utf8')

    core.info(
      `Updated version in ${path.basename(buildYamlPath)}: ${oldVersion} → ${newVersion}`
    )

    core.setOutput('old-version', oldVersion)
    core.setOutput('new-version', newVersion)
    core.setOutput('build-yaml-updated', 'true')
    core.setOutput('build-yaml-path', buildYamlPath)

    return buildConfig
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    core.setFailed(`Failed to update JPRM build file: ${errorMessage}`)
    throw error
  }
}

export async function loadJPRMBuildFile(
  filePath: string
): Promise<JPRMBuildConfig | null> {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = yaml.load(content) as JPRMBuildConfig

    if (!parsed) {
      return null
    }
    return parsed
  } catch (error) {
    core.warning(`Error reading or parsing ${filePath}: ${error}`)
    return null
  }
}
