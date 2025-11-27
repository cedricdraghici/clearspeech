// Content script that displays the speech-to-text overlay on the webpage

let transcriptionOverlay = null;
let isListening = false;

// Create the overlay UI
function createOverlay() {
  if (transcriptionOverlay) return;

  transcriptionOverlay = document.createElement('div');
  transcriptionOverlay.id = 'speech-to-text-overlay';
  transcriptionOverlay.innerHTML = `
    <div class="transcription-content">
      <div class="transcription-header">
        <div class="transcription-status">
          <div class="status-dot"></div>
          <span class="status-text">Listening to tab audio...</span>
        </div>
        <button class="close-btn" id="transcription-close-btn">×</button>
      </div>
      <div class="transcription-body">
        <div class="text-display" id="transcription-text"></div>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #speech-to-text-overlay {
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      display: none;
    }

    #speech-to-text-overlay.active {
      display: block;
      animation: slideInUp 0.3s ease-out;
    }

    @keyframes slideInUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .transcription-content {
      background: rgba(10, 10, 11, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 16px 20px;
      min-width: 320px;
      max-width: 480px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .transcription-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .transcription-status {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ff6b4a;
      box-shadow: 0 0 8px rgba(255, 107, 74, 0.5);
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.2); }
    }

    .status-text {
      color: #a1a1a6;
      font-size: 12px;
      font-weight: 500;
    }

    .close-btn {
      background: none;
      border: none;
      color: #a1a1a6;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fafafa;
    }

    .transcription-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .text-display {
      color: #fafafa;
      font-size: 15px;
      line-height: 1.5;
      min-height: 24px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .text-display:empty::before {
      content: 'Waiting for speech...';
      color: #636366;
      font-style: italic;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(transcriptionOverlay);

  // Add close button handler
  document.getElementById('transcription-close-btn').addEventListener('click', () => {
    stopListening();
    chrome.runtime.sendMessage({ type: 'TOGGLE_LISTENING', isListening: false });
  });
}

// Update overlay with transcribed text
function updateOverlay(text) {
  const textElement = document.getElementById('transcription-text');

  if (textElement) textElement.textContent = text || '';
}

// Start listening
function startListening() {
  if (!transcriptionOverlay) {
    createOverlay();
  }

  isListening = true;
  transcriptionOverlay.classList.add('active');
}

// Stop listening
function stopListening() {
  isListening = false;

  if (transcriptionOverlay) {
    transcriptionOverlay.classList.remove('active');
  }

  // Clear text after a short delay
  setTimeout(() => {
    updateOverlay('');
  }, 300);
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_LISTENING') {
    startListening();
    sendResponse({ success: true });
  } else if (message.type === 'STOP_LISTENING') {
    stopListening();
    sendResponse({ success: true });
  } else if (message.type === 'UPDATE_TRANSLATION') {
    // Receive transcription updates from background script
    updateOverlay(message.english);
    sendResponse({ success: true });
  }
  return true;
});

console.log('Speech-to-text content script loaded');
