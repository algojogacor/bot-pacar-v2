# Gunakan image Node.js versi terbaru yang stabil (berbasis Linux)
FROM node:20-slim

# Install tools yang dibutuhkan untuk mengompilasi modul C++ (seperti hnswlib)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Tentukan folder kerja di dalam kontainer
WORKDIR /app

# Salin file package.json (dan lockfile jika ada)
COPY package*.json ./

# Install semua dependencies (proses compile akan terjadi di sini)
RUN npm install

# Salin semua file bot kamu ke dalam kontainer
COPY . .

# Jalankan bot
CMD ["node", "index.js"]