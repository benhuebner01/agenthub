FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS client-deps
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci

FROM node:20-alpine AS client-build
WORKDIR /app
COPY --from=client-deps /app/client/node_modules ./client/node_modules
COPY client/ ./client/
RUN cd client && npm run build

FROM node:20-alpine AS ts-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY --from=deps /app/node_modules ./node_modules
COPY --from=ts-build /app/dist ./dist
COPY --from=client-build /app/public ./public
COPY package.json ./
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "dist/index.js"]
