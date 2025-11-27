const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow all origins for Chrome extension
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    openaiConfigured: !!process.env.OPENAI_API_KEY
  });
});

// Generate ephemeral token for OpenAI Realtime API
app.post('/api/realtime-token', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'OpenAI API key not configured'
      });
    }

    // Create an ephemeral session token by calling OpenAI's Realtime session endpoint
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-realtime-preview-2024-12-17',
        voice: 'alloy',
        modalities: ['audio', 'text'],  // STT-only mode (no text generation/chat)
        instructions: 'Transcribe English speech EXACTLY as you hear it. Do NOT add words, explanations, or rewrite anything. Only output the spoken English text.',
        temperature: 0.6
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Realtime session creation failed:', response.status, errorText);
      return res.status(response.status).json({
        error: `Failed to create Realtime session: ${response.status}`,
        details: errorText
      });
    }

    const sessionData = await response.json();
    console.log('Realtime session created:', sessionData.id);

    // Return the client secret and session details to the extension
    res.json({
      sessionId: sessionData.id,
      clientSecret: sessionData.client_secret?.value || sessionData.client_secret,
      expiresAt: sessionData.expires_at || sessionData.client_secret?.expires_at || Date.now() + 60000
    });

  } catch (error) {
    console.error('Error generating Realtime token:', error);
    res.status(500).json({
      error: 'Failed to generate Realtime session token',
      message: error.message
    });
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`ClearSpeech Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
