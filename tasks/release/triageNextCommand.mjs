/* eslint-env node */

import { fileURLToPath } from 'node:url'

import { chalk, path } from 'zx'

import {
  colorKeyBox,
  getSymmetricDifference,
  getReleaseBranch,
  logSection,
  mungeCommits,
  purgeData,
  reportNewCommits,
  setupData,
  sharedGitLogOptions,
  triageCommits,
  updateRemotes,
} from './releaseLib.mjs'

export const command = 'triage-next'
export const description = 'Triage commits from next to the release branch'

export function builder(yargs) {
  return yargs.option('update-remotes', {
    description: 'Update remotes',
    type: 'boolean',
    default: true,
  })
}

export async function handler({ updateRemotes: shouldUpdateRemotes }) {
  const data = setupData(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'data',
      'triageNextData.json'
    )
  )

  if (shouldUpdateRemotes) {
    logSection('Updating remotes\n')
    await updateRemotes()
  }

  const releaseBranch = await getReleaseBranch()
  console.log()

  logSection(`Getting symmetric difference between next and ${releaseBranch}\n`)

  const stdout = await getSymmetricDifference('next', releaseBranch, {
    options: [
      ...sharedGitLogOptions,
      '--left-only',
      '--cherry-pick',
      '--boundary',
    ],
  })
  console.log()

  if (stdout.length === 1 && stdout[0] === '') {
    console.log(`The next and ${releaseBranch} branches are the same`)
    data.clear()
    return
  }

  const commits = await mungeCommits.call(
    { from: 'next', to: releaseBranch },
    stdout
  )

  let releaseCommits = commits.filter(
    (commit) => !['ui', 'chore', 'tag'].includes(commit.type)
  )

  logSection('Purging commit data\n')
  await purgeData(data, releaseCommits, releaseBranch)

  // Remove commits we've already triaged or cherry picked
  // (but had to change while cherry picking)
  releaseCommits = releaseCommits
    .filter(({ hash }) => !data.has(hash))
    .filter(({ ref }) => ref !== releaseBranch)

  if (!releaseCommits.length) {
    logSection('Showing colored-coded git log\n')

    console.log('No new commits to triage')

    console.log(
      colorKeyBox(
        [
          `${chalk.green('■')} Needs to be cherry picked`,
          `${chalk.dim.red('■')} Doesn't need to be cherry picked`,
          `${chalk.dim.blue('■')} Cherry picked into ${releaseBranch}`,
          `${chalk.dim('■')} Chore or "boundary" commit (ignore)`,
          `${chalk.yellow(
            '■'
          )} Not in the commit data (needs to be manually triaged)`,
        ].join('\n')
      )
    )

    commits
      .filter((commit) => !['ui', 'chore', 'tag'].includes(commit.type))
      .filter((commit) => commit.ref !== releaseBranch)
      .forEach((commit) => {
        if (!data.has(commit.hash)) {
          commit.pretty = chalk.yellow(commit.line)
          return
        }

        if (data.get(commit.hash).needsCherryPick) {
          commit.pretty = chalk.green(commit.line)
          return
        }

        commit.pretty = chalk.dim.red(commit.line)
      })

    console.log(commits.map(({ pretty }) => pretty).join('\n'))

    return
  }

  logSection('Triage\n')
  reportNewCommits.call({ from: 'next', to: releaseBranch }, releaseCommits)
  await triageCommits.call({ data, branch: releaseBranch }, releaseCommits)
}
