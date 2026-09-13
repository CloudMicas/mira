# ===== Backend: mira-server =====
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package 文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./

# 安装依赖（包含 devDependencies 用于 tsc 编译）
RUN npm install

# 复制源码
COPY tsconfig.json ./
COPY src ./src

# 编译 TypeScript → dist/
RUN npm run build

# ===== 运行阶段 =====
FROM node:20-alpine

WORKDIR /app

# 只复制 package.json 和编译产物
COPY package.json ./
COPY --from=builder /app/dist ./dist

# 只装生产依赖
RUN npm install --omit=dev

# 环境变量默认值（可在 compose 中覆盖）
ENV NODE_ENV=production
ENV PORT=3001
ENV MOCK=0

EXPOSE 3001

CMD ["node", "dist/server.js"]
