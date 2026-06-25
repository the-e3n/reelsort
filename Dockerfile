FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY server server
COPY web web
COPY README.md README.md
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/src server/src
COPY --from=build /app/web/dist web/dist

RUN mkdir -p /app/server/data

EXPOSE 4000
VOLUME ["/app/server/data"]

CMD ["node", "server/src/index.js"]
