FROM node:25-alpine
WORKDIR /notification
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3002
CMD ["npm", "start"]