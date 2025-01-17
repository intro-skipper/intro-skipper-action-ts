import * as core from '@actions/core'

/**
 * The entrypoint for the action.
 */
import { updateManifest } from './validate-and-update-manifest.js'
import { updateVersion } from './update-version.js'

const taskType = core.getInput('task-type')

if (taskType === 'updateManifest') {
  updateManifest()
} else if (taskType === 'updateVersion') {
  updateVersion()
} else {
  core.setFailed(`Invalid task type: ${taskType}`)
}
