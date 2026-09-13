# ===== Frontend: mira-web =====
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package 文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./

RUN npm install

# 复制源码
COPY tsconfig.json tsconfig.*.json ./
COPY index.html ./
COPY src ./src
COPY public ./public

# 构建（tsc 类型检查 + vite build → dist/）
RUN npm run build

# ===== Nginx 静态服务 =====
FROM nginx:alpine

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 自定义 nginx 配置：SPA 路由 + WebSocket 反代到后端
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA 路由：所有非文件请求回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源长缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|motion3\.json|model3\.json|physics3\.json|moc3)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket 反代到后端
    location /ws {
        proxy_pass http://mira-server:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
EOF

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
