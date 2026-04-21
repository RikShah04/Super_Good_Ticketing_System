FROM node:22-alpine           
WORKDIR /event-catalog                  
COPY package*.json ./         
RUN npm install               
COPY . .                  
EXPOSE 3005           
CMD ["npm", "start"]     