# Usamos Node.js 20 sobre una versión ligera de Linux (Alpine)
FROM node:20-alpine

# Carpeta de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copiamos archivos de configuración de dependencias
COPY package*.json ./

# Instalamos las dependencias del proyecto
RUN npm install

# Copiamos el resto del código fuente
COPY . .

# Exponemos el puerto de NestJS
EXPOSE 3000

# Comando para ejecutar NestJS en modo desarrollo con auto-recarga (watch)
CMD ["npm", "run", "start:dev"]