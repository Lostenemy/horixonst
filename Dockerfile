# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --production && npm cache clean --force

COPY . .

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/server.js"]
