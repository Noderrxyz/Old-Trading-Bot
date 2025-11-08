# ---- Builder Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including dev)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the Next.js app (static export or SSR)
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built app from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/package.json ./package.json

# Create non-root user and use it
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose Next.js port (default 3000)
EXPOSE 3000

# Healthcheck (adjust endpoint as needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Start the Next.js app (SSR or static)
CMD ["npm", "start"]

# ---- Documentation ----
# Build: docker build -t noderr-frontend .
# Run:   docker run -p 3000:3000 noderr-frontend 