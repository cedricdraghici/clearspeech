// Background service worker for managing tab audio capture and forwarding results

let isListeningGlobal = false;
let activeTabId = null;

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TOGGLE_LISTENING') {
    isListeningGlobal = message.isListening;

    // Update icon badge
    chrome.action.setBadgeText({
      text: isListeningGlobal ? 'ON' : ''
    });

    chrome.action.setBadgeBackgroundColor({
      color: '#ff6b4a'
    });

    sendResponse({ success: true });
  } else if (message.type === 'GET_LISTENING_STATE') {
    // Only the active tab should show as listening
    // message.tabId is provided by popup for the currently active tab
    const requestTabId = message.tabId;
    const isThisTabListening = isListeningGlobal && activeTabId === requestTabId;
    sendResponse({ isListening: isThisTabListening });
  } else if (message.type === 'START_TAB_CAPTURE') {
    // Enforce single-tab only: return blocked state if another tab is already listening
    if (isListeningGlobal && activeTabId !== null && activeTabId !== message.tabId) {
      sendResponse({
        success: false,
        blocked: true,
        message: 'Cannot record more than one page at once.'
      });
      return true;
    }

    startTabCapture(message.tabId)
      .then(() => sendResponse({ success: true, blocked: false }))
      .catch(error => sendResponse({ success: false, blocked: false, error: error.message }));
    return true;
  } else if (message.type === 'STOP_TAB_CAPTURE') {
    stopTabCapture()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'RECOGNITION_RESULT') {
    // Forward recognition results from offscreen to content script
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'UPDATE_TRANSLATION',
        english: message.english
      }).catch(error => {
        console.error('Error sending to content script:', error);
      });
    }
  }

  return true;
});

async function startTabCapture(tabId) {
  try {
    activeTabId = tabId;

    // 1) Safety: if Chrome thinks this tab is already being captured, stop it first
    const capturedTabs = await chrome.tabCapture.getCapturedTabs();
    const alreadyCaptured = capturedTabs.some(
      info => info.tabId === tabId && info.status === 'active'
    );
    if (alreadyCaptured) {
      console.log('Tab already has an active capture; stopping previous capture');
      await stopTabCapture();
    }

    // 2) Make sure tab isn’t muted
    await chrome.tabs.update(tabId, { muted: false });

    // 3) (Re)create offscreen document if needed
    await setupOffscreenDocument();

    // 4) Now it’s safe to ask for a new stream id
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) throw new Error('Failed to get media stream ID');

    console.log('Got stream ID:', streamId);

    // 5) Tell offscreen to start processing
    const offscreenResponse = await chrome.runtime.sendMessage({ type: 'PROCESS_AUDIO_STREAM', streamId });

    // Check if offscreen returned an error
    if (offscreenResponse && !offscreenResponse.success) {
      throw new Error(offscreenResponse.error || 'Failed to start audio processing');
    }

  } catch (error) {
    console.error('Error starting tab capture:', error);
    throw error;
  }
}


async function stopTabCapture() {
  try {
    console.log('Stopping tab capture');

    // Tell offscreen document to stop processing and release the stream
    await chrome.runtime.sendMessage({ type: 'STOP_PROCESSING' });

    // Optionally close the offscreen document so it can be recreated next time
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
      await chrome.offscreen.closeDocument();
      console.log('Offscreen document closed');
    }

    // Clear active tab id
    activeTabId = null;

  } catch (error) {
    console.error('Error in stopTabCapture:', error);
    throw error;
  }
}

// Setup offscreen document for audio processing
async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    console.log('Offscreen document already exists');
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Processing tab audio for English speech recognition'
  });

  console.log('Offscreen document created');
}

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('ClearSpeech extension installed');

  // Set initial badge
  chrome.action.setBadgeText({ text: '' });

  // Initialize storage
  chrome.storage.local.set({
    isListening: false
  });
});

// Cleanup on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopTabCapture().catch(error => {
      console.error('Error during cleanup:', error);
    });
  }
});

// Cleanup on tab reload - CRITICAL for resetting state
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // When a tab starts loading (refresh or navigation), clean up if it was the active capture tab
  if (changeInfo.status === 'loading' && tabId === activeTabId) {
    console.log('Tab reloading, cleaning up audio capture state');

    // Reset global listening state
    isListeningGlobal = false;

    // Update storage to ensure popup shows correct state
    await chrome.storage.local.set({ isListening: false });

    // Clear badge
    chrome.action.setBadgeText({ text: '' });

    // Stop audio capture
    await stopTabCapture().catch(error => {
      console.error('Error stopping capture on tab reload:', error);
    });

    // Notify popup if it's open to update UI
    chrome.runtime.sendMessage({
      type: 'LISTENING_STATE_CHANGED',
      isListening: false
    }).catch(() => {
      // Popup may not be open, ignore error
    });

    console.log('Audio capture cleaned up on tab reload');
  }
});
