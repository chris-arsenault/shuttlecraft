FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
    git \
    openssh-client \
    nodejs \
    npm \
    tini \
  && rm -rf /var/lib/apt/lists/*

# 7321 is a deliberately unusual UID/GID to avoid colliding with the
# ~1000 range that most consumer apps claim. Must match the ownership
# of the TrueNAS dataset bind-mounted at /home/dev.
ARG DEV_UID=7321
ARG DEV_GID=7321
RUN groupadd --gid ${DEV_GID} dev \
  && useradd --uid ${DEV_UID} --gid ${DEV_GID} --shell /bin/bash --home-dir /home/dev dev \
  && mkdir -p /run/shuttlecraft /opt/shuttlecraft/hooks \
  && chown -R dev:dev /run/shuttlecraft

COPY dist/shuttlecraft /usr/local/bin/shuttlecraft
COPY hooks/session-start.sh /opt/shuttlecraft/hooks/session-start.sh
COPY entrypoint.sh /opt/shuttlecraft/entrypoint.sh
RUN chmod +x /opt/shuttlecraft/hooks/session-start.sh /opt/shuttlecraft/entrypoint.sh

USER dev
WORKDIR /home/dev

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/shuttlecraft/entrypoint.sh"]
