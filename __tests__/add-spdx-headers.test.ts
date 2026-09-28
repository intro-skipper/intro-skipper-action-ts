import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { addSpdxHeaders } from '../src/add-spdx-headers.js'

const core = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn()
}))

vi.mock('@actions/core', () => core)

// Isolate from the user's git config (e.g. commit signing).
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1'
}

let repo: string

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, env: gitEnv, stdio: 'ignore' })
}

function commit(
  file: string,
  content: string,
  author: string,
  date: string,
  message = `Update ${file}`
): void {
  const fullPath = path.join(repo, file)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content)
  git('add', '--', file)
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: repo,
    env: {
      ...gitEnv,
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author.replace(/\W/g, '')}@example.com`,
      GIT_AUTHOR_DATE: `${date}T12:00:00Z`,
      GIT_COMMITTER_NAME: 'Committer',
      GIT_COMMITTER_EMAIL: 'committer@example.com',
      GIT_COMMITTER_DATE: `${date}T12:00:00Z`
    },
    stdio: 'ignore'
  })
}

function read(file: string): string {
  return fs.readFileSync(path.join(repo, file), 'utf8')
}

describe('addSpdxHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'add-spdx-headers-'))
    git('init', '-q')
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it('adds a header listing authors ordered by first contribution', async () => {
    commit('src/A.cs', 'class A {}\n', 'Alice', '2021-03-01')
    commit('src/A.cs', 'class A { }\n', 'Bob', '2023-05-01')
    commit('src/A.cs', 'class A {  }\n', 'Alice', '2024-01-01')

    await addSpdxHeaders(repo)

    expect(read('src/A.cs')).toBe(
      [
        '// SPDX-FileCopyrightText: 2021-2024 Alice',
        '// SPDX-FileCopyrightText: 2023 Bob',
        '// SPDX-License-Identifier: GPL-3.0-only',
        'class A {  }',
        ''
      ].join('\n')
    )
  })

  it('skips bots and merges author aliases', async () => {
    commit('A.cs', '1\n', 'rlauu', '2020-01-01')
    commit('A.cs', '2\n', 'rlauuzo', '2022-01-01')
    commit('A.cs', '3\n', 'jumoog', '2023-01-01')
    commit('A.cs', '4\n', 'dependabot[bot]', '2024-01-01')
    commit('A.cs', '5\n', 'Copilot', '2024-02-01')
    commit('A.cs', '6\n', 'Claude Opus 4', '2024-03-01')
    commit('A.cs', '7\n', 'Claude Fable 5', '2025-03-01')

    await addSpdxHeaders(repo)

    expect(read('A.cs')).toBe(
      [
        '// SPDX-FileCopyrightText: 2020-2022 rlauuzo',
        '// SPDX-FileCopyrightText: 2023 Kilian von Pflugk',
        '// SPDX-License-Identifier: GPL-3.0-only',
        '7',
        ''
      ].join('\n')
    )
  })

  it('credits human co-authors but not bot co-authors', async () => {
    commit('A.cs', 'class A;\n', 'Alice', '2021-01-01')
    commit(
      'A.cs',
      'class A {}\n',
      'Alice',
      '2022-06-01',
      [
        'Pair on A',
        '',
        'Co-authored-by: Carol <carol@example.com>',
        'Co-authored-by: Claude Sonnet 4 <noreply@anthropic.com>',
        'co-authored-by: github-actions[bot] <bot@example.com>'
      ].join('\n')
    )
    commit(
      'A.cs',
      'class A { }\n',
      'Copilot',
      '2024-06-01',
      'Autofix\n\nCo-authored-by: Carol <carol@example.com>'
    )

    await addSpdxHeaders(repo)

    expect(read('A.cs')).toBe(
      [
        '// SPDX-FileCopyrightText: 2021-2022 Alice',
        '// SPDX-FileCopyrightText: 2022-2024 Carol',
        '// SPDX-License-Identifier: GPL-3.0-only',
        'class A { }',
        ''
      ].join('\n')
    )
  })

  it('replaces an existing header instead of duplicating it', async () => {
    commit(
      'A.cs',
      [
        '// Copyright (C) 2024 Intro-Skipper contributors <intro-skipper.org>',
        '// SPDX-FileCopyrightText: 2019 Someone Old',
        '',
        '// SPDX-License-Identifier: GPL-3.0-only',
        'namespace IntroSkipper;',
        ''
      ].join('\n'),
      'Alice',
      '2024-01-01'
    )

    await addSpdxHeaders(repo)
    const once = read('A.cs')
    await addSpdxHeaders(repo)

    expect(once).toBe(
      [
        '// SPDX-FileCopyrightText: 2024 Alice',
        '// SPDX-License-Identifier: GPL-3.0-only',
        'namespace IntroSkipper;',
        ''
      ].join('\n')
    )
    expect(read('A.cs')).toBe(once)
  })

  it('preserves CRLF line endings', async () => {
    commit('A.cs', 'using System;\r\nclass A {}\r\n', 'Alice', '2024-01-01')

    await addSpdxHeaders(repo)

    expect(read('A.cs')).toBe(
      [
        '// SPDX-FileCopyrightText: 2024 Alice',
        '// SPDX-License-Identifier: GPL-3.0-only',
        'using System;',
        'class A {}',
        ''
      ].join('\r\n')
    )
  })

  it('skips auto-generated files', async () => {
    const content = '// <auto-generated />\nclass Generated {}\n'
    commit('Generated.cs', content, 'Alice', '2024-01-01')

    await addSpdxHeaders(repo)

    expect(read('Generated.cs')).toBe(content)
    expect(core.info).toHaveBeenCalledWith(
      'Skipping auto-generated: Generated.cs'
    )
  })

  it('leaves files with only bot authors unchanged', async () => {
    commit('A.cs', 'class A {}\n', 'renovate[bot]', '2024-01-01')

    await addSpdxHeaders(repo)

    expect(read('A.cs')).toBe('class A {}\n')
  })

  it('leaves untracked files unchanged', async () => {
    fs.writeFileSync(path.join(repo, 'New.cs'), 'class New {}\n')

    await addSpdxHeaders(repo)

    expect(read('New.cs')).toBe('class New {}\n')
  })

  it('ignores obj directories and non-C# files', async () => {
    commit('obj/Debug/A.cs', 'class A {}\n', 'Alice', '2024-01-01')
    commit('README.md', '# Readme\n', 'Alice', '2024-01-01')
    commit('src/B.cs', 'class B {}\n', 'Alice', '2024-01-01')

    await addSpdxHeaders(repo)

    expect(read('obj/Debug/A.cs')).toBe('class A {}\n')
    expect(read('README.md')).toBe('# Readme\n')
    expect(read('src/B.cs')).toMatch(/^\/\/ SPDX-FileCopyrightText: 2024 Alice/)
  })

  it('processes many files concurrently', async () => {
    const files = Array.from({ length: 20 }, (_, i) => `F${i}.cs`)
    for (const file of files) {
      fs.writeFileSync(path.join(repo, file), `class ${file.slice(0, -3)} {}\n`)
    }
    git('add', '.')
    commit('F0.cs', 'class F0 { }\n', 'Alice', '2024-01-01')

    await addSpdxHeaders(repo)

    for (const file of files) {
      expect(read(file)).toMatch(/^\/\/ SPDX-FileCopyrightText: 2024 Alice\n/)
    }
  })

  it('warns and skips when git log fails', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'))
    try {
      fs.writeFileSync(path.join(outside, 'A.cs'), 'class A {}\n')

      // Point git at a non-existent repository so every `git log` fails.
      vi.stubEnv('GIT_DIR', path.join(outside, 'missing.git'))
      await addSpdxHeaders(outside)

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringMatching(/^Failed to get git log for A\.cs: /)
      )
      expect(fs.readFileSync(path.join(outside, 'A.cs'), 'utf8')).toBe(
        'class A {}\n'
      )
    } finally {
      vi.unstubAllEnvs()
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('does nothing when there are no C# files', async () => {
    await addSpdxHeaders(repo)

    expect(core.info).toHaveBeenCalledWith('Done!')
  })
})
