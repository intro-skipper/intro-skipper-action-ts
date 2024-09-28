import { incrementVersion } from '../src/update-version'

describe('update-version', () => {
  describe('incrementVersion', () => {
    it('should increment the last part of the version', () => {
      expect(incrementVersion('1.0.0')).toBe('1.0.1')
      expect(incrementVersion('1.2.3')).toBe('1.2.4')
      expect(incrementVersion('1.0.9')).toBe('1.0.10')
    })
  })
})
