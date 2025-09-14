# Etap 1: build aplikacji
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Etap 2: serwowanie przez nginx
FROM nginx:alpine

# Usuń domyślną konfigurację
RUN rm /etc/nginx/conf.d/default.conf

# Skopiuj własną konfigurację nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Skopiuj zbudowaną aplikację do katalogu serwowanego przez nginx
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
