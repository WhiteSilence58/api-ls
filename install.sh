#!/bin/bash

echo "🚀 Scoreboard System - Installation"
echo "===================================="

# Check root
if [ "$EUID" -ne 0 ]; then
   echo "⚠️  Bitte als root ausführen (sudo ./install.sh)"
   exit 1
fi

# Install dependencies
echo "📦 Installing system dependencies..."
apt update
apt install -y nodejs npm ffmpeg build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Install npm packages
echo "📦 Installing Node.js packages..."
npm install

# Create directories
echo "📁 Creating directories..."
mkdir -p data
mkdir -p /var/www/html/streams
chown -R www-data:www-data /var/www/html/streams
chmod -R 755 /var/www/html/streams

# Create .env
if [ ! -f .env ]; then
    echo "⚙️  Creating .env file..."
    cp .env.example .env
    echo "✅ .env created - please edit configuration!"
fi

# Create systemd service
echo "🔧 Creating systemd service..."
cat > /etc/systemd/system/scoreboard.service << EOF
[Unit]
Description=Scoreboard System
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node backend/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable scoreboard

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env:        nano .env"
echo "2. Start service:    systemctl start scoreboard"
echo "3. Check status:     systemctl status scoreboard"
echo "4. Open dashboard:   http://localhost:3000"
echo ""