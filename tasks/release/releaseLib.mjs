/* eslint-env node */

import { fileURLToPath } from 'url'

import { faker } from '@faker-js/faker'
import boxen from 'boxen'
import prompts_ from 'prompts'
import { $, fs, question, chalk, path } from 'zx'

/**
 * Wrapper around `prompts` to exit on crtl c.
 *
 * @template Name
 * @param {import('prompts').PromptObject<Name>} promptsObject
 * @param {import('prompts').Options} promptsOptions
 */
export function prompts(promptsObject, promptsOptions) {
  return prompts_(promptsObject, {
    ...promptsOptions,
    onCancel: () => process.exit(1),
  })
}

/**
 * For the triage-main and -next commands.
 *
 * @param {string} path
 */
export function setupData(path) {
  let dataFile

  try {
    dataFile = JSON.parse(fs.readFileSync(path, 'utf-8'))
    dataFile = new Map(Object.entries(dataFile))
  } catch {
    dataFile = new Map()
  }

  process.on('exit', () => {
    fs.writeFileSync(
      path,
      JSON.stringify(Object.fromEntries(dataFile), null, 2)
    )
  })

  return dataFile
}

/**
 * Parse a commit "line" from `git log` into a commit object
 * (it's hash, message, and pr number if it has one).
 *
 * @param {string} commit
 * @returns {{ hash: string, message: string, pr: string }}
 */
export function parseCommit(commit) {
  const match = commit.match(/\w{9}/)
  const [hash] = match

  const message = commit.slice(match.index + 10)

  const prMatch = message.match(PR)
  const pr = prMatch?.groups.pr

  return {
    hash,
    message,
    pr,
  }
}

/**
 * Uses a commit's message to determine if a commit is in a given ref.
 *
 * ```js
 * await isCommitInRef('main', 'fix(setup-auth): notes formatting')
 * true
 *
 * await isCommitInRef('next', 'fix(setup-auth): notes formatting')
 * true
 *
 * await isCommitInRef('v3.5.0', 'fix(setup-auth): notes formatting')
 * false
 * ```
 *
 * This depends on the commit's message being left alone when cherry picking.
 *
 * @param {string} branch
 * @param {string} message
 */
export async function isCommitInRef(ref, message) {
  return !!(await $`git log ${ref} --oneline --grep ${message}`).stdout.trim()
}

export function reportNewCommits(commits) {
  console.log(
    [
      `There's ${chalk.magenta(commits.length)} commits in the ${chalk.magenta(
        this.from
      )} branch that aren't in the ${chalk.magenta(this.to)} branch:`,
      '',
      commits
        .map(({ hash, message }) => `${chalk.dim(hash)} ${message}`)
        .join('\n'),
    ].join('\n')
  )
}

/**
 * Given an array of commits, ask the user if they need to be cherry picked, etc.
 *
 * @param {Array<{ hash: string, message: string, pr: string }>} commits
 */
export async function triageCommits(commits) {
  for (let commit of commits) {
    const { hash, message, pr } = commit

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const answer = await question(
        `Does ${chalk.dim(hash)} ${chalk.cyan(
          message
        )} need to be cherry picked into ${chalk.magenta(
          this.branch
        )}? [Y/n/o(pen)] > `
      )

      if (['open', 'o'].includes(answer)) {
        if (pr) {
          await $`open https://github.com/redwoodjs/redwood/pull/${pr}`
        } else {
          console.log("There's no PR for this commit")
        }

        continue
      }

      this.data.set(hash, {
        message: message,
        needsCherryPick: isYes(answer),
      })

      break
    }
  }
}

/**
 * Gets the release branch if it exists and there's not more than one. Otherwise, it throws.
 *
 * ```js
 * await getReleaseBranch()
 * 'release/minor/v3.6.0'
 * ```
 */
export async function getReleaseBranch() {
  return (await $`git branch --list release/*`).stdout.trim()
}

export async function purgeData(data, commits, branch) {
  const commitHashes = commits.map((commit) => commit.hash)

  for (const dataHash of data.keys()) {
    if (!commitHashes.includes(dataHash)) {
      data.delete(dataHash)
    }
  }

  const needsCherryPick = [...data.entries()].filter(
    ([, { needsCherryPick }]) => needsCherryPick
  )

  for (const [hash] of needsCherryPick) {
    const commit = commits.find((commit) => commit.hash === hash)

    if (commit.ref === branch) {
      data.delete(hash)
    }
  }
}

/**
 * Usually used with `isCommitInRef`:
 *
 * ```js
 * await isCommitInRef('main', sanitizeMessage('fix(setup-auth): notes formatting [skip ci]'))
 * ```
 *
 * @param {string} message
 */
export function sanitizeMessage(message) {
  message = message.replace('[', '\\[')
  message = message.replace(']', '\\]')
  return message
}

/**
 * Updates remotes
 */
export async function updateRemotes() {
  await $`git remote update`
  console.log()

  for (const ref of ['main', 'next']) {
    const shouldFetch = await originHasCommits(ref)
    console.log()

    if (shouldFetch) {
      await $`git fetch origin ${ref}:${ref}`
      console.log()
    }
  }
}

/**
 * Find out if the a local branch has commits on the remote.
 *
 * ```js
 * await originHasCommits('main')
 * true
 * ```
 *
 * @param {string} ref
 */
async function originHasCommits(ref) {
  return parseInt(
    (await $`git rev-list ${ref}...origin/${ref} --count`).stdout.trim()
  )
}

const boxenStyles = {
  padding: 1,
  margin: 1,
  borderStyle: 'round',
  dimBorder: true,
}

export function colorKeyBox(colorKey) {
  return boxen(colorKey, {
    title: 'Key',
    ...boxenStyles,
  })
}

export async function getReleaseCommits({ useCache } = { useCache: true }) {
  const cachePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'data',
    'releaseCommits.json'
  )

  const cacheExists = fs.existsSync(cachePath)

  if (useCache && cacheExists) {
    return fs.readJSONSync(cachePath)
  }

  logSection('Getting the release branch and the last release\n')
  const releaseBranch = await getReleaseBranch()
  const latestRelease = await getLatestRelease()

  logSection(
    `Getting the symmetric difference between ${releaseBranch} and ${latestRelease}\n`
  )

  const stdout = await getSymmetricDifference(releaseBranch, latestRelease, {
    options: [
      ...sharedGitLogOptions,
      // See https://stackoverflow.com/questions/11459040/is-there-a-way-to-check-if-two-different-git-commits-are-equal-in-content
      '--cherry-mark',
    ],
  })

  logSection(
    `Checking if any of the commits in ${releaseBranch} were in a minor or patch release\n`
  )

  const [vMajor, minor] = releaseBranch.split('/').pop().split('.')

  faker.seed(+minor)

  let patches = (await $`git tag -l ${vMajor}.${minor - 2}.[!0]`).stdout.trim()
  console.log()

  patches &&= patches.split('\n')

  const tags = [...patches, latestRelease]

  const tagsToColors = tags.reduce((colors, tag) => {
    colors[tag] = faker.color.rgb()
    return colors
  }, {})

  const commits = await mungeCommits.call(
    { from: releaseBranch, to: tags, refsToColors: tagsToColors },
    stdout
  )

  const releaseCommits = commits.filter((commit) => {
    return commit.ref === releaseBranch && commit.type === 'commit'
  })

  const data = {
    commits,
    tagsToColors,
    releaseCommits,
    noReleaseCommits: releaseCommits.length,
  }
  fs.writeJSONSync(cachePath, data, { spaces: 2 })
  return data
}

export const sharedGitLogOptions = [
  '--oneline',
  '--no-abbrev-commit',
  '--left-right',
  '--graph',
]

/**
 * Logs a section, like:
 *
 * ```bash
 * --------------------
 * # Get the release branch and the last release
 * ```
 *
 * If you want to add a new line, add it at the end of the string (\n):
 *
 * ```js
 * logSection('Getting the release branch and the last release\n')
 * ```
 *
 * @param {string} title
 */
export function logSection(title) {
  console.log([separator, chalk.dim(`# ${title}`)].join('\n'))
}

export const separator = chalk.dim('-'.repeat(process.stdout.columns))

/**
 * Gets the latest release.
 *
 * ```js
 * await getLatestRelease()
 * 'v3.5.0'
 * ```
 *
 * Uses the "-" prefix of `git tag`'s `--sort` option.
 * See https://git-scm.com/docs/git-tag#Documentation/git-tag.txt---sortltkeygt
 *
 */
export async function getLatestRelease() {
  return (
    await $`git tag --sort="-version:refname" --list "v?.?.?" | head -n 1`
  ).stdout.trim()
}

/**
 * Get the symmetric difference between two refs. (Basically, what's different about them.)
 *
 * Usually used to compare the release branch to the latest release:
 *
 * ```js
 * const releaseBranch = await getSymmetricDifference()
 * const latestRelease = await getSymmetricDifference()
 * await getSymmetricDifference(releaseBranch, latestRelease)
 * ```
 *
 * It doesn't really matter which ref is left and which is right.
 * The commits in the left ref will be prefixed with "<",
 * while the commits in the right ref will be prefixed with ">".
 *
 * For a quick reference on the `...` syntax, see
 * https://stackoverflow.com/questions/462974/what-are-the-differences-between-double-dot-and-triple-dot-in-git-com
 *
 * @param {string} leftRef
 * @param {string} rightRef
 */
export async function getSymmetricDifference(leftRef, rightRef, { options }) {
  return (await $`git log ${options} ${leftRef}...${rightRef}`).stdout
    .trim()
    .split('\n')
}

/**
 * Find out if a line from `git log --graph` is just UI:
 *
 * ```bash
 * * 1b0b9a9 | chore: update dependencies
 * |\  # This is just UI
 * | * 3a4b5c6 (HEAD -> release/3.6, origin/release/3.6) chore: update dependencies
 * ```
 *
 * @param {string} line
 * @returns
 */
export function isLineUI(line) {
  return MARKS.some((mark) => line.startsWith(mark))
}

/**
 * Marks used in `git log --graph` that are just UI.
 */
export const MARKS = ['o', ' /', '|\\', '| o', '|\\|']

export const HASH = /\s(?<hash>\w{40})\s/
export const PR = /#(?<pr>\d+)/

/**
 * See if a commit is a chore via it's message.
 *
 * ```js
 * await isCommitChore('chore: update yarn.lock')
 * true
 * ```
 *
 * @param {string} line
 */
export function isCommitChore(line) {
  return (
    /Merge branch (?<branch>.*) into next/.test(line) ||
    line.includes('chore: update yarn.lock') ||
    line.includes('Version docs') ||
    line.includes('chore: update all contributors')
  )
}

export const ANNOTATED_TAG_MESSAGE = /^v\d.\d.\d$/

/**
 * Given a commit's hash, get it's message.
 *
 * ```js
 * await getCommitMessage('0bb0f8ce075ea1e0f6a7851d80df2bc7d303e756')
 * 'chore(deps): update babel monorepo (#6779)'
 * ```
 *
 * @param {string} hash
 */
export async function getCommitMessage(hash) {
  return (await $`git log --format=%s -n 1 ${hash}`).stdout.trim()
}

export async function mungeCommits(stdout) {
  const commits = []

  for (const line of stdout) {
    const commit = {
      line,
      ref: this.from,
      type: 'commit',
      pretty: line,
    }

    commits.push(commit)

    if (isLineUI(line)) {
      commit.type = 'ui'
      commit.pretty = chalk.dim(line)
      continue
    }

    commit.hash = line.match(HASH).groups.hash
    commit.message = await getCommitMessage(commit.hash)
    commit.pr = commit.message.match(PR)?.groups.pr

    if (isCommitChore(line)) {
      commit.type = 'chore'
      commit.pretty = chalk.dim(line)
      continue
    }

    if (ANNOTATED_TAG_MESSAGE.test(commit.message)) {
      commit.ref = commit.message
      commit.type = 'tag'
      commit.pretty = chalk.dim(commit.line)
      continue
    }

    this.to = Array.isArray(this.to) ? this.to : [this.to]

    for (const ref of this.to) {
      const prettyFn = this.refsToColors?.[ref]
        ? chalk.dim.hex(this.refsToColors[ref])
        : chalk.dim.blue

      if (await isCommitInRef(ref, sanitizeMessage(commit.message))) {
        commit.ref = ref
        commit.pretty = prettyFn(commit.line)
      }
    }

    console.log()
  }

  return commits
}

export async function getCurrentBranch() {
  return (await $`git branch --show-current`).stdout.trim()
}

export function isYes(res) {
  return ['', 'Y', 'y'].includes(res)
}

export async function openCherryPickPRs() {
  await $`open https://github.com/redwoodjs/redwood/pulls?q=is%3Apr+is%3Aopen+label%3Acherry-pick`
}

export async function getMilestone(title) {
  const {
    repository: {
      milestones: { nodes },
    },
  } = await this.octokit.graphql(getMilestoneQuery, { title })

  return nodes[0]
}

const getMilestoneQuery = `
  query GetMilestoneQuery($title: String) {
    repository(owner: "redwoodjs", name: "redwood") {
      milestones(
        query: $title
        first: 1
        orderBy: { field: NUMBER, direction: DESC }
      ) {
        nodes {
          title
          id
          number
        }
      }
    }
  }
`
