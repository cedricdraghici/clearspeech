# Setup Instructions

Complete setup guide for the Sori Translator Chrome extension and backend.

## Prerequisites

- Node.js 14+ installed
- Chrome browser (for testing the extension)
- OpenAI API key ([get one here](https://platform.openai.com/api-keys))

## Backend Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `backend/.env` and set the following:

- `OPENAI_API_KEY=your_openai_api_key_here` - Your OpenAI API key

### 3. Start the Backend

Go into the backend folder:

```bash
cd backend
```

```bash
# Production mode
npm start
```

## Extension Setup

### 1. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the translator-extension folder
5. The extension should now appear in your extensions list

### Test Live Subtitles

1. Go to any webpage that plays audio (YouTube, news sites, podcasts, etc.)
2. Open the extension and toggle Start Listening ON
3. Start the audio on the page
4. A subtitle overlay should appear and update in real time
5. Toggle OFF to stop capturing audio

## Troubleshooting

### "Connection failed" errors

- Verify backend is running (`npm run start` in backend folder)
