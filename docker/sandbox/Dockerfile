FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git jq tree ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 for JS execution
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Common Python packages
RUN pip install --no-cache-dir requests httpx numpy

RUN useradd -m -s /bin/bash user
USER user
WORKDIR /home/user

# Keep container alive
CMD ["sleep", "3600"]
