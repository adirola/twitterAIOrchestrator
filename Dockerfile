FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

RUN npm install
RUN npm run build

EXPOSE 4000

CMD ["npm", "start"]