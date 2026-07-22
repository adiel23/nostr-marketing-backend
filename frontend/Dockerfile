FROM node:24-alpine AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/app/dist /usr/share/nginx/html
COPY runtime-config.js.template /usr/share/nginx/html/templates/runtime-config.js.template
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/usr/share/nginx/html/templates
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
