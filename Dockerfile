FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

CMD ["bash"]
