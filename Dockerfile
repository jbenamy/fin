FROM 1password/op:2.42.0 AS op

FROM node:26.13.0-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.5.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
# dist/ = the server (tsc) + dist/web, the Svelte app (Vite)
RUN pnpm build && CI=true pnpm prune --prod

FROM node:26.13.0-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# 1Password CLI for fin-entrypoint.sh; op (Go) needs the CA bundle that node:slim leaves out
COPY --from=op /usr/local/bin/op /usr/local/bin/op
COPY --from=op /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=755 fin-entrypoint.sh /usr/local/bin/
# Nothing at runtime uses npm; removing it also removes its bundled dependencies' advisories
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["fin-entrypoint.sh"]
CMD ["node", "dist/server.js"]
