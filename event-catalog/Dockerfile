FROM node:25-alpine           
WORKDIR /event-catalog                  
COPY package*.json ./         
RUN npm install               
COPY . .                             
CMD ["node", "server.js"]     