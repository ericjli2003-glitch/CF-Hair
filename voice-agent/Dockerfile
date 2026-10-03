# Build from the repository root so shared/salon.json is available:
#   docker build -f voice-agent/Dockerfile -t cf-hair-voice-agent .
FROM node:22-slim AS build
WORKDIR /app/voice-agent
COPY voice-agent/package.json voice-agent/package-lock.json ./
RUN npm ci
COPY voice-agent/tsconfig.json voice-agent/tsconfig.build.json ./
COPY voice-agent/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app/voice-agent
COPY --from=build /app/voice-agent/node_modules ./node_modules
COPY --from=build /app/voice-agent/dist ./dist
COPY voice-agent/package.json ./
COPY shared/salon.json /app/shared/salon.json
RUN mkdir -p logs data && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
