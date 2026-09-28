import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInput: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  updateManifest: vi.fn(),
  updateVersion: vi.fn(),
  addSpdxHeaders: vi.fn()
}))

vi.mock('@actions/core', () => ({
  getInput: mocks.getInput,
  setFailed: mocks.setFailed,
  setSecret: mocks.setSecret
}))
vi.mock('../src/validate-and-update-manifest.js', () => ({
  updateManifest: mocks.updateManifest
}))
vi.mock('../src/update-version.js', () => ({
  updateVersion: mocks.updateVersion
}))
vi.mock('../src/add-spdx-headers.js', () => ({
  addSpdxHeaders: mocks.addSpdxHeaders
}))

// The entrypoint runs on import, so re-import it for each task type.
async function runAction(taskType: string): Promise<void> {
  mocks.getInput.mockReturnValue(taskType)
  vi.resetModules()
  await import('../src/index.js')
}

describe('index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['updateManifest', mocks.updateManifest],
    ['updateVersion', mocks.updateVersion],
    ['addSpdxHeaders', mocks.addSpdxHeaders]
  ])('runs %s', async (taskType, task) => {
    await runAction(taskType)

    expect(mocks.getInput).toHaveBeenCalledWith('task-type')
    expect(task).toHaveBeenCalledTimes(1)
    expect(mocks.setFailed).not.toHaveBeenCalled()
  })

  it('fails on an unknown task type', async () => {
    await runAction('doSomething')

    expect(mocks.setFailed).toHaveBeenCalledWith(
      'Invalid task type: doSomething'
    )
    expect(mocks.updateManifest).not.toHaveBeenCalled()
    expect(mocks.updateVersion).not.toHaveBeenCalled()
    expect(mocks.addSpdxHeaders).not.toHaveBeenCalled()
  })
})
