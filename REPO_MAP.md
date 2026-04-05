# Daemon Codebase Map
Generated: 2026-04-05T21:07:06+02:00

## File Tree
- android/app/src/main/java/com/daemon/app/DaemonApp.kt
- android/app/src/main/java/com/daemon/app/MainActivity.kt
- android/app/src/main/java/com/daemon/app/service/BootReceiver.kt
- android/app/src/main/java/com/daemon/app/service/CommandExecutor.kt
- android/app/src/main/java/com/daemon/app/service/DaemonService.kt
- android/app/src/main/java/com/daemon/app/ui/chat/ChatScreen.kt
- android/app/src/main/java/com/daemon/app/ui/permissions/PermissionGate.kt
- android/app/src/main/java/com/daemon/app/ui/theme/Theme.kt
- android/app/src/main/java/com/daemon/app/ui/voice/VoiceCompanionScreen.kt
- cli/daemon.mjs
- deploy/container_manager.py
- desktop/build.rs
- desktop/src/commands.rs
- desktop/src/lib.rs
- desktop/src/main.rs
- desktop/src/tray.rs
- desktop/src/ws_client.rs
- dft/__init__.py
- dft/ip5306_testpoints.py
- docs/diagrams/generate.py
- layout/configure_constraints.py
- layout/define_zones.py
- layout/freerouting_dsn.py
- layout/__init__.py
- layout/place_components.py
- netlist/audio_subsystem.py
- netlist/full_system.py
- netlist/gen_golden_netlist.py
- netlist/__init__.py
- protocol/types.ts
- scripts/arrange_clusters.py
- scripts/cleanup_board_display.py
- scripts/create_custom_footprints.py
- scripts/create_kicad_project.py
- scripts/generate_3d_models.py
- scripts/generate_symbols.py
- scripts/import_netlist.py
- scripts/merge_netlists.py
- scripts/prepare_layout_board.py
- scripts/rebuild_board_from_netlist.py
- server/build_memory.py
- server/embed_conversations.py
- server/import_claude_history.py
- server/memory_search.py
- server/users.py
- simulation/__init__.py
- simulation/power_transients.py
- tests/__init__.py
- tests/test_audio_subsystem.py
- tests/test_dft.py
- tests/test_freerouting_dsn.py
- tests/test_full_system.py
- tests/test_golden_netlist.py
- tests/test_layout_constraints.py
- tests/test_power_transients.py
- watch/app/src/main/java/com/daemon/watch/DeviceInfo.kt
- watch/app/src/main/java/com/daemon/watch/LoginActivity.kt
- watch/app/src/main/java/com/daemon/watch/MainActivity.kt
- watch/app/src/main/java/com/daemon/watch/network/DaemonApiClient.kt
- watch/app/src/main/java/com/daemon/watch/service/BootReceiver.kt
- watch/app/src/main/java/com/daemon/watch/service/WatchDaemonService.kt
- watch/app/src/main/java/com/daemon/watch/ui/DaemonWatchScreen.kt
- watch/app/src/main/java/com/daemon/watch/ui/theme/WatchTheme.kt
- watch/app/src/main/java/com/daemon/watch/WatchApp.kt
- web/eslint.config.mjs
- web/next.config.ts
- web/next-env.d.ts
- web/postcss.config.mjs
- web/proxy.js
- web/public/cli/daemon.mjs
- web/src/app/api/auth/route.ts
- web/src/app/api/chat/route.ts
- web/src/app/api/clipboard/route.ts
- web/src/app/api/deploy/route.ts
- web/src/app/api/devices/route.ts
- web/src/app/api/health/route.ts
- web/src/app/api/hosted/[...path]/route.ts
- web/src/app/api/memory/route.ts
- web/src/app/api/me/route.ts
- web/src/app/api/pair/route.ts
- web/src/app/api/projects/[id]/messages/route.ts
- web/src/app/api/projects/route.ts
- web/src/app/api/settings/route.ts
- web/src/app/api/stream/route.ts
- web/src/app/api/threads/[id]/messages/route.ts
- web/src/app/api/threads/route.ts
- web/src/app/canvas/page.tsx
- web/src/app/chat/layout.tsx
- web/src/app/chat/page.tsx
- web/src/app/download/page.tsx
- web/src/app/layout.tsx
- web/src/app/login/page.tsx
- web/src/app/logos/page.tsx
- web/src/app/page.tsx
- web/src/app/settings/page.tsx
- web/src/app/voice/page.tsx
- web/src/components/chat/ActivityIndicator.tsx
- web/src/components/chat/MessageBubble.tsx
- web/src/components/chat/ToolCallBlock.tsx
- web/src/components/DaemonName.tsx
- web/src/components/ProjectSidebar.tsx
- web/src/lib/agent-loop-streaming.ts
- web/src/lib/agent-loop.ts
- web/src/lib/auth.ts
- web/src/lib/db.ts
- web/src/lib/file-verification.ts
- web/src/lib/model-router.ts
- web/src/lib/safety-check.ts
- web/src/lib/sanitize.ts
- web/src/lib/slash-commands.ts
- web/src/lib/streaming.ts
- web/src/lib/verification.ts
- web/src/lib/ws-protocol.ts
- web/src/middleware.ts
- web/src/store/chat.ts
- web/src/store/devices.ts
- web/src/store/projects.ts
- web/ws-server.js

## API Routes
- `/api/auth` — POST
- `/api/chat` — POST
- `/api/clipboard` — POST
- `/api/deploy` — POST,GET
- `/api/devices` — GET,DELETE
- `/api/health` — GET
- `/api/hosted/[...path]` — GET
- `/api/memory` — GET
- `/api/me` — GET
- `/api/pair` — POST
- `/api/projects/[id]/messages` — GET
- `/api/projects` — GET,POST,PUT
- `/api/settings` — GET,PUT
- `/api/stream` — GET
- `/api/threads/[id]/messages` — GET
- `/api/threads` — GET,POST

## Key Exports (web/src/lib/)

### web/src/lib/agent-loop-streaming.ts
```typescript
export async function runAgentLoopStreaming(opts: {
```

### web/src/lib/agent-loop.ts
```typescript
export interface AgentResult {
export async function runAgentLoop(opts: {
export { AGENT_TOOLS, getOrCreateSandbox, destroySandbox, fetchDeviceTools, invokeDeviceTool }
```

### web/src/lib/auth.ts
```typescript
export function requireAuth(req: NextRequest): NextResponse | null {
export async function validateSession(token: string): Promise<{ id: number; email: string; daemon_name: string } | null> {
export async function getUserId(req: NextRequest): Promise<number | null> {
```

### web/src/lib/db.ts
```typescript
export interface Project {
export function listProjects(userId: number): Project[] {
export function getProject(userId: number, projectId: number): Project | undefined {
export function getProjectByName(userId: number, name: string): Project | undefined {
export function createProject(userId: number, data: Partial<Project>): Project {
export function updateProject(userId: number, projectId: number, data: Partial<Project>): boolean {
export function touchProject(projectId: number, userId?: number) {
export interface ChatThread {
export function listThreads(userId: number, projectId?: number): ChatThread[] {
export function getThread(threadId: string): ChatThread | undefined {
export function createThread(userId: number, projectId?: number, title?: string): ChatThread {
export function updateThreadTitle(threadId: string, title: string) {
export function touchThread(threadId: string) {
export interface ChatMessage {
export function listMessages(threadId: string, limit = 100, offset = 0): ChatMessage[] {
```

### web/src/lib/file-verification.ts
```typescript
export interface FileVerificationResult {
export function verifyFile(filePath: string): FileVerificationResult {
export function isSameDeployment(editPath: string, servingDir: string): boolean {
export function listAllMappings(): Array<{ hostname: string; port: number; service: string; directory: string }> {
```

### web/src/lib/model-router.ts
```typescript
export type ModelTier = 'free' | 'mid' | 'premium'
export async function routeChat(opts: {
export { PROVIDERS }
```

### web/src/lib/safety-check.ts
```typescript
export interface SafetyResult {
export async function checkSafety(command: string): Promise<SafetyResult> {
```

### web/src/lib/sanitize.ts
```typescript
export function sanitizeToken(token: string): string | null {
export function sanitizeCommand(cmd: string): string {
export function sanitizeFilePath(path: string): string | null {
```

### web/src/lib/slash-commands.ts
```typescript
export interface SlashCommand {
export const SLASH_COMMANDS: SlashCommand[] = [
export function matchSlashCommand(input: string): { command: SlashCommand; args: string } | null {
export function filterCommands(partial: string): SlashCommand[] {
```

### web/src/lib/streaming.ts
```typescript
export interface SSEEvent {
export function createSSEStream() {
export function parseClaudeStreamLine(line: string): SSEEvent | null {
```

### web/src/lib/verification.ts
```typescript
export interface VerificationResult {
export async function verifyWeb(opts: {
export async function verifyFileUpdated(opts: {
export async function verifyService(opts: {
export async function verifyApk(opts: {
export async function verifyContainer(opts: {
```

### web/src/lib/ws-protocol.ts
```typescript
export interface ContactResult {
export interface WS_SendMessage {
export interface WS_StopSession {
export interface WS_SearchContacts {
export interface WS_ClearChat {
export interface WS_Ping {
export interface WS_ContractSend {
export interface WS_ContractComment {
export interface WS_DocumentSet {
export interface WS_ContractReview {
export interface WS_BrowserAction {
export interface WS_BrowserMouseMove {
export interface WS_BrowserClick {
export interface WS_BrowserScroll {
export interface WS_BrowserKeyDown {
```

## Protocol Types

### protocol/types.ts
```typescript
export const PROTOCOL_VERSION = '0' as const
export interface DeviceCapabilities {
export interface BaseMessage {
export interface AuthHello extends BaseMessage {
export interface AuthSession extends BaseMessage {
export interface DeviceState {
export interface DeviceHeartbeat extends BaseMessage {
export interface HeartbeatAck extends BaseMessage {
export interface DeviceInvoke extends BaseMessage {
export interface CommandResult {
export interface DeviceResult extends BaseMessage {
export interface ToolInputSchema {
export interface ToolDefinition {
export interface SkillList extends BaseMessage {
export interface SkillListResult extends BaseMessage {
export interface SkillInvoke extends BaseMessage {
export interface SkillResult extends BaseMessage {
export interface ClipboardUpdate extends BaseMessage {
export interface FileTransfer extends BaseMessage {
export interface ErrorMessage extends BaseMessage {
```

## Components (web/src/)
- `web/src/app/canvas/page.tsx` — default function DaemonCanvas
- `web/src/app/chat/layout.tsx` — const dynamic = 'force-dynamic'
- `web/src/app/chat/page.tsx` — default function DaemonChat
- `web/src/app/download/page.tsx` — default function DownloadPage
- `web/src/app/layout.tsx` — const metadata: Metadata = 
default function RootLayout
- `web/src/app/login/page.tsx` — default function LoginPage
- `web/src/app/logos/page.tsx` — default function LogosPage
- `web/src/app/page.tsx` — default function Page
- `web/src/app/settings/page.tsx` — default function SettingsPage
- `web/src/app/voice/page.tsx` — default function VoicePage
- `web/src/components/chat/ActivityIndicator.tsx` — function ActivityIndicator
- `web/src/components/chat/MessageBubble.tsx` — function MessageBubble
- `web/src/components/chat/ToolCallBlock.tsx` — function ToolCallBlock
- `web/src/components/DaemonName.tsx` — default function DaemonName
- `web/src/components/ProjectSidebar.tsx` — default function ProjectSidebar

## CLI & Device Bridges
- `cli/daemon.mjs`
- `desktop/src/commands.rs`
- `desktop/src/lib.rs`
- `desktop/src/main.rs`
- `desktop/src/tray.rs`
- `desktop/src/ws_client.rs`
