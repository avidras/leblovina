# Pin a specific PocketBase version — never :latest (see CLAUDE.md).
# Bump PB_VERSION deliberately and test migrations before committing.
ARG PB_VERSION=0.39.1

FROM alpine:3.20 AS build
ARG PB_VERSION
# TARGETARCH is provided by buildkit (amd64 / arm64) — matches PocketBase asset names,
# so the image runs natively on both Apple Silicon and x86 without emulation.
ARG TARGETARCH
RUN apk add --no-cache ca-certificates unzip wget
WORKDIR /pb
RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O pb.zip \
    && unzip pb.zip \
    && rm pb.zip

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /pb
COPY --from=build /pb/pocketbase /pb/pocketbase

EXPOSE 8090
# --dir holds the SQLite data; migrations/hooks are bind-mounted via compose.
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
