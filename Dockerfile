# Local production-mode image for `docker compose up`. Vercel builds the app
# itself and does not use this file.
FROM node:24-alpine
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dev dependencies are kept: the Prisma CLI runs migrations at container start.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:docker"]
