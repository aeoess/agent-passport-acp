import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createACPServer } from '../src/server.js'
import { agoraMessageToACP, parseACPInput, AgoraStore } from '../src/adapter.js'
import type { ACPMessage, ACPRunRequest } from '../src/types.js'
import type { AgoraMessage } from 'agent-passport-system'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Helpers ──

function makeTestDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'acp-test-'))
  // Seed with minimal data
  const feed = {
    version: '1.0', protocol: 'agent-social-contract',
    lastUpdated: new Date().toISOString(), messageCount: 2,
    messages: [
      {
        id: 'msg-test-001', version: '1.0',
        timestamp: '2026-01-01T00:00:00Z',
        author: { agentId: 'test-agent', agentName: 'TestBot', publicKey: 'abc123' },
        topic: 'testing', type: 'discussion',
        subject: 'First test message', content: 'Hello from test',
        signature: 'test-sig-001',
      },
      {
        id: 'msg-test-002', version: '1.0',
        timestamp: '2026-01-01T00:01:00Z',
        author: { agentId: 'test-agent-2', agentName: 'TestBot2', publicKey: 'def456' },
        topic: 'testing', type: 'ack',
        subject: 'Reply to first', content: 'Acknowledged',
        replyTo: 'msg-test-001',
        signature: 'test-sig-002',
      },
    ]
  }
  const registry = {
    version: '1.0', lastUpdated: new Date().toISOString(),
    agents: [
      { agentId: 'test-agent', agentName: 'TestBot', publicKey: 'abc123', joinedAt: '2026-01-01T00:00:00Z', role: 'founder' },
      { agentId: 'test-agent-2', agentName: 'TestBot2', publicKey: 'def456', joinedAt: '2026-01-01T00:00:00Z', role: 'member' },
    ]
  }
  writeFileSync(join(dir, 'messages.json'), JSON.stringify(feed))
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(registry))
  return dir
}

async function fetch(url: string, opts?: RequestInit): Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  const res = await globalThis.fetch(url, opts)
  return res
}

// ── Tests ──

describe('ACP Adapter — Unit Tests', () => {

  it('agoraMessageToACP converts message correctly', () => {
    const msg: AgoraMessage = {
      id: 'msg-001', version: '1.0', timestamp: '2026-01-01T00:00:00Z',
      author: { agentId: 'a1', agentName: 'Alice', publicKey: 'pk1' },
      topic: 'test', type: 'discussion', subject: 'Hello', content: 'World',
      signature: 'sig1',
    }
    const acp = agoraMessageToACP(msg)
    assert.equal(acp.role, 'agent/alice')
    assert.equal(acp.parts.length, 2)
    assert.equal(acp.parts[0].content_type, 'text/plain')
    assert.equal(acp.parts[0].content, 'World')
    assert.equal((acp.parts[0].metadata as any).kind, 'passport')
    assert.equal((acp.parts[0].metadata as any).agent_id, 'a1')
    assert.equal((acp.parts[0].metadata as any).signature, 'sig1')
    // Envelope
    const env = JSON.parse(acp.parts[1].content!)
    assert.equal(env.id, 'msg-001')
    assert.equal(env.topic, 'test')
    assert.equal(env.subject, 'Hello')
  })

  it('parseACPInput — read_feed default', () => {
    const input: ACPMessage[] = [{ role: 'user', parts: [{ content_type: 'text/plain', content: '' }] }]
    const { action } = parseACPInput(input)
    assert.equal(action, 'read_feed')
  })

  it('parseACPInput — post_message from JSON', () => {
    const input: ACPMessage[] = [{
      role: 'user', parts: [
        { content_type: 'text/plain', content: 'post' },
        { content_type: 'application/json', content: JSON.stringify({ action: 'post_message', topic: 'test', content: 'Hello' }) }
      ]
    }]
    const { action, params } = parseACPInput(input)
    assert.equal(action, 'post_message')
    assert.equal(params.topic, 'test')
  })

  it('parseACPInput — read_thread', () => {
    const input: ACPMessage[] = [{
      role: 'user', parts: [
        { content_type: 'application/json', content: JSON.stringify({ action: 'read_thread', messageId: 'msg-001' }) }
      ]
    }]
    const { action, params } = parseACPInput(input)
    assert.equal(action, 'read_thread')
    assert.equal(params.messageId, 'msg-001')
  })

  it('parseACPInput — list_agents', () => {
    const input: ACPMessage[] = [{
      role: 'user', parts: [{ content_type: 'text/plain', content: 'agents' }]
    }]
    const { action } = parseACPInput(input)
    assert.equal(action, 'list_agents')
  })
})

describe('AgoraStore', () => {
  it('loads feed and registry from files', () => {
    const dir = makeTestDataDir()
    const store = new AgoraStore(dir)
    assert.equal(store.getFeed().messageCount, 2)
    assert.equal(store.getRegistry().agents.length, 2)
  })

  it('getThread returns root + replies', () => {
    const dir = makeTestDataDir()
    const store = new AgoraStore(dir)
    const thread = store.getThread('msg-test-001')
    assert.equal(thread.length, 2)
  })

  it('getByTopic filters correctly', () => {
    const dir = makeTestDataDir()
    const store = new AgoraStore(dir)
    const msgs = store.getByTopic('testing')
    assert.equal(msgs.length, 2)
    const none = store.getByTopic('nonexistent')
    assert.equal(none.length, 0)
  })
})

describe('ACP Server — Integration Tests', () => {
  let server: ReturnType<typeof createACPServer>
  const port = 18420 // test port
  const baseUrl = `http://localhost:${port}`

  before(async () => {
    const dir = makeTestDataDir()
    server = createACPServer({
      port, host: '127.0.0.1',
      agoraDataDir: dir,
      enablePassportVerification: true,
    })
    server.start()
    await new Promise(r => setTimeout(r, 500)) // wait for server
  })

  after(() => { server.stop() })

  it('GET /health returns healthy', async () => {
    const res = await fetch(`${baseUrl}/health`)
    const data = await res.json()
    assert.equal(data.status, 'healthy')
    assert.equal(data.agora.messages, 2)
    assert.equal(data.agora.agents, 2)
  })

  it('GET /agents returns agent list + agora meta-agent', async () => {
    const res = await fetch(`${baseUrl}/agents`)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.equal(data.length, 3) // 2 agents + agora
    assert.equal(data[2].name, 'agora')
    // Check passport extension
    assert.equal(data[0].passport.agent_id, 'test-agent')
    assert.equal(data[0].passport.role, 'founder')
  })

  it('GET /agents/:name returns agent detail', async () => {
    const res = await fetch(`${baseUrl}/agents/testbot`)
    const data = await res.json()
    assert.equal(data.name, 'testbot')
    assert.ok(data.passport)
  })

  it('GET /agents/:unknown returns 404', async () => {
    const res = await fetch(`${baseUrl}/agents/nobody`)
    assert.equal(res.status, 404)
  })

  it('GET /feed returns messages', async () => {
    const res = await fetch(`${baseUrl}/feed`)
    const data = await res.json()
    assert.equal(data.messageCount, 2)
    assert.ok(data.messages[0].signature)
  })

  it('GET /feed?topic=testing filters', async () => {
    const res = await fetch(`${baseUrl}/feed?topic=testing`)
    const data = await res.json()
    assert.equal(data.messageCount, 2)
  })

  it('GET /feed?topic=nonexistent returns empty', async () => {
    const res = await fetch(`${baseUrl}/feed?topic=nonexistent`)
    const data = await res.json()
    assert.equal(data.messageCount, 0)
  })

  it('POST /runs — read_feed via ACP', async () => {
    const req: ACPRunRequest = {
      agent_name: 'agora',
      input: [{ role: 'user', parts: [{ content_type: 'text/plain', content: 'read_feed' }] }],
    }
    const res = await fetch(`${baseUrl}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = await res.json()
    assert.equal(data.status, 'completed')
    assert.equal(data.output.length, 2)
    assert.ok(data.output[0].parts[0].metadata)
    assert.equal(data.output[0].parts[0].metadata.kind, 'passport')
  })

  it('POST /runs — read_thread via ACP', async () => {
    const req: ACPRunRequest = {
      agent_name: 'agora',
      input: [{ role: 'user', parts: [
        { content_type: 'application/json', content: JSON.stringify({ action: 'read_thread', messageId: 'msg-test-001' }) }
      ] }],
    }
    const res = await fetch(`${baseUrl}/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = await res.json()
    assert.equal(data.status, 'completed')
    assert.equal(data.output.length, 2) // root + reply
  })

  it('POST /runs — list_agents via ACP', async () => {
    const req: ACPRunRequest = {
      agent_name: 'agora',
      input: [{ role: 'user', parts: [{ content_type: 'text/plain', content: 'agents' }] }],
    }
    const res = await fetch(`${baseUrl}/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = await res.json()
    assert.equal(data.status, 'completed')
    const agents = JSON.parse(data.output[0].parts[0].content)
    assert.equal(agents.length, 2)
  })

  it('GET /runs/:id returns run result', async () => {
    // First create a run
    const req: ACPRunRequest = {
      agent_name: 'agora',
      input: [{ role: 'user', parts: [{ content_type: 'text/plain', content: 'read_feed' }] }],
    }
    const createRes = await fetch(`${baseUrl}/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const created = await createRes.json()
    // Then retrieve it
    const getRes = await fetch(`${baseUrl}/runs/${created.run_id}`)
    const retrieved = await getRes.json()
    assert.equal(retrieved.run_id, created.run_id)
    assert.equal(retrieved.status, 'completed')
  })

  it('GET /runs/unknown returns 404', async () => {
    const res = await fetch(`${baseUrl}/runs/nonexistent`)
    assert.equal(res.status, 404)
  })

  it('GET /.well-known/acp.yaml returns YAML manifest', async () => {
    const res = await fetch(`${baseUrl}/.well-known/acp.yaml`)
    const text = await res.text()
    assert.ok(text.includes('acp_version'))
    assert.ok(text.includes('agent-passport-system'))
    assert.ok(text.includes('testbot'))
  })

  it('POST /runs — missing agent_name returns error', async () => {
    const res = await fetch(`${baseUrl}/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: [{ role: 'user', parts: [] }] }),
    })
    assert.equal(res.status, 400)
  })

  it('CORS headers present', async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })
})
