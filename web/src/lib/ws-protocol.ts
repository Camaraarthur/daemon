// ============================================================================
// Arturito BD Stable — WebSocket Protocol
// Stripped down to: chat, contacts, tools. Nothing else.
// ============================================================================

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface ContactResult {
  id: string;
  name: string;
  email?: string;
  company?: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Client -> Server messages
// ---------------------------------------------------------------------------

export interface WS_SendMessage {
  type: "chat:send";
  content: string;
  conversationId?: string;
}

export interface WS_StopSession {
  type: "chat:stop";
}

export interface WS_SearchContacts {
  type: "contacts:search";
  query: string;
  limit?: number;
}

export interface WS_ClearChat {
  type: "chat:clear";
}

export interface WS_Ping {
  type: "ping";
}

// Contract mode messages
export interface WS_ContractSend {
  type: "contract:send";
  content: string;
  documentContent?: string;  // current state of the contract document
}

export interface WS_ContractComment {
  type: "contract:comment";
  comment: string;
  lineRange?: [number, number];
  documentContent?: string;
}

// Direct document content push — sets the document panel content immediately
export interface WS_DocumentSet {
  type: "document:set";
  content: string;
  title?: string;
}

export interface WS_ContractReview {
  type: "contract:review";
  scores: Record<string, number>;
  overall_score: number;
  issues: Array<{ severity: string; dimension: string; description: string; suggestion: string }>;
  strengths: string[];
  missing_clauses: string[];
  summary: string;
}

export interface WS_BrowserAction {
  type: "browser:action";
  action: string;
  payload?: Record<string, unknown>;
}

export interface WS_BrowserMouseMove {
  type: "browser:mousemove";
  x: number;
  y: number;
  session_id?: string;
}

export interface WS_BrowserClick {
  type: "browser:click";
  x: number;
  y: number;
  session_id?: string;
}

export interface WS_BrowserScroll {
  type: "browser:scroll";
  direction: "up" | "down";
  amount: number;
  session_id?: string;
}

export interface WS_BrowserKeyDown {
  type: "browser:keydown";
  key: string;
  session_id?: string;
}

export interface WS_BrowserType {
  type: "browser:type";
  text: string;
  session_id?: string;
}

export interface WS_BrowserNavigate {
  type: "browser:navigate";
  url: string;
  session_id?: string;
}

export interface WS_BrowserBack {
  type: "browser:back";
  session_id?: string;
}

export interface WS_BrowserForward {
  type: "browser:forward";
  session_id?: string;
}

export interface WS_BrowserClose {
  type: "browser:close";
  session_id?: string;
}

export interface WS_WebRTCRequest {
  type: "browser:webrtc:request";
}

export interface WS_WebRTCAnswer {
  type: "browser:webrtc:answer";
  sdp: string;
}

export interface WS_WebRTCClientIce {
  type: "browser:webrtc:ice";
  candidate: string;
  sdpMLineIndex: number;
}

export type ClientMessage =
  | WS_SendMessage
  | WS_StopSession
  | WS_ClearChat
  | WS_SearchContacts
  | WS_ContractSend
  | WS_ContractComment
  | WS_BrowserAction
  | WS_BrowserMouseMove
  | WS_BrowserClick
  | WS_BrowserScroll
  | WS_BrowserKeyDown
  | WS_BrowserType
  | WS_BrowserNavigate
  | WS_BrowserBack
  | WS_BrowserForward
  | WS_BrowserClose
  | WS_WebRTCRequest
  | WS_WebRTCAnswer
  | WS_WebRTCClientIce
  | WS_Ping;

// ---------------------------------------------------------------------------
// Server -> Client messages
// ---------------------------------------------------------------------------

export interface WS_AssistantText {
  type: "assistant:text";
  content: string;
}

export interface WS_AssistantThinking {
  type: "assistant:thinking";
  content: string;
}

export interface WS_AssistantToolCall {
  type: "assistant:tool_call";
  name: string;
  input: unknown;
}

export interface WS_AssistantToolResult {
  type: "assistant:tool_result";
  name: string;
  output: unknown;
}

export interface WS_SessionDone {
  type: "session:done";
  success: boolean;
  error?: string;
}

export interface WS_SessionInit {
  type: "session:init";
  sessionId: string;
}

export interface WS_ContactsResults {
  type: "contacts:results";
  contacts: ContactResult[];
  query: string;
}

export interface WS_UserInfo {
  type: "user:info";
  email: string;
}

export interface WS_ChatHistory {
  type: "chat:history";
  messages: Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    created_at: string;
  }>;
}

export interface WS_ChatCleared {
  type: "chat:cleared";
}

export interface WS_AssistantVerification {
  type: "assistant:verification";
  claims: Array<{
    claim: string;
    status: "verified" | "unverified" | "flagged" | "stale";
    source?: string;
    note?: string;
  }>;
  overall_status: "clean" | "has_flags" | "error";
  auditor_notes: string[];
  duration_ms: number;
}

export interface WS_AssistantVerifying {
  type: "assistant:verifying";
}

export interface WS_Error {
  type: "error";
  message: string;
}

export interface WS_Pong {
  type: "pong";
}

export interface WS_BrowserState {
  type: "browser:state";
  active: boolean;
  url?: string;
  title?: string;
}

export interface WS_WebRTCOffer {
  type: "browser:webrtc:offer";
  sdp: string;
}

export interface WS_WebRTCServerIce {
  type: "browser:webrtc:ice:server";
  candidate: string;
  sdpMLineIndex: number;
  sdpMid: string;
}

export type ServerMessage =
  | WS_AssistantText
  | WS_AssistantThinking
  | WS_AssistantToolCall
  | WS_AssistantToolResult
  | WS_AssistantVerification
  | WS_AssistantVerifying
  | WS_DocumentSet
  | WS_ContractReview
  | WS_SessionDone
  | WS_SessionInit
  | WS_UserInfo
  | WS_ChatHistory
  | WS_ChatCleared
  | WS_ContactsResults
  | WS_BrowserState
  | WS_WebRTCOffer
  | WS_WebRTCServerIce
  | WS_Error
  | WS_Pong;
