import {
  filterVersions,
  cleanUpOldReleases,
  updateDocsVersion
} from '../src/validate-and-update-manifest'

// Declare the global variable type
declare global {
  let currentVersion: string | undefined
}

describe('cleanUpOldReleases', () => {
  it('keeps only versions with the two highest targetAbi', () => {
    const input = [
      {
        guid: 'c83d86bb-a1e0-4c35-a113-e2101cf4ee6b',
        name: 'Intro Skipper',
        overview: 'Automatically detect and skip intros in television episodes',
        description:
          'Analyzes the audio of television episodes and detects introduction sequences.',
        owner: 'AbandonedCart, rlauuzo, jumoog (forked from ConfusedPolarBear)',
        category: 'General',
        imageUrl:
          'https://raw.githubusercontent.com/intro-skipper/intro-skipper/master/images/logo.png',
        versions: [
          {
            version: '1.0.0',
            targetAbi: '10.8.0',
            changelog: '',
            sourceUrl: '',
            checksum: '',
            timestamp: ''
          },
          {
            version: '1.1.0',
            targetAbi: '10.9.0',
            changelog: '',
            sourceUrl: '',
            checksum: '',
            timestamp: ''
          },
          {
            version: '1.2.0',
            targetAbi: '10.9.0',
            changelog: '',
            sourceUrl: '',
            checksum: '',
            timestamp: ''
          },
          {
            version: '0.9.0',
            targetAbi: '10.7.0',
            changelog: '',
            sourceUrl: '',
            checksum: '',
            timestamp: ''
          }
        ]
      }
    ]

    const result = cleanUpOldReleases(input)

    // Check if only 3 versions are kept (2 with 10.9.0 and 1 with 10.8.0)
    expect(result[0].versions.length).toBe(3)
    // Check if the kept versions have the correct targetAbi values
    expect(result[0].versions.map((v) => v.targetAbi).sort()).toEqual([
      '10.8.0',
      '10.9.0',
      '10.9.0'
    ])
  })
})

describe('updateDocsVersion', () => {
  const currentVersion = '10.9.11'

  it('updates the Jellyfin version in the documentation', () => {
    const input =
      'I use Jellyfin 10.9.10 (or newer) and my permissions are correct'
    const { updatedContent, wasUpdated } = updateDocsVersion(
      input,
      currentVersion
    )

    // Check if the version is updated correctly
    expect(updatedContent).toBe(
      'I use Jellyfin 10.9.11 (or newer) and my permissions are correct'
    )
    // Check if the wasUpdated flag is true
    expect(wasUpdated).toBe(true)
  })

  it('makes no changes if the version is already up to date', () => {
    const input = 'Requires Jellyfin 10.9.11 (or newer)'
    const { updatedContent, wasUpdated } = updateDocsVersion(
      input,
      currentVersion
    )

    // Check if the content remains unchanged
    expect(updatedContent).toBe(input)
    // Check if the wasUpdated flag is false
    expect(wasUpdated).toBe(false)
  })
})

describe('filterVersions', () => {
  const testVersions = [
    '10.0.0',
    '10.1.0',
    '10.1.1',
    '10.2.0',
    '11.0.0',
    '11.1.0-beta',
    '11.1.0',
    '12.0.0'
  ]

  test('matches exact version', () => {
    expect(filterVersions(testVersions, '10.1.0')).toBe('10.1.0')
  })

  test('matches wildcard major version', () => {
    expect(filterVersions(testVersions, '10.*')).toBe('10.2.0')
  })

  test('matches wildcard minor version', () => {
    expect(filterVersions(testVersions, '10.1.*')).toBe('10.1.1')
  })

  test('matches wildcard patch version', () => {
    expect(filterVersions(testVersions, '11.1.*')).toBe('11.1.0')
  })

  test('returns undefined for non-matching pattern', () => {
    expect(filterVersions(testVersions, '13.*')).toBeUndefined()
  })

  test('handles empty version list', () => {
    expect(filterVersions([], '10.*')).toBeUndefined()
  })

  test('ignores pre-release versions', () => {
    expect(filterVersions(testVersions, '11.1.*')).toBe('11.1.0')
  })

  test('returns latest matching version', () => {
    expect(filterVersions(testVersions, '*')).toBe('12.0.0')
  })
})
