# Daemon Platform Architecture

Detailed architecture diagrams for the Daemon multi-device AI agent platform.

---

## 1. System Overview

```mermaid
graph TB
    subgraph Users
        U1[Web Browser]
        U2[Android App]
        U3[Desktop App<br/>Tauri v2]
        U4[CLI Bridge<br/>Node.js]
    end

    subgraph Cloudflare
        CF[Cloudflare Tunnel<br/>daemon.page / my.daemon.page]
    end

    subgraph "arturito server (Ubuntu 24.04)"
        PROXY[proxy.js :4800<br/>HTTP / WS / Voice router]

        subgraph "Core Services"
            NEXT[Next.js 16<br/>Web UI :4802]
            WS[WebSocket Server<br/>:4801]
            VOICE[Voice Server<br/>:4803]
            PY[Python Backend<br/>memory / personality / KG]
        end

        subgraph "Data Stores"
            SQLITE[(SQLite<br/>users.db)]
            QDRANT[(Qdrant<br/>:6333 Docker)]
        end

        subgraph "AI Model Router"
            FREE[Qwen3-Coder<br/>via OpenRouter]
            MID[DeepSeek<br/>API]
            PREMIUM[Claude Opus<br/>Max CLI local]
        end

        DOCKER[Docker Sandbox<br/>Agent tool execution]
    end

    U1 & U2 & U3 & U4 --> CF
    CF --> PROXY
    PROXY -->|HTTP| NEXT
    PROXY -->|WS| WS
    PROXY -->|Voice| VOICE
    NEXT --> PY
    WS --> PY
    PY --> SQLITE
    PY --> QDRANT
    PY -->|free tier| FREE
    PY -->|mid tier| MID
    PY -->|premium tier| PREMIUM
    PY --> DOCKER
```

---

## 2. Device Mesh

```mermaid
graph TB
    subgraph "Daemon Server"
        WS_SRV[WebSocket Server<br/>wss://my.daemon.page/ws/device]
        PAIR[Pairing Service<br/>6-char codes]
        CLIP[Clipboard Sync<br/>Broadcast]
        REG[Device Registry<br/>SQLite]
    end

    subgraph "User's Devices"
        PHONE[Android App<br/>Kotlin bridge]
        DESK[Desktop App<br/>Tauri bridge]
        CLI[CLI Bridge<br/>Node.js]
        BROWSER[Web UI<br/>browser-only, no bridge]
    end

    PHONE -->|WSS| WS_SRV
    DESK -->|WSS| WS_SRV
    CLI -->|WSS| WS_SRV

    WS_SRV --> REG
    PAIR --> REG

    subgraph "Bridge Capabilities"
        SHELL[Shell Execution]
        FILES[File Read/Write]
        CLIPB[Clipboard Access]
        INFO[Device Info]
    end

    PHONE & DESK & CLI -.->|provides| SHELL & FILES & CLIPB & INFO

    WS_SRV -->|clipboard update| CLIP
    CLIP -->|broadcast to<br/>same user| PHONE & DESK & CLI

    subgraph "Pairing Flow"
        direction LR
        P1[Device requests code] --> P2[Server generates<br/>6-char code]
        P2 --> P3[User enters code<br/>on another device]
        P3 --> P4[Devices linked<br/>to same user]
    end
```

---

## 3. Chat Message Flow

```mermaid
sequenceDiagram
    actor User
    participant App as App<br/>(Web/Android/Desktop)
    participant Proxy as proxy.js<br/>:4800
    participant Server as Daemon Server
    participant Router as Model Router
    participant AI as AI Model
    participant Sandbox as Docker Sandbox
    participant DB as SQLite
    participant Memory as Memory System

    User->>App: Type message
    App->>Proxy: POST /api/chat<br/>(auth cookie)
    Proxy->>Server: Route HTTP request

    Server->>DB: Verify auth + load user
    Server->>Server: Check user tier<br/>(free/mid/premium)

    alt Free Tier
        Server->>Router: Route to Qwen3-Coder
        Router->>AI: OpenRouter API call
    else Mid Tier
        Server->>Router: Route to DeepSeek
        Router->>AI: DeepSeek API call
    else Premium Tier
        Server->>Router: Route to Claude Opus
        Router->>AI: Local Claude CLI invocation
    end

    loop Agent Loop (if tools needed)
        AI->>Sandbox: Execute tool in sandbox
        Sandbox-->>AI: Tool result
    end

    AI-->>Server: Response stream
    Server-->>App: SSE stream response
    App-->>User: Display response

    Server->>DB: Persist message + response<br/>(chat_messages)
    Server->>DB: Log usage<br/>(usage_log)
    Server->>Memory: Trigger async summarization
```

---

## 4. Memory System

```mermaid
graph TB
    subgraph "Input"
        CONV[Conversation<br/>chat_messages table]
    end

    subgraph "Summarization Pipeline"
        GEMINI_FLASH[Gemini Flash<br/>Summarizer]
        SUMMARY[Structured Summary<br/>TLDR + decisions +<br/>facts + problems + solutions]
    end

    subgraph "Embedding Pipeline"
        GEMINI_EMB[Gemini<br/>embedding-001]
        VECTORS[Vector Embeddings]
    end

    subgraph "Storage"
        SQLITE_MEM[(SQLite<br/>conversation_memory)]
        QDRANT_MEM[(Qdrant<br/>daemon_memory collection)]
    end

    subgraph "Retrieval"
        VEC_SEARCH[Vector Search<br/>Qdrant similarity]
        TEXT_SEARCH[Text Search<br/>SQLite LIKE]
        CONTEXT[Combined Memory<br/>Context]
    end

    subgraph "Usage"
        PROJ_SWITCH[Project Switch<br/>auto-load context]
        CHAT[New Chat Message<br/>inject relevant memory]
    end

    CONV -->|after conversation| GEMINI_FLASH
    GEMINI_FLASH --> SUMMARY
    SUMMARY --> SQLITE_MEM
    SUMMARY --> GEMINI_EMB
    GEMINI_EMB --> VECTORS
    VECTORS --> QDRANT_MEM

    QDRANT_MEM --> VEC_SEARCH
    SQLITE_MEM --> TEXT_SEARCH
    VEC_SEARCH & TEXT_SEARCH --> CONTEXT

    CONTEXT --> PROJ_SWITCH
    CONTEXT --> CHAT
```

---

## 5. Infrastructure

```mermaid
graph TB
    subgraph "Internet"
        USERS[Users]
        CF_EDGE[Cloudflare Edge]
    end

    subgraph "Cloudflare Tunnel"
        TUNNEL[cloudflared<br/>daemon.page<br/>my.daemon.page<br/>*.daemon.page]
    end

    subgraph "arturito (Ubuntu 24.04, 24C/32GB)"
        subgraph "Port 4800 — proxy.js"
            direction LR
            HTTP_R[HTTP Routes] -->|/| NEXT_P[Next.js :4802]
            WS_R[WS Routes] -->|/ws/*| WS_P[ws-server :4801]
            VOICE_R[Voice Routes] -->|/voice/*| VOICE_P[voice-server :4803]
        end

        subgraph "Python Backend"
            MEM_SVC[Memory Service]
            PERS_SVC[Personality Service]
            KG_SVC[Knowledge Graph]
        end

        subgraph "Data Layer"
            SQLITE_DB[(SQLite<br/>/home/arthur/daemon/<br/>data/users.db)]
            QDRANT_DB[(Qdrant Docker<br/>localhost:6333)]
        end

        subgraph "Docker"
            SANDBOX[Agent Sandbox<br/>isolated execution]
            QDRANT_C[Qdrant Container]
        end

        subgraph "systemd Services"
            SVC1[daemon-web.service<br/>Next.js + proxy]
            SVC2[daemon-ws.service<br/>WebSocket server]
            SVC3[daemon-qdrant<br/>Docker container]
        end
    end

    subgraph "External APIs"
        OR[OpenRouter<br/>Qwen3-Coder]
        DS[DeepSeek API]
        STRIPE[Stripe<br/>Payments]
        GEMINI[Gemini API<br/>Embeddings + Summaries]
    end

    USERS --> CF_EDGE
    CF_EDGE --> TUNNEL
    TUNNEL -->|:4800| HTTP_R & WS_R & VOICE_R

    NEXT_P & WS_P --> MEM_SVC & PERS_SVC & KG_SVC
    MEM_SVC --> SQLITE_DB & QDRANT_DB
    KG_SVC --> SQLITE_DB
```

---

## 6. Billing Flow

```mermaid
graph TB
    subgraph "User Tiers"
        FREE_T[Free Tier<br/>Qwen, 50 msg/day<br/>+ BYOK]
        PRO_T[Pro Tier<br/>$10/mo + $5 credits<br/>All models, managed]
    end

    subgraph "Request Processing"
        REQ[Incoming Request]
        AUTH[Auth Check]
        TIER[Tier Detection]
        LIMIT[Rate Limiter<br/>50/day for free]
        ROUTE[Model Router]
    end

    subgraph "Usage Tracking"
        LOG[(usage_log table<br/>model, tokens,<br/>cost, timestamp)]
        DAILY[Daily Aggregation]
        MONTHLY[Monthly Totals]
    end

    subgraph "Payment Processing"
        STRIPE_SUB[Stripe<br/>Subscription $10/mo]
        STRIPE_USAGE[Stripe<br/>Usage-based billing]
        COINBASE[Coinbase Commerce<br/>USDC payments]
    end

    subgraph "BYOK (Free Tier)"
        USER_KEY[User's Own API Key]
        DIRECT[Direct API Call<br/>no daemon billing]
    end

    REQ --> AUTH --> TIER

    TIER -->|free| LIMIT
    TIER -->|pro| ROUTE

    LIMIT -->|under limit| ROUTE
    LIMIT -->|over limit| FREE_T

    ROUTE -->|each request| LOG
    LOG --> DAILY --> MONTHLY

    MONTHLY -->|subscription| STRIPE_SUB
    MONTHLY -->|overage credits| STRIPE_USAGE
    MONTHLY -->|crypto option| COINBASE

    FREE_T -->|BYOK mode| USER_KEY --> DIRECT
```
