#!/bin/bash

echo "🚀 Starting Korean→English Translation Backend..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo ""
    echo "❌ ERROR: Please edit backend/.env and add your OPENAI_API_KEY"
    echo "   Get your key from: https://platform.openai.com/api-keys"
    echo ""
    exit 1
fi

# Check if OPENAI_API_KEY is set
if ! grep -q "OPENAI_API_KEY=sk-" .env; then
    echo "❌ ERROR: OPENAI_API_KEY not configured in .env"
    echo "   Please edit backend/.env and add your OpenAI API key"
    echo "   Get your key from: https://platform.openai.com/api-keys"
    echo ""
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Start the server
echo "✅ Starting server..."
node server.js
