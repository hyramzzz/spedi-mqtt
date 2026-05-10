FROM node:20-alpine AS base
WORKDIR /app

# Stage 1: Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# We build BOTH the Next.js frontend and the Fastify backend
RUN npm run build:frontend
RUN npm run build:backend

# Stage 3: Production runner
FROM base AS runner
ENV NODE_ENV=production
# Expose Next.js port (typically 3000) and Fastify port (typically 3001)
# Note: Railway injects PORT environment variable.
EXPOSE 3000
EXPOSE 3001

# Copy built artifacts and necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/dist ./dist
# Fastify depends on node_modules so we copy production modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/start.js ./
RUN npm ci --omit=dev

# Start command
CMD ["node", "start.js"]
