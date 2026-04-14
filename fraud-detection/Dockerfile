FROM node:20-alpine

WORKDIR /fraud-detection

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]