/* eslint-env node */

import { chalk } from 'zx'

import { getReleaseCommits, logSection, colorKeyBox } from './releaseLib.mjs'

export const command = 'get-release-commits'
export const description = 'Get release commits'

export function builder(yargs) {
  return yargs.option('cache', {
    description: 'Use the cache if it exists',
    type: 'boolean',
    default: true,
  })
}

export async function handler({ cache }) {
  const { commits, tagsToColors, noReleaseCommits } = await getReleaseCommits({
    useCache: cache,
  })

  !cache && logSection(`Print\n`)

  const tagsToColorsKey = Object.entries(tagsToColors).map(([tag, color]) => {
    color = chalk.hex(color).dim
    return `${color('■')} Cherry picked into ${color(tag)}`
  })

  console.log(
    [
      `${chalk.yellow(noReleaseCommits)} commits in this release`,
      colorKeyBox(
        [
          ...tagsToColorsKey,
          `${chalk.dim('■')} UI, chore, or tag (ignore)`,
        ].join('\n')
      ),
      ...commits.map((commit) => commit.pretty),
    ].join('\n')
  )
}
