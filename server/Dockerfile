# Zolo API — Express + Prisma + PostgreSQL.
FROM node:20-alpine

WORKDIR /app

# System deps: openssl is required by Prisma's query engine on alpine.
RUN apk add --no-cache openssl postgresql-client

# Install dependencies (cached unless package files change).
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Prisma schema first so `prisma generate` can run before the rest of the source.
COPY prisma ./prisma
RUN npx prisma generate

# App source.
COPY . .

# Ensure the uploads dir exists (also a mounted volume in compose).
RUN mkdir -p uploads && chmod +x docker-entrypoint.sh

EXPOSE 5001

ENTRYPOINT ["./docker-entrypoint.sh"]
