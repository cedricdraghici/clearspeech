// Popup script for controlling speech-to-text

const toggleButton = document.getElementById('toggleButton');
const toggleText = document.getElementById('toggleText');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const messageBox = document.getElementById('messageBox');
const messageText = document.getElementById('messageText');

let isListening = false;

// Initialize popup state
async function initPopup() {
  try {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      console.error('No active tab found');
      return;
    }

    // Check if this specific tab is the one listening
    const response = await chrome.runtime.sendMessage({
      type: 'GET_LISTENING_STATE',
      tabId: tab.id
    });
    isListening = response.isListening || false;
    updateUI();
  } catch (error) {
    console.error('Error initializing popup:', error);
  }
}

// Update UI based on listening state
function updateUI() {
  if (isListening) {
    toggleButton.classList.remove('off');
    toggleButton.classList.add('on');
    toggleText.textContent = 'Stop Listening';
    statusBadge.classList.add('active');
    statusText.textContent = 'Active';
    statusText.style.color = '#4ade80';
  } else {
    toggleButton.classList.remove('on');
    toggleButton.classList.add('off');
    toggleText.textContent = 'Start Listening';
    statusBadge.classList.remove('active');
    statusText.textContent = 'Ready';
    statusText.style.color = '';
  }
}

// Show or hide message box
function showMessage(message) {
  messageText.textContent = message;
  messageBox.classList.add('visible');
}

function hideMessage() {
  messageBox.classList.remove('visible');
}

// Toggle listening state
async function toggleListening() {
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      console.error('No active tab found');
      showMessage('Please open a tab with a video or audio content.');
      return;
    }

    // If currently listening, stop it
    if (isListening) {
      // Stop tab audio capture
      await chrome.runtime.sendMessage({
        type: 'STOP_TAB_CAPTURE'
      });

      // Hide overlay
      await chrome.tabs.sendMessage(tab.id, { type: 'STOP_LISTENING' });

      // Update background script state
      await chrome.runtime.sendMessage({
        type: 'TOGGLE_LISTENING',
        isListening: false
      });

      isListening = false;
      updateUI();
      hideMessage();
      return;
    }

    // Otherwise, try to start listening
    const captureResponse = await chrome.runtime.sendMessage({
      type: 'START_TAB_CAPTURE',
      tabId: tab.id
    });

    // Handle blocked state (another tab is already listening)
    if (captureResponse.blocked) {
      showMessage(captureResponse.message);
      return;
    }

    // Handle other errors
    if (!captureResponse.success) {
      throw new Error(captureResponse.error || 'Failed to start audio capture');
    }

    // Success - start listening
    isListening = true;

    // Show overlay on the page
    await chrome.tabs.sendMessage(tab.id, { type: 'START_LISTENING' });

    // Update background script state
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_LISTENING',
      isListening: true
    });

    // Update UI
    updateUI();
    hideMessage();
  } catch (error) {
    console.error('Error toggling listening:', error);

    // Reset state on error
    isListening = false;
    updateUI();

    // Show user-friendly error message in UI
    if (error.message.includes('Backend server is not running')) {
      showMessage('Backend server is not running. Please start it with "npm start" in the backend folder.');
    } else if (error.message.includes('Cannot start audio capture')) {
      showMessage('Unable to capture audio from this tab. Make sure the tab has audio/video content playing.');
    } else if (error.message.includes('content script')) {
      showMessage('Please refresh the page and try again.');
    } else {
      showMessage('Error: ' + error.message);
    }
  }
}

// Event listeners
toggleButton.addEventListener('click', toggleListening);

// Initialize on load
initPopup();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'LISTENING_STATE_CHANGED') {
    isListening = message.isListening;
    updateUI();
  }
});
