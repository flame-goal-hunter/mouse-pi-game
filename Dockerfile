FROM node:20-alpine

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy PWA static frontend and Colyseus server
COPY www ./www
COPY src ./src
COPY public ./public
COPY server ./server
COPY tools ./tools

# Stamp service worker cache version
RUN node tools/stamp_sw.mjs || true

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/src/index.js"]
