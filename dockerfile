# ===== 1. Builder 스테이지: Node.js 22 버전 사용 =====
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build
RUN npx tsc --project tsconfig.server.json


# ===== 2. Runner 스테이지: Node.js 22 버전 사용 =====
FROM node:22-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Builder 스테이지에서 빌드 결과물만 복사
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json .

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]