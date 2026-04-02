FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    openssh-client curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash daemonuser 2>/dev/null || true
WORKDIR /app

# Copy the entire web directory (pre-built)
COPY --chown=daemonuser:daemonuser web/ ./web/

# Copy Python server
COPY --chown=daemonuser:daemonuser server/ ./server/
COPY --chown=daemonuser:daemonuser SOUL.md ./
COPY --chown=daemonuser:daemonuser config/ ./config/

# Python venv for knowledge graph
RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir \
    qdrant-client google-genai

USER daemonuser
EXPOSE 4800

HEALTHCHECK --interval=30s --timeout=5s \
    CMD curl -f http://localhost:4800/ || exit 1

WORKDIR /app/web
CMD ["npx", "next", "start", "-p", "4800"]
