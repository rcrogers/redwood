/* eslint-env node, es2022 */

import boxen from 'boxen'
import { $, chalk } from 'zx'

import { parseCommit, GIT_LOG_UI } from './branchStrategyLib.mjs'

async function compareMinorToPatch({ minor, patch }) {
  console.log(chalk.dim('-'.repeat(process.stdout.columns)))
  console.log(
    [
      `Comparing ${chalk.magenta(minor)} minor with ${chalk.magenta(
        patch
      )} patch`,
      `First trying the \`..\` (double dot) notation`,
    ].join('\n')
  )

  let message = [
    `The \`..\` notation looks for commits that ${chalk.magenta(
      patch
    )} has that ${chalk.magenta(minor)} doesn't.`,
    `If ${chalk.magenta(minor)} is missing commits from ${chalk.magenta(
      patch
    )}`,
    "we'd be releasing a minor that doesn't include fixes from the patch",
    'I.e., not good',
  ].join('\n')

  console.log(
    boxen(message, {
      title: 'The `..` notation',
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      dimBorder: true,
    })
  )

  let stdout = (await $`git log ${options} ${minor}..${patch}`).stdout.trim()

  if (stdout === '') {
    console.log(chalk.green('  ok'))
    return
  }

  const missingCommits = stdout
    .split('\n')
    .filter((line) => {
      // > edcfed079 (tag: v3.1.2) v3.1.2
      // > 3002bc945 chore: update yarn.lock
      return !(
        /\(tag: v\d\.\d\.\d\)/.test(line) ||
        /chore: update yarn.lock/.test(line)
      )
    })
    // get rid of the "> " or "< " or "= "
    .map((line) => line.substring(2))
    .map(parseCommit)

  console.log(
    [
      '',
      `${chalk.magenta(minor)} is supposedly missing...`,
      ...missingCommits.map(({ hash, message }) => `  - ${hash} ${message}`),
    ].join('\n')
  )

  console.log(['', `Now trying the \`...\` (triple dot) notation`].join('\n'))

  message = [
    `The \`...\` notation shows the "symmetric difference" between ${chalk.magenta(
      patch
    )} and ${chalk.magenta(minor)}`,
    `which is the commits that are in either ${chalk.magenta(
      patch
    )} or ${chalk.magenta(minor)} but not both`,
  ].join('\n')

  console.log(
    boxen(message, {
      title: 'The `...` notation',
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      dimBorder: true,
    })
  )

  $.verbose = false
  stdout = (
    await $`git log ${[...options, '--left-only']} ${minor}...${patch}`
  ).stdout.trim()
  $.verbose = true

  stdout = stdout.split('\n')

  if (
    !missingCommits.every(({ message }) =>
      stdout.some((line) => line.includes(message))
    )
  ) {
    console.log(`${chalk.red('error')}: ${minor} is missing commits`)
    return
  }

  stdout.forEach((line, i) => {
    if (GIT_LOG_UI.some((mark) => line.startsWith(mark))) {
      return
    }

    if (
      missingCommits.some(
        ({ message }) => message === parseCommit(line).message
      )
    ) {
      stdout[i] = chalk.green(line)
    }
  })

  console.log(stdout.join('\n'))
  console.log(chalk.green('  ok'))
}

const options = [
  '--oneline',
  '--decorate',
  '--left-right',
  '--graph',
  '--cherry-mark',
]

// await compareMinorToPatch({
//   minor: 'v3.1.0',
//   patch: 'v3.0.3',
// })

// await compareMinorToPatch({
//   minor: 'v3.2.0',
//   patch: 'v3.1.2',
// })

// await compareMinorToPatch({
//   minor: 'v3.3.0',
//   patch: 'v3.2.2',
// })

// await compareMinorToPatch({
//   minor: 'v3.4.0',
//   patch: 'v3.3.2',
// })

// await compareMinorToPatch({
//   minor: 'release/minor/v3.5.0',
//   patch: 'v3.4.0',
// })
