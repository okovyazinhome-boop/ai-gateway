FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV FILES_DIR=/app/public/files

COPY package*.json ./
RUN npm install --omit=dev
RUN apk add --no-cache ffmpeg

COPY src ./src

RUN mkdir -p /app/public/files

EXPOSE 3000

CMD ["node", "src/server.js"]
