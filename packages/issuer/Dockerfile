# The self-hosted Pidgeon issuer (`@pidgeon-ai/issuer`).
#
#   docker build -f packages/issuer/Dockerfile -t pidgeon-issuer .
#   docker run -p 8080:8080 \
#     -v $PWD/issuer.json:/etc/pidgeon-issuer/issuer.json:ro \
#     -v $PWD/pidgeon-issuer-key.json:/etc/pidgeon-issuer/pidgeon-issuer-key.json:ro \
#     pidgeon-issuer
#
# Built from the repository root (the pnpm workspace; the public mirror has
# no lockfile, so none is required). The image holds the
# bundle and Node, nothing else: no key, no config. Both are mounted.

FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false --filter "@pidgeon-ai/issuer..." \
 && pnpm --filter @pidgeon-ai/id build \
 && pnpm --filter @pidgeon-ai/issuer build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/packages/issuer/dist ./dist
COPY --from=build /src/packages/issuer/package.json ./package.json
# The AWS SDK, for an issuer whose key is in KMS: the library's optional peer,
# installed beside the bundle at the version range the package names.
RUN npm install --prefix /tmp/kms --no-save --no-audit --no-fund \
      "@aws-sdk/client-kms@$(node -p "require('./package.json').peerDependencies['@aws-sdk/client-kms']")" \
 && mv /tmp/kms/node_modules ./node_modules && rm -rf /tmp/kms
ENV NODE_ENV=production \
    PORT=8080 \
    PIDGEON_ISSUER_CONFIG=/etc/pidgeon-issuer/issuer.json
USER node
EXPOSE 8080
ENTRYPOINT ["node", "/app/dist/bin.js"]
CMD ["serve"]
