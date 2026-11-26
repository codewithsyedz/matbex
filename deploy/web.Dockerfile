# Static web app: Vite build served by nginx with SPA fallback.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
ARG VITE_API_URL
ARG VITE_API_KEY
ENV VITE_API_URL=$VITE_API_URL VITE_API_KEY=$VITE_API_KEY
RUN npx vite build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
