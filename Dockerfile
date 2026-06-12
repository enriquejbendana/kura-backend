FROM ghcr.io/puppeteer/puppeteer:latest
USER root
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npx puppeteer browsers install chrome
COPY . .
EXPOSE 3001
CMD ["node", "index.js"]
