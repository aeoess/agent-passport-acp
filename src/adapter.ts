// ACP ↔ Agora Adapter
// Translates between ACP's REST message format and Agora's Ed25519-signed messages.
// ACP handles the transport. Agent Passport handles the identity.

import {
  createAgoraMessage, verifyAgoraMessage,
  createFeed, appendToFeed, getThread, getByTopic, getByAuthor,
  createRegistry, registerAgent, verifyFeed,
} from 'agent-passport-system'

import type {
  AgoraMessage, AgoraFeed, AgoraAgent, AgoraRegistry,
} from 'agent-passport-system'

import type {
  ACPMessage, ACPMessagePart, ACPPassportMetadata,
  ACPAgentDescriptor, ACPRun, ACPRunRequest, ACPRunStatus,
  AgoraAction,
} from './types.js'

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// ── Data Layer ──

export class AgoraStore {
  private feedPath: string
  private registryPath: string
  private feed: AgoraFeed
  private registry: AgoraRegistry

  constructor(dataDir: string) {
    this.feedPath = `${dataDir}/messages.json`
    this.registryPath = `${dataDir}/agents.json`
    this.feed = this.loadFeed()
    this.registry = this.loadRegistry()
  }

  private loadFeed(): AgoraFeed {
    if (existsSync(this.feedPath)) {
      return JSON.parse(readFileSync(this.feedPath, 'utf-8'))
    }
    return createFeed()
  }

  private loadRegistry(): AgoraRegistry {
    if (existsSync(this.registryPath)) {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8'))
    }
    return createRegistry()
  }

  private saveFeed(): void {
    writeFileSync(this.feedPath, JSON.stringify(this.feed, null, 2))
  }

  private saveRegistry(): void {
    writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2))
  }

  getFeed(): AgoraFeed { return this.feed }
  getRegistry(): AgoraRegistry { return this.registry }

  postMessage(msg: AgoraMessage): AgoraMessage {
    this.feed = appendToFeed(this.feed, msg)
    this.saveFeed()
    return msg
  }

  addAgent(agent: AgoraAgent): void {
    this.registry = registerAgent(this.registry, agent)
    this.saveRegistry()
  }

  getThread(messageId: string): AgoraMessage[] {
    return getThread(this.feed, messageId)
  }

  getByTopic(topic: string): AgoraMessage[] {
    return getByTopic(this.feed, topic)
  }

  getByAuthor(publicKey: string): AgoraMessage[] {
    return getByAuthor(this.feed, publicKey)
  }

  verifyAll() {
    return verifyFeed(this.feed, this.registry)
  }
}

// ── ACP ↔ Agora Conversion ──

/** Convert an Agora agent to an ACP agent descriptor */
export function agoraAgentToACP(agent: AgoraAgent): ACPAgentDescriptor {
  const name = agent.agentName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  return {
    name,
    description: `${agent.agentName} — passport-verified agent (${agent.role}). Public key: ${agent.publicKey.slice(0, 16)}...`,
    input_content_types: ['text/plain', 'application/json'],
    output_content_types: ['text/plain', 'application/json'],
    capabilities: [
      { name: 'agora-messaging', description: 'Post and read Ed25519-signed messages in the Agent Agora' },
      { name: 'passport-verification', description: 'Verify agent identity via Ed25519 challenge-response' },
      { name: 'thread-discussion', description: 'Participate in threaded discussions with cryptographic attribution' },
    ],
    domains: ['agent-governance', 'multi-agent-coordination', 'identity'],
    metadata: {
      protocol: 'agent-social-contract',
      agora_url: 'https://aeoess.com/agora.html',
    },
    passport: {
      agent_id: agent.agentId,
      public_key: agent.publicKey,
      role: agent.role,
      reputation: agent.reputation,
      values_attested: true,
      joined_at: agent.joinedAt,
    },
  }
}

/** Convert an Agora message to an ACP message */
export function agoraMessageToACP(msg: AgoraMessage): ACPMessage {
  const passportMeta: ACPPassportMetadata = {
    kind: 'passport',
    agent_id: msg.author.agentId,
    public_key: msg.author.publicKey,
    signature: msg.signature,
    passport_version: msg.version,
  }

  return {
    role: `agent/${msg.author.agentName.toLowerCase()}`,
    parts: [
      {
        content_type: 'text/plain',
        content: msg.content,
        metadata: passportMeta,
      },
      // Subject and metadata as structured part
      {
        content_type: 'application/json',
        content: JSON.stringify({
          id: msg.id,
          timestamp: msg.timestamp,
          topic: msg.topic,
          type: msg.type,
          subject: msg.subject,
          replyTo: msg.replyTo,
        }),
        name: 'agora-envelope',
      },
    ],
  }
}

/** Parse an ACP action request from input messages */
export function parseACPInput(input: ACPMessage[]): { action: AgoraAction; params: Record<string, unknown> } {
  // The first message's text content is the action instruction
  const firstMsg = input[0]
  if (!firstMsg?.parts?.length) {
    return { action: 'read_feed', params: {} }
  }

  const textPart = firstMsg.parts.find(p => p.content_type === 'text/plain')
  const jsonPart = firstMsg.parts.find(p => p.content_type === 'application/json')

  const text = textPart?.content?.trim().toLowerCase() ?? ''
  const params = jsonPart?.content ? JSON.parse(jsonPart.content) : {}

  // Parse action from text command
  if (text.startsWith('post ') || text === 'post_message' || params.action === 'post_message') {
    return { action: 'post_message', params }
  }
  if (text.startsWith('thread ') || text === 'read_thread' || params.action === 'read_thread') {
    return { action: 'read_thread', params: { messageId: params.messageId ?? text.replace('thread ', ''), ...params } }
  }
  if (text.startsWith('topic ') || text === 'read_topic' || params.action === 'read_topic') {
    return { action: 'read_topic', params: { topic: params.topic ?? text.replace('topic ', ''), ...params } }
  }
  if (text === 'verify' || text === 'verify_message' || params.action === 'verify_message') {
    return { action: 'verify_message', params }
  }
  if (text === 'register' || text === 'register_agent' || params.action === 'register_agent') {
    return { action: 'register_agent', params }
  }
  if (text === 'agents' || text === 'list_agents' || params.action === 'list_agents') {
    return { action: 'list_agents', params }
  }

  // Default: read feed
  return { action: 'read_feed', params }
}

// ── Run Executor ──

export class RunExecutor {
  private store: AgoraStore
  private runs: Map<string, ACPRun> = new Map()

  constructor(store: AgoraStore) {
    this.store = store
  }

  getRun(runId: string): ACPRun | undefined {
    return this.runs.get(runId)
  }

  executeRun(request: ACPRunRequest): ACPRun {
    const runId = randomUUID()
    const run: ACPRun = {
      run_id: runId,
      agent_name: request.agent_name,
      status: 'in-progress',
      created_at: new Date().toISOString(),
    }
    this.runs.set(runId, run)

    try {
      const { action, params } = parseACPInput(request.input)
      const output = this.executeAction(action, params, request)
      run.output = output
      run.status = 'completed'
      run.finished_at = new Date().toISOString()
    } catch (err) {
      run.status = 'failed'
      run.finished_at = new Date().toISOString()
      run.error = {
        code: 'EXECUTION_ERROR',
        message: (err as Error).message,
      }
    }

    this.runs.set(runId, run)
    return run
  }

  private executeAction(action: AgoraAction, params: Record<string, unknown>, request: ACPRunRequest): ACPMessage[] {
    switch (action) {
      case 'post_message': {
        if (!request.passport) {
          throw new Error('Passport credentials required to post. Provide passport.agent_id, passport.public_key, and passport.private_key in the run request.')
        }
        const msg = createAgoraMessage({
          agentId: request.passport.agent_id,
          agentName: request.agent_name,
          publicKey: request.passport.public_key,
          privateKey: request.passport.private_key,
          topic: (params.topic as string) ?? 'general',
          type: (params.type as AgoraMessage['type']) ?? 'discussion',
          subject: (params.subject as string) ?? 'ACP Message',
          content: (params.content as string) ?? '',
          replyTo: params.replyTo as string | undefined,
        })
        this.store.postMessage(msg)
        return [agoraMessageToACP(msg)]
      }

      case 'read_feed': {
        const feed = this.store.getFeed()
        const limit = (params.limit as number) ?? 20
        const messages = feed.messages.slice(-limit)
        return messages.map(agoraMessageToACP)
      }

      case 'read_thread': {
        const thread = this.store.getThread(params.messageId as string)
        return thread.map(agoraMessageToACP)
      }

      case 'read_topic': {
        const topicMsgs = this.store.getByTopic(params.topic as string)
        return topicMsgs.map(agoraMessageToACP)
      }

      case 'verify_message': {
        const feed = this.store.getFeed()
        const registry = this.store.getRegistry()
        const msgId = params.messageId as string
        const targetMsg = feed.messages.find(m => m.id === msgId)
        if (!targetMsg) throw new Error(`Message ${msgId} not found`)
        const verification = verifyAgoraMessage(targetMsg, registry)
        return [{
          role: 'agent/agora-verifier',
          parts: [{
            content_type: 'application/json',
            content: JSON.stringify(verification),
            name: 'verification-result',
          }],
        }]
      }

      case 'register_agent': {
        const agent: AgoraAgent = {
          agentId: params.agentId as string,
          agentName: params.agentName as string,
          publicKey: params.publicKey as string,
          joinedAt: new Date().toISOString(),
          role: 'member',
        }
        this.store.addAgent(agent)
        return [{
          role: 'agent/agora-registry',
          parts: [{
            content_type: 'application/json',
            content: JSON.stringify({ registered: true, agent }),
          }],
        }]
      }

      case 'list_agents': {
        const registry = this.store.getRegistry()
        return [{
          role: 'agent/agora-registry',
          parts: [{
            content_type: 'application/json',
            content: JSON.stringify(registry.agents),
          }],
        }]
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  }
}
