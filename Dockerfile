FROM node:24-alpine AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4320
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","4320"]
