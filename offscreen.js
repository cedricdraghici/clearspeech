// Offscreen document for OpenAI Realtime API WebSocket streaming
// Captures tab audio → converts to PCM → streams via WebSocket → receives English transcription

let audioContext = null;
let mediaStreamSource = null;
let tabStream = null;
let pcmProcessor = null;
let isProcessing = false;

// WebSocket connection to OpenAI Realtime API
let realtimeWs = null;
let currentTranscript = ''; // Accumulate transcript text
let pendingAudioChunks = []; // Buffer for PCM chunks before WS is ready

// Word-by-word subtitle tracking
let currentWords = []; // Array of words for the current sentence
let debounceTimer = null; // Timer for debounced UI updates
const DEBOUNCE_DELAY = 100; // 100ms debounce delay
const FINAL_DISPLAY_TIME = 700; // Keep final subtitle for 700ms

const BACKEND_URL = 'http://localhost:3000';
const TARGET_SAMPLE_RATE = 24000; // OpenAI Realtime API expects 24kHz PCM
const PCM_CHUNK_SIZE = 2000; // ~50ms of audio at 24kHz (low latency)

// Main entry point: process audio stream using streamId
async function processAudioStream(streamId) {
  try {
    console.log('[Realtime] Processing audio stream with ID:', streamId);

    // Step 1: Get ephemeral token from backend
    const tokenData = await getRealtimeToken();
    if (!tokenData) {
      throw new Error('Failed to obtain Realtime session token');
    }

    // Step 2: Get the tab audio stream
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    console.log('[Realtime] Got tab audio stream');

    // Step 3: Create audio context with target sample rate
    audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    mediaStreamSource = audioContext.createMediaStreamSource(tabStream);

    // Step 4: Play audio back to user (important!)
    mediaStreamSource.connect(audioContext.destination);
    console.log('[Realtime] Audio routed to speakers');

    // Step 5: Connect to OpenAI Realtime API via WebSocket
    await connectRealtimeWebSocket(tokenData.clientSecret);

    // Step 6: Set up PCM capture using AudioWorklet
    await setupPCMCapture();

    isProcessing = true;
    console.log('[Realtime] Full audio pipeline active');

  } catch (error) {
    console.error('[Realtime] Error processing audio stream:', error);
    throw error;
  }
}

// Get ephemeral token from backend
async function getRealtimeToken() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/realtime-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Realtime] Got session token, expires at:', new Date(data.expiresAt));

    return {
      clientSecret: data.clientSecret,
      sessionId: data.sessionId
    };
  } catch (error) {
    console.error('[Realtime] Error getting token:', error);
    return null;
  }
}

// Connect to OpenAI Realtime API via WebSocket
async function connectRealtimeWebSocket(clientSecret) {
  return new Promise((resolve, reject) => {
    try {
      // WebSocket URL with model parameter
      const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17`;
      console.log('[Realtime] Connecting to WebSocket with ephemeral token...');

      // WebSocket protocols (includes ephemeral token)
      const protocols = [
        'realtime',
        `openai-insecure-api-key.${clientSecret}`, // OpenAI's ephemeral token format
        'openai-beta.realtime-v1'
      ];

      realtimeWs = new WebSocket(wsUrl, protocols);

      realtimeWs.onopen = () => {
        console.log('[Realtime] WebSocket connected');

        // Send session configuration - TRANSCRIPTION ONLY (not chat mode)
        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],  // AUDIO ONLY - no text generation/chat
            instructions: 'Transcribe English speech EXACTLY as you hear it. Do NOT add words, explanations, or rewrite anything. Only output the spoken English text.',
            voice: 'alloy',  // Not used in STT-only mode, but required by API
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',  // Not used in STT-only mode
            input_audio_transcription: {
              model: 'gpt-4o-mini-transcribe' // Pure transcription model
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.3,              // More sensitive (detect speech faster)
              prefix_padding_ms: 200,      // Less padding (start transcribing sooner)
              silence_duration_ms: 160     // Much shorter silence (don't wait long)
            },
            temperature: 0.6
          }
        };

        realtimeWs.send(JSON.stringify(sessionConfig));
        console.log('[Realtime] Session config sent');

        resolve();
      };

      realtimeWs.onerror = (error) => {
        console.error('[Realtime] WebSocket error:', error);
        reject(error);
      };

      realtimeWs.onclose = (event) => {
        console.log('[Realtime] WebSocket closed:', event.code, event.reason);
      };

      realtimeWs.onmessage = (event) => {
        handleRealtimeMessage(event.data);
      };

    } catch (error) {
      reject(error);
    }
  });
}

// Extract full words from delta text
function extractWords(delta) {
  // Split by spaces and filter out empty strings
  const words = delta.split(/\s+/).filter(word => word.length > 0);
  return words;
}

// Send debounced UI update with current words
function sendDebouncedUpdate() {
  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Set new timer for 100ms delay
  debounceTimer = setTimeout(() => {
    const transcript = currentWords.join(' ');

    // Send incremental update to background script
    chrome.runtime.sendMessage({
      type: 'RECOGNITION_RESULT',
      english: transcript,
      isFinal: false
    }).catch(err => {
      console.error('[Realtime] Error sending incremental update:', err);
    });
  }, DEBOUNCE_DELAY);
}

// Send final subtitle and schedule clear
function sendFinalUpdate(transcript) {
  // Send final subtitle
  chrome.runtime.sendMessage({
    type: 'RECOGNITION_RESULT',
    english: transcript,
    isFinal: true
  }).catch(err => {
    console.error('[Realtime] Error sending final update:', err);
  });

  // Clear subtitle after display time
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: 'RECOGNITION_RESULT',
      english: '',
      isFinal: true,
      shouldClear: true
    }).catch(err => {
      console.error('[Realtime] Error clearing subtitle:', err);
    });
  }, FINAL_DISPLAY_TIME);
}

// Handle incoming messages from Realtime API
function handleRealtimeMessage(data) {
  try {
    const message = JSON.parse(data);

    // Log all events for debugging
    console.log('[Realtime] Event:', message.type);

    switch (message.type) {
      case 'session.created':
      case 'session.updated':
        console.log('[Realtime] Session ready:', message.session);
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[Realtime] Speech started');
        currentTranscript = ''; // Clear on new speech
        currentWords = []; // Clear word buffer
        samplesSentSinceCommit = 0; // Reset sample counter

        // Clear any pending debounce timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] Speech stopped');

        // Clear any pending debounce timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        // Send final subtitle with current words and schedule clear
        if (currentWords.length > 0) {
          const finalTranscript = currentWords.join(' ');
          sendFinalUpdate(finalTranscript);
        }

        // Reset sample counter after speech ends
        samplesSentSinceCommit = 0;
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // This is the finalized English transcription
        const transcript = message.transcript || '';
        console.log('[Realtime] Transcription completed:', transcript);

        currentTranscript = transcript;

        // Send to background script
        chrome.runtime.sendMessage({
          type: 'RECOGNITION_RESULT',
          english: transcript
        }).catch(err => {
          console.error('[Realtime] Error sending result:', err);
        });
        break;

      case 'conversation.item.input_audio_transcription.delta':
        // Partial transcription (real-time updates) - STT ONLY
        const delta = message.delta || '';
        console.log('[Realtime] Transcription delta:', delta);

        // Extract full words from delta
        const newWords = extractWords(delta);

        // Add new words to the current word list
        currentWords.push(...newWords);

        // Update full transcript
        currentTranscript += delta;

        // Send debounced update (100ms delay)
        sendDebouncedUpdate();
        break;

      case 'error':
        // Handle specific error for empty buffer commits gracefully
        if (message.error?.code === 'input_audio_buffer_commit_empty') {
          // This is expected when video is paused/silent - just reset counters silently
          console.log('[Realtime] No audio to commit (silence detected)');
          chunksSentSinceCommit = 0;
          samplesSentSinceCommit = 0;
        } else {
          console.error('[Realtime] API error:', JSON.stringify(message.error, null, 2));
        }
        break;
        
      default:
        // Log other events for debugging
        if (message.type) {
          console.log('[Realtime] Unhandled event:', message.type);
        }
    }
  } catch (error) {
    console.error('[Realtime] Error parsing message:', error);
  }
}

// Set up PCM audio capture using AudioWorklet
async function setupPCMCapture() {
  try {
    // Load the AudioWorklet processor module
    await audioContext.audioWorklet.addModule('audio-processor.js');

    // Create AudioWorklet node
    pcmProcessor = new AudioWorkletNode(audioContext, 'pcm-capture-processor');

    // Connect audio source to processor
    mediaStreamSource.connect(pcmProcessor);

    // Listen for PCM data from the processor
    pcmProcessor.port.onmessage = (event) => {
      if (event.data.type === 'pcm-data') {
        handlePCMData(event.data.pcmData);
      }
    };

    console.log('[Realtime] PCM capture AudioWorklet ready');
  } catch (error) {
    console.error('[Realtime] Error setting up AudioWorklet:', error);
    throw error;
  }
}

// Buffer for batching PCM chunks
let pcmBuffer = new Int16Array(0);
let chunksSentSinceCommit = 0;
let samplesSentSinceCommit = 0; // Track total samples sent to buffer
const CHUNKS_BEFORE_COMMIT = 24; // Force transcription every ~3 seconds (30 chunks * 100ms)
// Increased from 20 to reduce fragmentation while maintaining low latency
const MIN_SAMPLES_FOR_COMMIT = TARGET_SAMPLE_RATE * 0.1; // 100ms of audio at 24kHz = 2400 samples

// Handle PCM data from AudioWorklet and send to Realtime API
function handlePCMData(pcmData) {
  if (!realtimeWs || realtimeWs.readyState !== WebSocket.OPEN) {
    console.warn('[Realtime] WebSocket not ready, buffering audio');
    return;
  }

  // Append to buffer
  const newBuffer = new Int16Array(pcmBuffer.length + pcmData.length);
  newBuffer.set(pcmBuffer);
  newBuffer.set(pcmData, pcmBuffer.length);
  pcmBuffer = newBuffer;

  // Send in chunks of PCM_CHUNK_SIZE
  while (pcmBuffer.length >= PCM_CHUNK_SIZE) {
    const chunk = pcmBuffer.slice(0, PCM_CHUNK_SIZE);
    pcmBuffer = pcmBuffer.slice(PCM_CHUNK_SIZE);

    // Convert Int16Array to base64
    const base64Audio = int16ArrayToBase64(chunk);

    // Send to Realtime API
    const audioEvent = {
      type: 'input_audio_buffer.append',
      audio: base64Audio
    };

    try {
      realtimeWs.send(JSON.stringify(audioEvent));
      chunksSentSinceCommit++;
      samplesSentSinceCommit += chunk.length; // Track total samples sent

      // Commit periodically to force STT updates
      // Commit only if enough chunks + samples collected
      if (chunksSentSinceCommit >= CHUNKS_BEFORE_COMMIT && samplesSentSinceCommit >= MIN_SAMPLES_FOR_COMMIT) {
        realtimeWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        chunksSentSinceCommit = 0;
        samplesSentSinceCommit = 0; // Reset sample counter after commit
        console.log('[Realtime] Manual commit triggered (STT-only mode)');
      }
    } catch (error) {
      console.error('[Realtime] Error sending audio chunk:', error);
    }
  }
}

// Convert Int16Array to base64 string
function int16ArrayToBase64(int16Array) {
  // Convert Int16Array to Uint8Array (raw bytes)
  const uint8Array = new Uint8Array(int16Array.buffer);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binary);
}

// Stop processing and cleanup
function stopProcessing() {
  console.log('[Realtime] Stopping audio processing');

  isProcessing = false;

  // Close WebSocket
  if (realtimeWs) {
    try {
      realtimeWs.close();
      console.log('[Realtime] WebSocket closed');
    } catch (e) {
      console.error('[Realtime] Error closing WebSocket:', e);
    }
    realtimeWs = null;
  }

  // Disconnect AudioWorklet
  if (pcmProcessor) {
    try {
      pcmProcessor.disconnect();
      pcmProcessor.port.close();
    } catch (e) {
      console.error('[Realtime] Error disconnecting processor:', e);
    }
    pcmProcessor = null;
  }

  // Disconnect audio nodes
  if (mediaStreamSource) {
    try {
      mediaStreamSource.disconnect();
    } catch (e) {
      console.error('[Realtime] Error disconnecting media source:', e);
    }
    mediaStreamSource = null;
  }

  // Close audio context
  if (audioContext) {
    try {
      audioContext.close();
    } catch (e) {
      console.error('[Realtime] Error closing audio context:', e);
    }
    audioContext = null;
  }

  // Stop all tracks on the tab stream
  if (tabStream) {
    try {
      tabStream.getTracks().forEach(track => track.stop());
      console.log('[Realtime] Tab stream tracks stopped');
    } catch (e) {
      console.error('[Realtime] Error stopping stream tracks:', e);
    }
    tabStream = null;
  }

  // Clear state
  currentTranscript = '';
  currentWords = [];
  pcmBuffer = new Int16Array(0);
  samplesSentSinceCommit = 0;
  chunksSentSinceCommit = 0;

  // Clear debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  console.log('[Realtime] Audio processing fully stopped');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROCESS_AUDIO_STREAM') {
    processAudioStream(message.streamId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'STOP_PROCESSING') {
    stopProcessing();
    sendResponse({ success: true });
  }

  return true;
});

console.log('[Realtime] Offscreen document loaded and ready (OpenAI Realtime API mode)');
