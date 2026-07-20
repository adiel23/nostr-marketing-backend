FROM node:24-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Exponemos el puerto del frontend (Vite suele usar el 5173, cámbialo si usas otro)
EXPOSE 5173

CMD ["npm", "run", "dev"]