FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY server ./server
COPY drizzle ./drizzle
ENV NODE_ENV=production DATABASE_PATH=/data/classquiz.db
VOLUME /data
EXPOSE 3000
CMD ["bun", "server/index.ts"]
