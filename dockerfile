# Gunakan image Node.js versi terbaru yang stabil
FROM node:20-slim

# Tambahkan 'git' ke dalam daftar instalasi
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Tentukan folder kerja
WORKDIR /app

# Salin file package.json
COPY package*.json ./

# Install dengan flag legacy-peer-deps
RUN npm install --legacy-peer-deps

# Salin semua file bot
COPY . .

# Jalankan bot
CMD ["node", "index.js"]