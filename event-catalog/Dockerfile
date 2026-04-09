FROM node:25-alpine           
WORKDIR /event-catalog                  
COPY package*.json ./         
RUN npm install               
COPY . .                      
EXPOSE 8000                   
CMD ["npm", "start"]     