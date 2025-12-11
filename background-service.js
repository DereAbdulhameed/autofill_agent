class AutofillBackgroundService {
  constructor() {
    this.transcriptionTabId = null;
    this.emrTabId = null;
    this.latestTranscript = null;
    this.transcriptionAppUrl = 'transcribe.intron.health';
    this.init();
  }

  init() {
    const messageHandler = (message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; 
    };

    const tabRemovedHandler = (tabId) => {
      if (tabId === this.transcriptionTabId) this.transcriptionTabId = null;
      if (tabId === this.emrTabId) this.emrTabId = null;
    };

    chrome.runtime.onMessage.addListener(messageHandler);
    chrome.tabs.onRemoved.addListener(tabRemovedHandler);
    chrome.action.onClicked.addListener(this.handleIconClick.bind(this));

    this.cleanup = () => {
      chrome.runtime.onMessage.removeListener(messageHandler);
      chrome.tabs.onRemoved.removeListener(tabRemovedHandler);
      chrome.action.onClicked.removeListener(this.handleIconClick);
    };
  }

  
  async handleMessage(message, sender, sendResponse) {
    const respond = (data) => {
      if (chrome.runtime.lastError) {
        console.error('Runtime error:', chrome.runtime.lastError);
        return sendResponse({ success: false, error: chrome.runtime.lastError.message });
      }
      sendResponse(data);
    };

    try {
      switch (message.type) {
        case 'TRANSCRIPT_READY':
          await this.handleTranscriptReady(message.data, sender.tab.id);
          return respond({ success: true });

        case 'TRANSCRIPT_DETECTED':
          this.latestTranscript = message.data;
          this.transcriptionTabId = sender.tab.id;
          return respond({ success: true });

        case 'REQUEST_TRANSCRIPT':
          return respond({ transcript: this.latestTranscript });

        case 'IDENTIFY_AS_EMR':
          this.emrTabId = sender.tab.id;
          if (this.latestTranscript?.length > 10) {
            this.transferToEMR(this.emrTabId).catch(console.error);
          }
          return respond({ success: true });

        case 'GET_TAB_INFO':
          return respond({
            transcriptionTabId: this.transcriptionTabId,
            emrTabId: this.emrTabId,
            hasTranscript: !!this.latestTranscript
          });

        default:
          return respond({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return respond({ success: false, error: error.message });
    }
  }

  
  async handleTranscriptReady(transcript, tabId) {
    this.latestTranscript = transcript;
    this.transcriptionTabId = tabId;

    if (this.emrTabId) {
      try {
        await this.transferToEMR(this.emrTabId);
        return;
      } catch (error) {
        this.emrTabId = null;
      }
    }

    const emrTab = await this.findEMRTab();
    if (emrTab) {
      this.emrTabId = emrTab.id;
      await this.transferToEMR(emrTab.id);
    }
  }

  /**
   * Find EMR tab (tab with forms)
   */
  async findEMRTab() {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (tab.id === this.transcriptionTabId || !tab.url.startsWith('http')) {
        continue;
      }
      
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'CHECK_HAS_FORMS'
        });
        
        if (response?.hasForms) {
          return tab;
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  async transferToEMR(emrTabId) {
    const MESSAGE_TIMEOUT = 5000;
    
    try {
      // Send transcript with timeout
      await Promise.race([
        chrome.tabs.sendMessage(emrTabId, {
          type: 'AUTOFILL_TRANSCRIPT',
          data: this.latestTranscript
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Message timeout')), MESSAGE_TIMEOUT)
        )
      ]).catch(error => {
        console.warn('Autofill message warning:', error.message);
      });
      
      // Switch to EMR tab
      const emrTab = await chrome.tabs.get(emrTabId).catch(() => {
        throw new Error('EMR tab not found');
      });
      
      await Promise.all([
        chrome.windows.update(emrTab.windowId, { focused: true }),
        chrome.tabs.update(emrTabId, { active: true })
      ]);
      
    } catch (error) {
      console.error('Transfer to EMR failed:', error);
      this.showNotification(
        'Transfer Failed',
        'Could not auto-fill the form. Please try manually.'
      );
      throw error; 
    }
  }


  async handleIconClick(tab) {
    if (tab.url.includes(this.transcriptionAppUrl)) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_TRANSCRIPT'
        });
        
        if (response?.transcript) {
          this.latestTranscript = response.transcript;
          this.transcriptionTabId = tab.id;
          
          this.showNotification(
            'Transcript Captured',
            'Now switch to your EMR tab and click the icon again'
          );
        }
      } catch (error) {
        console.error('Error extracting transcript:', error);
      }
      return;
    }
    
    if (this.latestTranscript) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'AUTOFILL_TRANSCRIPT',
          data: this.latestTranscript
        });
        
        this.showNotification(
          'Auto-fill Complete',
          'Form has been filled. Please review before submitting.'
        );
      } catch (error) {
        console.error('Error autofilling:', error);
        this.showNotification(
          'Auto-fill Failed',
          'Could not auto-fill. Make sure the page has form fields.'
        );
      }
    } else {
      this.showNotification(
        'No Transcript',
        'Please capture a transcript first from your transcription app'
      );
    }
  }


  
  showNotification(title, message) {
    if (!chrome.notifications) {
      console.warn('Notifications not available:', { title, message });
      return;
    }
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 1
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Notification error:', chrome.runtime.lastError);
      }
    });
  }

  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


const service = new AutofillBackgroundService();
console.log('[Background Service]  Ready for cross-tab autofill');
