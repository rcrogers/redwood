/* eslint-env node */

import { fileURLToPath } from 'node:url'

import { chalk, path } from 'zx'

import {
  colorKeyBox,
  getSymmetricDifference,
  logSection,
  mungeCommits,
  openCherryPickPRs,
  purgeData,
  reportNewCommits,
  setupData,
  sharedGitLogOptions,
  triageCommits,
  updateRemotes,
} from './releaseLib.mjs'

export const command = 'triage-main'
export const description = 'Triage commits from main to next'

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
      'triageMainData.json'
    )
  )

  if (shouldUpdateRemotes) {
    logSection('Updating remotes\n')
    await updateRemotes()
  }

  // ------------------------
  logSection('Getting symmetric difference between main and next\n')

  const stdout = await getSymmetricDifference('main', 'next', {
    options: [
      ...sharedGitLogOptions,
      '--left-only',
      '--cherry-pick',
      '--boundary',
    ],
  })
  console.log()

  const commits = await mungeCommits.call({ from: 'main', to: 'next' }, stdout)

  let releaseCommits = commits.filter(
    (commit) => !['ui', 'chore', 'tag'].includes(commit.type)
  )

  // ------------------------
  logSection('Purging commit data\n')
  await purgeData(data, releaseCommits, 'next')

  // Remove commits we've already triaged or cherry picked
  // (but had to change while cherry picking)
  releaseCommits = releaseCommits
    .filter(({ hash }) => !data.has(hash))
    .filter(({ ref }) => ref !== 'next')

  if (!releaseCommits.length) {
    logSection('Showing colored-coded git log\n')
    console.log('No new commits to triage')

    console.log(
      colorKeyBox(
        [
          `${chalk.green('■')} Needs to be cherry picked`,
          `${chalk.dim.red('■')} Doesn't need to be cherry picked`,
          `${chalk.dim.blue('■')} Cherry picked into next`,
          `${chalk.dim('■')} Chore or "boundary" commit (ignore)`,
          `${chalk.yellow(
            '■'
          )} Not in the commit data (needs to be manually triaged)`,
        ].join('\n')
      )
    )

    commits
      .filter((commit) => !['ui', 'chore', 'tag'].includes(commit.type))
      .filter((commit) => commit.ref !== 'next')
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

  // ------------------------
  logSection('Triage\n')

  await openCherryPickPRs()
  console.log()
  reportNewCommits.call({ from: 'main', to: 'next' }, releaseCommits)
  console.log()
  await triageCommits.call({ data, branch: 'next' }, releaseCommits)
}
