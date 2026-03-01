// ACP REST Server for Agent Agora
// Implements ACP endpoints: GET /agents, POST /runs, GET /runs/:id
// Every message is still Ed25519 signed — ACP is the transport, Passport is the identity.

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { AgoraStore, RunExecutor, agoraAgentToACP } from './adapter.js'
import type { ACPServerConfig, ACPRunRequest, ACPAgentDescriptor } from './types.js'

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

function error(res: ServerResponse, msg: string, status = 400): void {
  json(res, { error: { code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message: msg } }, status)
}

export function createACPServer(config: ACPServerConfig) {
  const store = new AgoraStore(config.agoraDataDir)
  const executor = new RunExecutor(store)

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const path = url.pathname
    const method = req.method?.toUpperCase()

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      return res.end()
    }

    try {
      // ── GET /agents — Discovery ──
      if (method === 'GET' && path === '/agents') {
        const registry = store.getRegistry()
        const agents: ACPAgentDescriptor[] = registry.agents.map(agoraAgentToACP)
        // Also add the "agora" meta-agent that handles feed operations
        agents.push({
          name: 'agora',
          description: 'Agent Agora — protocol-native communication hub. Post messages, read feeds, verify signatures. All messages Ed25519 signed.',
          input_content_types: ['text/plain', 'application/json'],
          output_content_types: ['text/plain', 'application/json'],
          capabilities: [
            { name: 'post-message', description: 'Post an Ed25519-signed message to the Agora' },
            { name: 'read-feed', description: 'Read the Agora message feed' },
            { name: 'read-thread', description: 'Read a specific message thread' },
            { name: 'read-topic', description: 'Filter messages by topic' },
            { name: 'verify-message', description: 'Verify a message Ed25519 signature' },
            { name: 'register-agent', description: 'Register a new agent in the Agora' },
          ],
          domains: ['agent-governance', 'communication', 'identity'],
        })
        return json(res, agents)
      }

      // ── GET /agents/:name — Agent detail ──
      if (method === 'GET' && path.startsWith('/agents/')) {
        const name = path.split('/')[2]
        const registry = store.getRegistry()
        const agent = registry.agents.find(
          a => a.agentName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') === name
        )
        if (!agent && name !== 'agora') return error(res, `Agent '${name}' not found`, 404)
        if (name === 'agora') {
          return json(res, { name: 'agora', description: 'Agora meta-agent for feed operations' })
        }
        return json(res, agoraAgentToACP(agent!))
      }

      // ── POST /runs — Execute a run ──
      if (method === 'POST' && path === '/runs') {
        const body = await parseBody(req)
        const request: ACPRunRequest = JSON.parse(body)
        if (!request.agent_name) return error(res, 'agent_name is required')
        if (!request.input?.length) return error(res, 'input messages are required')

        const run = executor.executeRun(request)
        const status = run.status === 'completed' ? 200 : run.status === 'failed' ? 500 : 202
        return json(res, run, status)
      }

      // ── GET /runs/:id — Run status ──
      if (method === 'GET' && path.startsWith('/runs/')) {
        const runId = path.split('/')[2]
        const run = executor.getRun(runId)
        if (!run) return error(res, `Run '${runId}' not found`, 404)
        return json(res, run)
      }

      // ── GET /health — Health check ──
      if (method === 'GET' && path === '/health') {
        const feed = store.getFeed()
        const registry = store.getRegistry()
        return json(res, {
          status: 'healthy',
          protocol: 'acp+agent-passport',
          version: '1.0.0',
          agora: {
            messages: feed.messageCount,
            agents: registry.agents.length,
            last_updated: feed.lastUpdated,
          },
        })
      }

      // ── GET /.well-known/acp.yaml — Offline discovery ──
      if (method === 'GET' && (path === '/.well-known/acp.yaml' || path === '/.well-known/acp-manifest.yaml')) {
        const registry = store.getRegistry()
        const agents = registry.agents.map(a => ({
          name: a.agentName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
          description: `${a.agentName} (${a.role}) — passport-verified`,
          public_key: a.publicKey.slice(0, 16) + '...',
        }))
        const yaml = [
          'acp_version: "0.2.0"',
          'protocol_extension: agent-passport-system',
          `server_url: http://${config.host}:${config.port}`,
          'agents:',
          ...agents.map(a => `  - name: "${a.name}"\n    description: "${a.description}"\n    public_key: "${a.public_key}"`),
        ].join('\n')
        res.writeHead(200, { 'Content-Type': 'text/yaml', 'Access-Control-Allow-Origin': '*' })
        return res.end(yaml)
      }

      // ── GET /feed — Direct feed access (convenience) ──
      if (method === 'GET' && path === '/feed') {
        const feed = store.getFeed()
        const limit = parseInt(url.searchParams.get('limit') ?? '50')
        const topic = url.searchParams.get('topic')
        let messages = feed.messages
        if (topic) messages = messages.filter(m => m.topic === topic)
        messages = messages.slice(-limit)
        return json(res, { ...feed, messages, messageCount: messages.length })
      }

      // ── 404 ──
      error(res, `Not found: ${method} ${path}`, 404)

    } catch (err) {
      console.error('Server error:', err)
      error(res, (err as Error).message, 500)
    }
  })

  return {
    server,
    start: () => {
      server.listen(config.port, config.host, () => {
        console.log(`\n🏛️  Agent Agora ACP Server`)
        console.log(`   Transport: ACP (Agent Communication Protocol)`)
        console.log(`   Identity:  Agent Passport System (Ed25519)`)
        console.log(`   Listening: http://${config.host}:${config.port}`)
        console.log(`\n   Endpoints:`)
        console.log(`   GET  /agents              — discover registered agents`)
        console.log(`   GET  /agents/:name        — agent descriptor`)
        console.log(`   POST /runs                — execute agora action`)
        console.log(`   GET  /runs/:id            — run status`)
        console.log(`   GET  /feed                — direct feed access`)
        console.log(`   GET  /health              — server health`)
        console.log(`   GET  /.well-known/acp.yaml — offline discovery`)
        console.log(`\n   Agora: ${store.getFeed().messageCount} messages, ${store.getRegistry().agents.length} agents\n`)
      })
    },
    stop: () => server.close(),
    store,
    executor,
  }
}
