# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Создаем директорию для базы данных и устанавливаем права
RUN mkdir -p /app/data && chown -R node:node /app

# Переключаемся на пользователя node для безопасности
USER node

# Открываем порт
EXPOSE 3000

# Устанавливаем переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3000

# Запускаем приложение
CMD ["npm", "start"]
