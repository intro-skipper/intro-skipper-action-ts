import type * as core from '@actions/core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  incrementVersion,
  updateVersion,
  updateVersionsInData
} from '../src/update-version.js'

const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <AssemblyVersion>1.10.10.19</AssemblyVersion>
    <FileVersion>1.10.10.19</FileVersion>
  </PropertyGroup>
</Project>
`

function createLogger() {
  return {
    info: vi.fn(),
    setFailed: vi.fn(),
    exportVariable: vi.fn()
  }
}

describe('incrementVersion', () => {
  it('increments the last component', () => {
    expect(incrementVersion('1.10.10.19')).toBe('1.10.10.20')
  })

  it('carries past 9 without wrapping', () => {
    expect(incrementVersion('1.9')).toBe('1.10')
  })

  it('handles a single component', () => {
    expect(incrementVersion('7')).toBe('8')
  })
})

describe('updateVersionsInData', () => {
  it('increments both AssemblyVersion and FileVersion', () => {
    const result = updateVersionsInData(csproj)

    expect(result.newAssemblyVersion).toBe('1.10.10.20')
    expect(result.newFileVersion).toBe('1.10.10.20')
    expect(result.updatedData).toContain(
      '<AssemblyVersion>1.10.10.20</AssemblyVersion>'
    )
    expect(result.updatedData).toContain(
      '<FileVersion>1.10.10.20</FileVersion>'
    )
  })

  it('increments each tag independently', () => {
    const data =
      '<AssemblyVersion>2.0.0.5</AssemblyVersion><FileVersion>2.0.0.9</FileVersion>'

    const result = updateVersionsInData(data)

    expect(result.newAssemblyVersion).toBe('2.0.0.6')
    expect(result.newFileVersion).toBe('2.0.0.10')
  })

  it('returns empty versions and unchanged data when tags are missing', () => {
    const data = '<Project></Project>'

    const result = updateVersionsInData(data)

    expect(result).toEqual({
      updatedData: data,
      newAssemblyVersion: '',
      newFileVersion: ''
    })
  })
})

describe('updateVersion', () => {
  let tmpDir: string
  let csprojPath: string
  let logger: ReturnType<typeof createLogger>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-version-'))
    csprojPath = path.join(tmpDir, 'IntroSkipper.csproj')
    logger = createLogger()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const run = () =>
    updateVersion(csprojPath, fs, logger as unknown as typeof core)

  it('writes incremented versions and exports them', async () => {
    fs.writeFileSync(csprojPath, csproj)

    await run()

    const written = fs.readFileSync(csprojPath, 'utf8')
    expect(written).toBe(csproj.replaceAll('1.10.10.19', '1.10.10.20'))
    expect(logger.exportVariable).toHaveBeenCalledWith(
      'NEW_ASSEMBLY_VERSION',
      '1.10.10.20'
    )
    expect(logger.exportVariable).toHaveBeenCalledWith(
      'NEW_FILE_VERSION',
      '1.10.10.20'
    )
    expect(logger.setFailed).not.toHaveBeenCalled()
  })

  it('fails when the csproj does not exist', async () => {
    await run()

    expect(logger.setFailed).toHaveBeenCalledWith(
      `${csprojPath} file not found`
    )
    expect(logger.exportVariable).not.toHaveBeenCalled()
  })

  it('fails without writing when a version tag is missing', async () => {
    const data = '<Project><FileVersion>1.0.0.0</FileVersion></Project>'
    fs.writeFileSync(csprojPath, data)

    await run()

    expect(logger.setFailed).toHaveBeenCalledWith(
      `${csprojPath} must contain both <AssemblyVersion> and <FileVersion> tags`
    )
    expect(fs.readFileSync(csprojPath, 'utf8')).toBe(data)
    expect(logger.exportVariable).not.toHaveBeenCalled()
  })

  it('reports read errors via setFailed', async () => {
    // A directory passes existsSync but cannot be read as a file.
    fs.mkdirSync(csprojPath)

    await run()

    expect(logger.setFailed).toHaveBeenCalledWith(
      expect.stringMatching(/^Error updating version: /)
    )
  })
})
