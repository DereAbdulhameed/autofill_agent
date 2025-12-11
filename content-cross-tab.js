/**
 * Enhanced Content Script for Cross-Tab Autofill
 * Works on both transcription app and EMR pages
 */

class CrossTabAutofill {
  constructor() {
    this.isTranscriptionPage = false;
    this.isEMRPage = false;
    this.transcriptElement = null;
    this.lastTranscript = '';
    this.observers = [];
    this.init();
  }

  async init() {
    try {
      await this.detectPageType();
      
      this.messageHandler = (message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true; // Keep message channel open for async response
      };
      
      chrome.runtime.onMessage.addListener(this.messageHandler);

      if (this.isTranscriptionPage) {
        this.initTranscriptionPage();
      } else if (this.isEMRPage) {
        this.initEMRPage();
      }
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }

  /**
   * Detect if this is transcription page or EMR page
   */
  async detectPageType() {
    const textBox = document.getElementById('textBox') || 
                    document.getElementById('id-intronies-transcript-textbox');
    
    if (textBox) {
      this.isTranscriptionPage = true;
      this.transcriptElement = textBox;
      return;
    }

    const forms = document.querySelectorAll('form');
    const inputs = document.querySelectorAll('input:not([type="submit"]):not([type="button"]), textarea, select');
    
    if (forms.length > 0 || inputs.length > 5) {
      this.isEMRPage = true;
      chrome.runtime.sendMessage({ type: 'IDENTIFY_AS_EMR' });
    }
  }

  /**
   * Initialize transcription page monitoring
   */
  initTranscriptionPage() {
    if (!this.transcriptElement) return;
    
    // Create and store observer for later cleanup
    const transcriptObserver = new MutationObserver(() => {
      this.handleTranscriptUpdate();
    });
    
    transcriptObserver.observe(this.transcriptElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
    this.observers.push(transcriptObserver);

    const inputHandler = () => this.handleTranscriptUpdate();
    this.transcriptElement.addEventListener('input', inputHandler);
    
    // Store reference for cleanup
    this.transcriptInputHandler = inputHandler;

    this.watchForStopButton();
  }

  /**
   * Watch for stop recording button
   */
  watchForStopButton() {
    const stopBtn = document.getElementById('stopBtn') || 
                    document.getElementById('id-intronies-stop-btn');
    
    const clickHandler = () => this.waitForFinalTranscript();
    
    if (stopBtn) {
      stopBtn.addEventListener('click', clickHandler);
      this.stopButtonHandler = clickHandler;
    } else {
      // Use event delegation for dynamic buttons
      document.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (target && 
            (target.textContent.toLowerCase().includes('stop') || 
             target.textContent.toLowerCase().includes('finish'))) {
          clickHandler();
        }
      });
    }

    const startPrompt = document.getElementById('start-prompt');
    if (startPrompt) {
      const observer = new MutationObserver(() => {
        const text = startPrompt.textContent;
        if (text.includes('finished') || text.includes('review')) {
          setTimeout(() => {
            this.sendTranscriptToBackground();
          }, 500);
        }
      });
      
      observer.observe(startPrompt, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  /**
   * Wait for post-processing to complete and final transcript to be ready
   */
  waitForFinalTranscript() {
    if (this.transcriptCheckInterval) {
      clearInterval(this.transcriptCheckInterval);
    }
    
    if (this.transcriptTimeout) {
      clearTimeout(this.transcriptTimeout);
    }
    
    const STATE = {
      lastLength: 0,
      unchangedCount: 0,
      hasLongTranscript: false,
      isComplete: false
    };
    
    const checkTranscript = () => {
      if (!this.transcriptElement || STATE.isComplete) {
        this.cleanupTranscriptCheck();
        return;
      }
      
      const currentTranscript = (this.transcriptElement.value || this.transcriptElement.textContent).trim();
      const currentLength = currentTranscript.length;
      
      if (currentLength >= 500) STATE.hasLongTranscript = true;
      
      if (currentLength >= 300) {
        if (currentLength === STATE.lastLength) {
          STATE.unchangedCount++;
          
          const requiredStableTime = STATE.hasLongTranscript ? 4 : 5;
          
          if (STATE.unchangedCount >= requiredStableTime) {
            this.completeTranscriptCheck();
          }
        } else {
          STATE.unchangedCount = 0;
          STATE.lastLength = currentLength;
        }
      } else {
        STATE.unchangedCount = 0;
        STATE.lastLength = currentLength;
      }
    };
    
    this.transcriptCheckInterval = setInterval(checkTranscript, 1000);
    this.transcriptTimeout = setTimeout(() => {
      if (!STATE.isComplete) {
        this.completeTranscriptCheck();
      }
    }, 30000);
    
    // Initial check
    checkTranscript();
  }
  
  completeTranscriptCheck() {
    this.cleanupTranscriptCheck();
    this.sendTranscriptToBackground().catch(console.error);
  }
  
  cleanupTranscriptCheck() {
    if (this.transcriptCheckInterval) {
      clearInterval(this.transcriptCheckInterval);
      this.transcriptCheckInterval = null;
    }
    if (this.transcriptTimeout) {
      clearTimeout(this.transcriptTimeout);
      this.transcriptTimeout = null;
    }
  }

  /**
   * Handle transcript update
   */
  handleTranscriptUpdate() {
    if (!this.transcriptElement) return;
    
    // Get transcript content - use .value for textarea, .textContent for other elements
    const currentTranscript = (this.transcriptElement.value || this.transcriptElement.textContent).trim();
    
    // Only process if transcript has meaningful content and changed
    if (currentTranscript.length > 20 && currentTranscript !== this.lastTranscript) {
      this.lastTranscript = currentTranscript;
      console.log('[Cross-Tab Autofill] Transcript updated:', currentTranscript.substring(0, 50) + '...');
      
      // Send to background service
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_DETECTED',
        data: currentTranscript
      });
    }
  }

  /**
   * Send final transcript to background service
   */
  sendTranscriptToBackground() {
    if (!this.transcriptElement) {
      console.log('[Cross-Tab Autofill] Error: No transcript element found');
      return;
    }
    
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      console.error('[Cross-Tab Autofill] ❌ Extension context invalidated. Please refresh the page.');
      alert('Extension was reloaded. Please refresh this page and try again.');
      return;
    }
    
    // Use .value for textarea, .textContent for other elements
    const transcript = (this.transcriptElement.value || this.transcriptElement.textContent).trim();
    
    console.log('[Cross-Tab Autofill] Transcript length:', transcript.length);
    console.log('[Cross-Tab Autofill] Transcript preview:', transcript.substring(0, 100));
    
    if (transcript.length > 10) {
      console.log('[Cross-Tab Autofill] Sending transcript to background service');
      
      try {
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_READY',
          data: transcript
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Cross-Tab Autofill] Error sending message:', chrome.runtime.lastError);
            if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
              alert('Extension was reloaded. Please refresh this page and try again.');
            }
          } else {
            console.log('[Cross-Tab Autofill] Message sent successfully:', response);
          }
        });
      } catch (error) {
        console.error('[Cross-Tab Autofill] Exception sending message:', error);
        alert('Extension error. Please refresh this page and try again.');
        return;
      }

      // Show visual feedback
      this.showTranscriptCaptured();
    } else {
      console.log('[Cross-Tab Autofill] Transcript too short, not sending');
    }
  }

  /**
   * Show visual feedback that transcript was captured
   */
  showTranscriptCaptured() {
    const notification = document.createElement('div');
    notification.textContent = 'Transcript captured! Switch to EMR tab to auto-fill';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: #10b981;
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }

  /**
   * Initialize EMR page
   */
  initEMRPage() {
    console.log('[Cross-Tab Autofill] EMR page ready for autofill');
    
    // Still support paste-to-autofill
    document.addEventListener('paste', (e) => {
      const target = e.target;
      
      if (this.isFormField(target)) {
        setTimeout(() => {
          this.handlePaste(target);
        }, 100);
      }
    }, true);
  }

  /**
   * Handle messages from background service
   */
  async handleMessage(message, sender, sendResponse) {
    console.log('[Cross-Tab Autofill] Received message:', message.type);

    switch (message.type) {
      case 'AUTOFILL_TRANSCRIPT':
        await this.autofillFromTranscript(message.data);
        sendResponse({ success: true });
        break;

      case 'EXTRACT_TRANSCRIPT':
        const transcript = this.extractTranscript();
        sendResponse({ transcript: transcript });
        break;

      case 'CHECK_HAS_FORMS':
        const hasForms = this.checkHasForms();
        sendResponse({ hasForms: hasForms });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  /**
   * Extract transcript from transcription page
   */
  extractTranscript() {
    if (this.transcriptElement) {
      // Use .value for textarea, .textContent for other elements
      return (this.transcriptElement.value || this.transcriptElement.textContent).trim();
    }
    return '';
  }

  /**
   * Check if page has forms
   */
  checkHasForms() {
    const forms = document.querySelectorAll('form');
    const inputs = document.querySelectorAll('input:not([type="submit"]):not([type="button"]), textarea, select');
    return forms.length > 0 || inputs.length > 5;
  }

  /**
   * Autofill from transcript (received from background service)
   */
  async autofillFromTranscript(transcript) {
    console.log('[Cross-Tab Autofill] Auto-filling from transcript');
    
    // Parse the transcript
    const parsedData = this.parseStructuredText(transcript);
    
    if (Object.keys(parsedData.fields).length === 0) {
      console.log('[Cross-Tab Autofill] No structured data found');
      this.showNotification('No structured data found in transcript', 'error');
      return;
    }

    console.log('[Cross-Tab Autofill] Extracted fields:', parsedData.fields);

    // Find all form fields
    const formFields = this.detectFormFields();
    console.log(`[Cross-Tab Autofill] Found ${formFields.length} form fields`);

    // Match data to fields
    const mappings = this.mapDataToFields(parsedData, formFields);
    console.log(`[Cross-Tab Autofill] Matched ${mappings.length} fields`);

    // Fill the fields
    await this.fillFields(mappings);

    console.log('[Cross-Tab Autofill] Autofill completed');
    this.showNotification('Form auto-filled successfully!', 'success');
  }

  /**
   * Handle paste event (fallback method)
   */
  async handlePaste(sourceField) {
    const pastedText = sourceField.value.trim();
    
    if (!pastedText || pastedText.length < 10) {
      return;
    }

    if (!this.looksLikeStructuredData(pastedText)) {
      return;
    }

    console.log('[Cross-Tab Autofill] Detected structured text via paste');

    const parsedData = this.parseStructuredText(pastedText);
    
    if (Object.keys(parsedData.fields).length === 0) {
      return;
    }

    const formFields = this.detectFormFields(sourceField);
    const mappings = this.mapDataToFields(parsedData, formFields);
    await this.fillFields(mappings);

    // Clear source field
    setTimeout(() => {
      sourceField.value = '';
      sourceField.dispatchEvent(new Event('input', { bubbles: true }));
    }, 500);

    this.showNotification('✅ Form auto-filled successfully!', 'success');
  }

  // Include all the parsing and filling methods from content-autofill.js
  // (I'll import the core logic)

  isFormField(element) {
    if (!element) return false;
    const tagName = element.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea';
  }

  looksLikeStructuredData(text) {
    const patterns = [
      /\w+\s*:\s*\w+/i,
      /patient\s+name/i,
      /age\s*:\s*\d+/i,
      /blood\s+pressure/i,
      /chief\s+complaint/i
    ];
    return patterns.some(pattern => pattern.test(text));
  }

  parseStructuredText(text) {
    const parsed = { raw: text, fields: {} };

    // Balanced patterns - capture until next common field or sentence end
    const patterns = {
      name: /(?:pt\s+name|patient\s+name|name)[:\s]+([A-Za-z\s]+?)(?=\s+(?:age|dob|gender)|$)/i,
      age: /(?:age)[:\s]+(\d+)/i,
      dob: /(?:date\s+of\s+birth|dob|birth\s+date)[:\s]+([\d\s\w]+?)(?=\s+(?:presenting|gender|BP|blood\s+pressure|chief)|$)/i,
      gender: /(?:gender|sex)[:\s]+(male|female|other)/i,
      bloodPressure: /(?:blood\s+pressure|BP)[:\s]*(\d+[\/\s]\d+)/i,
      heartRate: /(?:heart\s+rate|pulse|HR)[:\s]+(\d+)/i,
      temperature: /(?:temperature|temp|T)[:\s]+([\d.]+)/i,
      weight: /(?:weight|wt)[:\s]+([\d.]+)/i,
      height: /(?:height|ht)[:\s]+([\d.'"]+)/i,
      chiefComplaint: /(?:chief\s+complaint|presenting\s+complaint|CC|complaint)[:\s]+([^.]+?)(?=\s+(?:history|BP|diagnosis)|[.]|$)/i,
      symptoms: /(?:symptoms|presenting\s+symptoms)[:\s]+([^.]+?)(?=\s+(?:BP|diagnosis|allergies)|[.]|$)/i,
      diagnosis: /(?:diagnosis|DX)[:\s]+([^.]+?)(?=\s+(?:allergies|medication|oral)|[.]|$)/i,
      allergies: /(?:allergies|allergy)[:\s]+([^.]+?)(?=\s+(?:medication|medical\s+history)|[.]|$)/i,
      medications: /(?:medications|medication|meds|current\s+medications)[:\s]+([^.]+?)(?=\s+(?:medical\s+history|surgical)|[.]|$)/i,
      medicalHistory: /(?:medical\s+history|PMH|past\s+medical\s+history)[:\s]+([^.]+?)(?=\s+(?:surgical\s+history|family\s+history)|[.]|$)/i,
      surgicalHistory: /(?:surgical\s+history|PSH)[:\s]+([^.]+?)(?=\s+(?:family\s+history|social\s+history)|[.]|$)/i,
      familyHistory: /(?:family\s+history|FH)[:\s]+([^.]+?)(?=\s+(?:social\s+history|assessment)|[.]|$)/i,
      socialHistory: /(?:social\s+history|SH)[:\s]+([^.]+?)(?=\s+(?:assessment|plan)|[.]|$)/i,
      assessment: /(?:assessment)[:\s]+([^.]+?)(?=\s+(?:plan|treatment)|[.]|$)/i,
      plan: /(?:plan|PLAN|treatment\s+plan)[:\s]+(.+?)$/i,
      notes: /(?:notes|additional\s+notes|comments)[:\s]+(.+?)$/i
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match && match[1]) {
        parsed.fields[key] = match[1].trim();
      }
    }

    return parsed;
  }

  detectFormFields(sourceField = null) {
    const fields = [];
    // More aggressive selector - include hidden fields, all input types
    const inputs = document.querySelectorAll('input:not([type="submit"]):not([type="button"]), textarea, select');
    
    console.log(`[Cross-Tab Autofill] Total inputs found: ${inputs.length}`);
    
    inputs.forEach((element, index) => {
      if (element === sourceField) return;
      
      // Skip only truly disabled or readonly fields
      if (element.disabled || element.readOnly) {
        console.log(`[Cross-Tab Autofill] Skipping disabled/readonly field:`, element.name || element.id);
        return;
      }

      const fieldInfo = {
        element: element,
        index: index,
        type: this.getFieldType(element),
        name: element.name || '',
        id: element.id || '',
        placeholder: element.placeholder || '',
        label: this.getFieldLabel(element),
        ariaLabel: element.getAttribute('aria-label') || '',
        value: element.value || '',
        required: element.required,
        readonly: element.readOnly,
        disabled: element.disabled
      };

      fieldInfo.identifier = this.generateFieldIdentifier(fieldInfo);
      console.log(`[Cross-Tab Autofill] Field detected: "${fieldInfo.identifier}" (${fieldInfo.type})`);
      fields.push(fieldInfo);
    });

    console.log(`[Cross-Tab Autofill] Total fields detected: ${fields.length}`);
    return fields;
  }

  isFieldVisible(element) {
    // For important patient fields, be more lenient
    const importantFields = ['patient_fullname', 'patient_age', 'patient_gender', 'date_of_birth'];
    const isImportant = importantFields.some(field => 
      element.name?.includes(field) || element.id?.includes(field)
    );
    
    if (isImportant) {
      // Only check if truly hidden (display:none)
      const style = window.getComputedStyle(element);
      return style.display !== 'none';
    }
    
    // Standard visibility check for other fields
    if (!element.offsetParent && element.offsetWidth === 0 && element.offsetHeight === 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  getFieldType(element) {
    if (element.tagName === 'TEXTAREA') return 'textarea';
    if (element.tagName === 'SELECT') return 'select';
    if (element.tagName === 'INPUT') return element.type.toLowerCase() || 'text';
    return 'unknown';
  }

  getFieldLabel(element) {
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return label.textContent.trim();
    }
    const parentLabel = element.closest('label');
    if (parentLabel) {
      return parentLabel.textContent.replace(element.value, '').trim();
    }
    const parent = element.parentElement;
    if (parent) {
      const text = parent.textContent.replace(element.value, '').trim();
      if (text.length < 100) return text;
    }
    return '';
  }

  generateFieldIdentifier(fieldInfo) {
    const parts = [
      fieldInfo.label,
      fieldInfo.name,
      fieldInfo.id,
      fieldInfo.placeholder,
      fieldInfo.ariaLabel
    ].filter(Boolean);
    return parts.join(' ').toLowerCase();
  }

  mapDataToFields(parsedData, fields) {
    const mappings = [];
    const usedFields = new Set(); // Track which fields have been used
    
    const fieldKeywords = {
      name: ['fullname', 'patient name', 'full name', 'patient_fullname', 'name'],
      age: ['age', 'patient_age'],
      dob: ['date of birth', 'dob', 'birth date', 'birthday', 'date_of_birth'],
      gender: ['gender', 'sex', 'patient_gender'],
      bloodPressure: ['blood pressure', 'bp', 'systolic', 'diastolic'],
      heartRate: ['heart rate', 'pulse', 'hr', 'heart_rate'],
      temperature: ['temperature', 'temp', 'body_temp'],
      weight: ['weight', 'wt', 'body_weight', 'patient_weight'],
      height: ['height', 'ht', 'patient_height'],
      chiefComplaint: ['presenting complaint', 'chief complaint', 'presenting_complaint', 'cc', 'complaint'],
      diagnosis: ['primary diagnosis', 'diagnosis', 'primary_diagnosis', 'dx', 'assessment'],
      symptoms: ['presenting symptoms', 'symptoms', 'history presenting'],
      allergies: ['allergy', 'allergies', 'drug allergy'],
      medications: ['routine drugs', 'medications', 'meds', 'current medications', 'routine_drugs'],
      medicalHistory: ['medical history', 'other medical', 'pmh', 'past medical', 'other_medical_history'],
      surgicalHistory: ['surgical history', 'psh', 'past surgical'],
      familyHistory: ['family history', 'family social', 'fh', 'family_social_history'],
      socialHistory: ['social history', 'family social', 'sh', 'family_social_history'],
      assessment: ['assessment', 'primary diagnosis', 'primary_diagnosis'],
      plan: ['treatment plan', 'plan', 'treatment_plan'],
      notes: ['notes', 'additional notes', 'comments', 'other']
    };

    console.log('[Cross-Tab Autofill] Starting field matching...');

    for (const [dataKey, dataValue] of Object.entries(parsedData.fields)) {
      const keywords = fieldKeywords[dataKey] || [dataKey];
      let bestMatch = null;
      let bestScore = 0;

      console.log(`[Cross-Tab Autofill] Matching "${dataKey}": "${dataValue.substring(0, 30)}..."`);

      for (const field of fields) {
        if (field.readonly || field.disabled) continue;
        if (usedFields.has(field.element)) continue; // Skip already used fields
        
        // Skip checkboxes for text data
        if (field.type === 'checkbox' && dataValue.length > 10) continue;
        
        const score = this.calculateMatchScore(field.identifier, keywords);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = field;
        }
      }

      // Require confidence threshold - lower for history fields (60%), higher for others (70%)
      const historyFields = ['medicalHistory', 'surgicalHistory', 'familyHistory', 'socialHistory'];
      const requiredConfidence = historyFields.includes(dataKey) ? 0.6 : 0.7;
      
      if (bestMatch && bestScore >= requiredConfidence) {
        console.log(`[Cross-Tab Autofill] Matched to field: "${bestMatch.identifier}" (confidence: ${(bestScore * 100).toFixed(0)}%)`);
        mappings.push({
          field: bestMatch,
          value: dataValue,
          dataKey: dataKey,
          confidence: bestScore
        });
        usedFields.add(bestMatch.element); // Mark as used
      } else {
        console.log(`[Cross-Tab Autofill] ❌ No match found (best score: ${(bestScore * 100).toFixed(0)}%)`);
      }
    }

    return mappings;
  }

  calculateMatchScore(identifier, keywords) {
    let maxScore = 0;
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (identifier === keywordLower) return 1.0;
      if (identifier.includes(keywordLower)) {
        const score = keywordLower.length / identifier.length;
        maxScore = Math.max(maxScore, score * 0.9);
      }
      const words = identifier.split(/\s+/);
      for (const word of words) {
        if (word === keywordLower) {
          maxScore = Math.max(maxScore, 0.8);
        } else if (word.includes(keywordLower) || keywordLower.includes(word)) {
          maxScore = Math.max(maxScore, 0.6);
        }
      }
    }
    return maxScore;
  }

  async fillFields(mappings) {
    for (const mapping of mappings) {
      try {
        await this.fillField(mapping.field, mapping.value);
        await this.sleep(100);
      } catch (error) {
        console.error('[Cross-Tab Autofill] Error filling field:', error);
      }
    }
  }

  async fillField(fieldInfo, value) {
    const element = fieldInfo.element;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.sleep(100);
    this.highlightField(element);

    switch (fieldInfo.type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'number':
      case 'date':
      case 'textarea':
        this.fillTextInput(element, value);
        break;
      case 'select':
        this.fillSelectField(element, value);
        break;
      case 'radio':
        this.fillRadioButton(element, value);
        break;
      case 'checkbox':
        this.fillCheckbox(element, value);
        break;
    }
  }

  fillTextInput(element, value) {
    element.focus();
    const setter = Object.getOwnPropertyDescriptor(
      element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  fillSelectField(element, value) {
    const options = Array.from(element.options);
    let matchedOption = options.find(opt => 
      opt.value.toLowerCase() === value.toLowerCase() ||
      opt.text.toLowerCase() === value.toLowerCase()
    );
    if (!matchedOption) {
      matchedOption = options.find(opt =>
        opt.text.toLowerCase().includes(value.toLowerCase()) ||
        value.toLowerCase().includes(opt.text.toLowerCase())
      );
    }
    if (matchedOption) {
      element.value = matchedOption.value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  fillRadioButton(element, value) {
    const name = element.name;
    const radioButtons = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
    for (const radio of radioButtons) {
      const label = this.getFieldLabel(radio);
      const radioValue = radio.value.toLowerCase();
      const valueLower = value.toLowerCase();
      if (radioValue === valueLower || 
          label.toLowerCase().includes(valueLower) ||
          valueLower.includes(radioValue)) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }

  fillCheckbox(element, value) {
    const valueLower = value.toLowerCase();
    const shouldCheck = ['yes', 'true', '1', 'checked', 'on'].includes(valueLower);
    if (element.checked !== shouldCheck) {
      element.checked = shouldCheck;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  highlightField(element) {
    const originalOutline = element.style.outline;
    const originalTransition = element.style.transition;
    element.style.transition = 'outline 0.3s';
    element.style.outline = '3px solid #10b981';
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, 1000);
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Initialize
const crossTabAutofill = new CrossTabAutofill();
console.log('[Cross-Tab Autofill] Ready!');
