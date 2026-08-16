#!/usr/bin/env node

import { checkPreset, installPreset, presetDirectory, removePreset } from './setup.js'

function usage(): never {
  throw new Error('Usage: learn-dsh-setup <install|check|remove|path> [--home <path>] [--force]')
}

function parseArguments(argv: readonly string[]): { command: string, home?: string, force: boolean } {
  const command = argv[0] ?? usage()
  let home: string | undefined
  let force = false
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--force') {
      force = true
      continue
    }
    if (argument === '--home') {
      home = argv[index + 1] ?? usage()
      index += 1
      continue
    }
    usage()
  }
  return { command, ...(home === undefined ? {} : { home }), force }
}

const options = parseArguments(process.argv.slice(2))
switch (options.command) {
  case 'install': {
    const result = await installPreset({ ...(options.home === undefined ? {} : { home: options.home }), force: options.force })
    process.stdout.write(`Learn DSH preset ${result.status}: ${result.presetDirectory}\n`)
    break
  }
  case 'check': {
    if (options.force) usage()
    const result = await checkPreset(options.home)
    if (result.status === 'missing') throw new Error(`Learn DSH preset is not installed: ${result.presetDirectory}`)
    process.stdout.write(`Learn DSH preset valid: ${result.presetDirectory}\n`)
    break
  }
  case 'remove': {
    if (options.force) usage()
    const result = await removePreset(options.home)
    process.stdout.write(`Learn DSH preset ${result.status}: ${result.presetDirectory}\n`)
    break
  }
  case 'path': {
    if (options.force) usage()
    process.stdout.write(`${presetDirectory(options.home)}\n`)
    break
  }
  default:
    usage()
}
