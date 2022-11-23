#!/usr/bin/env node
/* eslint-env node, es2022 */

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { $ } from 'zx'

// import * as findPRCommand from './findPRCommand.mjs'
import { getReleaseBranch } from './branchStrategyLib.mjs'
import * as getReleaseCommits from './getReleaseCommits.mjs'
import * as triageMainCommand from './triageMainCommand.mjs'
import * as triageNextCommand from './triageNextCommand.mjs'
import * as validateMilestonesCommand from './validateMilestonesCommand.mjs'

// Validation

$.verbose = false

// Make sure we're on the branch-strategy-triage branch

const gitBranchPO = await $`git branch --show-current`

if (gitBranchPO.stdout.trim() !== 'branch-strategy-triage') {
  console.log(`Start from branch-strategy-triage`)
  process.exit(1)
}

// Release branch

const releaseBranch = await getReleaseBranch()

if (releaseBranch.split('\n').length > 1) {
  console.log(
    `There's more than one release branch: ${releaseBranch
      .split('\n')
      .map((releaseBranch) => releaseBranch.trim())
      .join(', ')}`
  )
  process.exit(1)
}

if (!releaseBranch.length) {
  console.log("There's no release branch")
  process.exit(1)
}

$.verbose = true

// CLI

yargs(hideBin(process.argv))
  // Config
  .scriptName('branch-strategy')
  .demandCommand()
  .strict()
  // Commands
  // .command(findPRCommand)
  .command(getReleaseCommits)
  .command(triageMainCommand)
  .command(triageNextCommand)
  .command(validateMilestonesCommand)
  // Run
  .parse()
