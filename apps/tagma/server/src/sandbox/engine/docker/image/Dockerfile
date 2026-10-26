FROM oven/bun@sha256:7e8ed3961db1cdedf17d516dda87948cfedbd294f53bf16462e5b57ed3fff0f1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ripgrep git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /work /home/guest && chown 65534:65534 /work /home/guest

COPY helper.ts /opt/tagma/guest.ts
COPY proxy.ts /opt/tagma/proxy.ts
RUN chmod 0444 /opt/tagma/guest.ts /opt/tagma/proxy.ts && chmod 0555 /opt/tagma

ENV HOME=/home/guest
WORKDIR /work
USER 65534:65534

CMD ["sleep", "infinity"]
