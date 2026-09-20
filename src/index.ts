import * as core from '@actions/core'

/**
 * The entrypoint for the action.
 */
import { updateManifest } from './validate-and-update-manifest.js'
import { updateVersion } from './update-version.js'
import { addSpdxHeaders } from './add-spdx-headers.js'

const taskType = core.getInput('task-type')

if (taskType === 'updateManifest') {
  await updateManifest()
} else if (taskType === 'updateVersion') {
  await updateVersion()
} else if (taskType === 'addSpdxHeaders') {
  await addSpdxHeaders()
} else {
  core.setFailed(`Invalid task type: ${taskType}`)
}
