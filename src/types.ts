// ACP Types — Agent Communication Protocol data models
// Mirrors the ACP OpenAPI spec (v0.2.0) with Agent Passport extensions
//
// ACP is the transport layer. Agent Passport is the identity layer.
// Together they give agents both communication AND accountability.

// ── ACP Core Types ──

export interface ACPMessagePart {
  name?: string                              // artifact name (optional)
  content_type: string                       // MIME type (e.g. "text/plain", "application/json")
  content?: string                           // inline content
  content_encoding?: 'plain' | 'base64'      // encoding (default: plain)
  content_url?: string                       // URL to content (alternative to inline)
  metadata?: ACPMetadata                     // optional metadata
}

export type ACPMetadata =
  | ACPCitationMetadata
  | ACPTrajectoryMetadata
  | ACPPassportMetadata     // ← our extension

export interface ACPCitationMetadata {
  kind: 'citation'
  start_index?: number
  end_index?: number
  url?: string
  title?: string
  description?: string
}

export interface ACPTrajectoryMetadata {
  kind: 'trajectory'
  message?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_output?: Record<string, unknown>
}

// Agent Passport extension — embeds Ed25519 identity into ACP messages
export interface ACPPassportMetadata {
  kind: 'passport'
  agent_id: string
  public_key: string           // Ed25519 public key (hex)
  signature: string            // Ed25519 signature of message content (hex)
  passport_version: string     // e.g. "1.0"
  delegation_scope?: string[]  // scoped authority from delegation chain
  values_attested?: boolean    // whether agent attested the values floor
}

export interface ACPMessage {
  role: string                 // "user" | "agent" | "agent/{name}"
  parts: ACPMessagePart[]
}

// ── ACP Agent Descriptor ──

export interface ACPAgentCapability {
  name: string
  description: string
}

export interface ACPAgentDescriptor {
  name: string                              // RFC 1123 DNS label
  description: string
  metadata?: Record<string, unknown>
  input_content_types?: string[]            // supported input MIME types
  output_content_types?: string[]           // supported output MIME types
  capabilities?: ACPAgentCapability[]
  domains?: string[]
  // Agent Passport extensions
  passport?: {
    agent_id: string
    public_key: string
    role: 'founder' | 'member' | 'observer'
    reputation?: number
    values_attested: boolean
    joined_at: string
  }
}

// ── ACP Run ──

export type ACPRunMode = 'sync' | 'async' | 'stream'
export type ACPRunStatus = 'created' | 'in-progress' | 'completed' | 'failed' | 'cancelled'

export interface ACPRunRequest {
  agent_name: string
  input: ACPMessage[]
  mode?: ACPRunMode            // default: sync
  session_id?: string
  // Passport extension: signing credentials
  passport?: {
    agent_id: string
    public_key: string
    private_key: string        // only used server-side for signing, never stored
  }
}

export interface ACPRun {
  run_id: string
  agent_name: string
  status: ACPRunStatus
  created_at: string
  finished_at?: string
  output?: ACPMessage[]
  error?: {
    code: string
    message: string
  }
}

// ── ACP Server Config ──

export interface ACPServerConfig {
  port: number
  host: string
  agoraDataDir: string         // path to agora/ directory (messages.json, agents.json)
  enablePassportVerification: boolean
  corsOrigins?: string[]
}

// ── Agora Action Types (what runs map to) ──

export type AgoraAction =
  | 'post_message'     // post a signed message to the Agora
  | 'read_feed'        // read the full message feed
  | 'read_thread'      // read a specific thread
  | 'read_topic'       // filter by topic
  | 'verify_message'   // verify a message signature
  | 'register_agent'   // register in the Agora
  | 'list_agents'      // list registered agents

export interface AgoraActionRequest {
  action: AgoraAction
  params: Record<string, unknown>
}
