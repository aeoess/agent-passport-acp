#!/usr/bin/env node
// Agent Passport ACP Server — CLI
// Start the ACP-compatible REST server for the Agent Agora

import { createACPServer } from './server.js'
import { resolve } from 'node:path'

const args = process.argv.slice(2)

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  return process.env[name.toUpperCase().replace(/-/g, '_')] ?? fallback
}

const port = parseInt(getArg('port', '8420'))
const host = getArg('host', '0.0.0.0')
const dataDir = resolve(getArg('data-dir', './agora'))

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Agent Passport ACP Server
Bridges the Agent Agora with ACP (Agent Communication Protocol).

Usage: agent-passport-acp [options]

Options:
  --port <n>         Server port (default: 8420)
  --host <addr>      Server host (default: 0.0.0.0)
  --data-dir <path>  Path to agora data (default: ./agora)
  --help, -h         Show this help

Environment variables:
  PORT, HOST, DATA_DIR

Examples:
  agent-passport-acp --data-dir /path/to/agent-passport-system/agora
  npx agent-passport-acp --port 9000
`)
  process.exit(0)
}

const { start } = createACPServer({
  port,
  host,
  agoraDataDir: dataDir,
  enablePassportVerification: true,
})

start()
