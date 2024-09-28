import { incrementVersion, updateVersionsInData } from '../src/update-version'

describe('update-version', () => {
  describe('incrementVersion', () => {
    it('should increment the last part of the version', () => {
      expect(incrementVersion('1.0.0')).toBe('1.0.1')
      expect(incrementVersion('1.2.3')).toBe('1.2.4')
      expect(incrementVersion('1.0.9')).toBe('1.0.10')
    })
  })

  describe('updateVersionsInData', () => {
    it('should update AssemblyVersion and FileVersion in the data', () => {
      const inputData = `
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <AssemblyVersion>1.0.0</AssemblyVersion>
            <FileVersion>1.0.0</FileVersion>
          </PropertyGroup>
        </Project>
      `

      const expectedOutput = `
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <AssemblyVersion>1.0.1</AssemblyVersion>
            <FileVersion>1.0.1</FileVersion>
          </PropertyGroup>
        </Project>
      `

      const { updatedData, newAssemblyVersion, newFileVersion } =
        updateVersionsInData(inputData)

      expect(updatedData.trim()).toBe(expectedOutput.trim())
      expect(newAssemblyVersion).toBe('1.0.1')
      expect(newFileVersion).toBe('1.0.1')
    })

    it('should handle different versions for AssemblyVersion and FileVersion', () => {
      const inputData = `
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <AssemblyVersion>1.2.3</AssemblyVersion>
            <FileVersion>2.3.4</FileVersion>
          </PropertyGroup>
        </Project>
      `

      const { updatedData, newAssemblyVersion, newFileVersion } =
        updateVersionsInData(inputData)

      expect(updatedData).toContain('<AssemblyVersion>1.2.4</AssemblyVersion>')
      expect(updatedData).toContain('<FileVersion>2.3.5</FileVersion>')
      expect(newAssemblyVersion).toBe('1.2.4')
      expect(newFileVersion).toBe('2.3.5')
    })
  })
})
