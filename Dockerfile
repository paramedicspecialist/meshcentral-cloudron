FROM ghcr.io/ylianst/meshcentral:1.3.1-postgresql

USER root

RUN apk add --no-cache su-exec openssl \
    && mkdir -p /app/pkg /app/data \
    && if ! grep -q '^[^:]*:[^:]*:1000:' /etc/passwd; then \
           adduser -D -u 1000 -h /tmp cloudron; \
       fi \
    && chown 1000:1000 /app/data

ENV HOME=/tmp

COPY scripts/install-runtime-modules.js /tmp/install-runtime-modules.js
WORKDIR /opt/meshcentral/meshcentral
RUN node /tmp/install-runtime-modules.js meshcentral.js

COPY start.sh configure.js cert-listener.js /app/pkg/
RUN chmod 755 /app/pkg/start.sh \
    && chmod 644 /app/pkg/configure.js /app/pkg/cert-listener.js

ENV NODE_ENV=production \
    CONFIG_FILE=/app/data/meshcentral-data/config.json \
    DYNAMIC_CONFIG=false \
    NODE_PATH=/opt/meshcentral/meshcentral/node_modules

EXPOSE 8080

ENTRYPOINT ["/app/pkg/start.sh"]
