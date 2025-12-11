class SmartAutofill {
  constructor() {
    this.isProcessing = false;
    this.timeout = 120000; 
    this.init();
  }

  init() {
    console.log('[Smart Autofill] Initialized - watching for paste events');
    
    document.addEventListener('paste', (e) => {
      const target = e.target;
      
      
      if (this.isFormField(target)) {
        setTimeout(() => {
          this.handlePaste(target);
        }, 100);
      }
    }, true);

    
    document.addEventListener('input', (e) => {
      const target = e.target;
      
      if (this.isFormField(target) && target.value.length > 50) {
        if (this.looksLikeStructuredData(target.value)) {
          this.handlePaste(target);
        }
      }
    }, true);
  }

  
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

  async handlePaste(sourceField) {
    if (this.isProcessing) {
      console.log('[Smart Autofill] Already processing, skipping');
      return;
    }

    const pastedText = sourceField.value.trim();
    
    if (!pastedText || pastedText.length < 10) {
      return;
    }

    console.log('[Smart Autofill] Detected structured text, processing...');
    this.isProcessing = true;

    try {
      const parsedData = this.parseStructuredText(pastedText);
      
      if (Object.keys(parsedData.fields).length === 0) {
        console.log('[Smart Autofill] No structured data found');
        this.isProcessing = false;
        return;
      }

      console.log('[Smart Autofill] Extracted fields:', parsedData.fields);
      const formFields = this.detectFormFields(sourceField);
      console.log(`[Smart Autofill] Found ${formFields.length} form fields`);
      const mappings = this.mapDataToFields(parsedData, formFields);
      console.log(`[Smart Autofill] Matched ${mappings.length} fields`);

      await this.fillFields(mappings);

      this.clearSourceField(sourceField);

      console.log('[Smart Autofill] Autofill completed successfully');

      this.showNotification('Form auto-filled successfully!', 'success');

    } catch (error) {
      console.error('[Smart Autofill] Error:', error);
      this.showNotification('Autofill failed: ' + error.message, 'error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Parse structured text into fields
   */
  parseStructuredText(text) {
    const parsed = {
      raw: text,
      fields: {}
    };

    // Common medical field patterns
    const patterns = {
      // Patient info
      name: /(?:patient\s+name|name|patient)[:\s]+([^\n,]+?)(?=\n|,|$)/i,
      age: /(?:age)[:\s]+(\d+)/i,
      dob: /(?:date\s+of\s+birth|dob|birth\s+date)[:\s]+([^\n,]+?)(?=\n|,|$)/i,
      gender: /(?:gender|sex)[:\s]+(male|female|other|m|f)/i,
      
      // Vitals
      bloodPressure: /(?:blood\s+pressure|bp)[:\s]+(\d+\/\d+)/i,
      heartRate: /(?:heart\s+rate|pulse|hr)[:\s]+(\d+)/i,
      temperature: /(?:temperature|temp)[:\s]+([\d.]+)/i,
      weight: /(?:weight|wt)[:\s]+([\d.]+)/i,
      height: /(?:height|ht)[:\s]+([^\n,]+?)(?=\n|,|$)/i,
      
      // Clinical
      chiefComplaint: /(?:chief\s+complaint|cc|complaint|reason\s+for\s+visit)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      diagnosis: /(?:diagnosis|dx)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      symptoms: /(?:symptoms|presenting\s+symptoms)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      allergies: /(?:allergies|allergy)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      medications: /(?:medications|meds|current\s+medications)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      
      // History
      medicalHistory: /(?:medical\s+history|pmh|past\s+medical\s+history)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      surgicalHistory: /(?:surgical\s+history|psh)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      familyHistory: /(?:family\s+history|fh)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      socialHistory: /(?:social\s+history|sh)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      
      // Assessment & Plan
      assessment: /(?:assessment)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      plan: /(?:plan|treatment\s+plan)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i,
      notes: /(?:notes|additional\s+notes|comments)[:\s]+([^\n]+?)(?=\n(?:[A-Z])|$)/i
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match && match[1]) {
        parsed.fields[key] = match[1].trim();
      }
    }

    return parsed;
  }

  /**
   * Detect all fillable form fields (excluding source field)
   */
  detectFormFields(sourceField) {
    const fields = [];
    
    const inputs = document.querySelectorAll('input:not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea, select');
    
    inputs.forEach((element, index) => {
      // Skip the source field
      if (element === sourceField) {
        return;
      }

      if (!this.isFieldVisible(element)) {
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
      fields.push(fieldInfo);
    });

    return fields;
  }


  isFieldVisible(element) {
    if (!element.offsetParent && element.offsetWidth === 0 && element.offsetHeight === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    return true;
  }

  getFieldType(element) {
    if (element.tagName === 'TEXTAREA') {
      return 'textarea';
    } else if (element.tagName === 'SELECT') {
      return 'select';
    } else if (element.tagName === 'INPUT') {
      return element.type.toLowerCase() || 'text';
    }
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

    const fieldKeywords = {
      name: ['name', 'patient name', 'full name', 'patient'],
      age: ['age'],
      dob: ['date of birth', 'dob', 'birth date', 'birthday'],
      gender: ['gender', 'sex'],
      bloodPressure: ['blood pressure', 'bp', 'pressure'],
      heartRate: ['heart rate', 'pulse', 'hr'],
      temperature: ['temperature', 'temp'],
      weight: ['weight', 'wt'],
      height: ['height', 'ht'],
      chiefComplaint: ['chief complaint', 'cc', 'complaint', 'reason for visit'],
      diagnosis: ['diagnosis', 'dx'],
      symptoms: ['symptoms', 'presenting symptoms'],
      allergies: ['allergies', 'allergy'],
      medications: ['medications', 'meds', 'current medications'],
      medicalHistory: ['medical history', 'pmh', 'past medical history'],
      surgicalHistory: ['surgical history', 'psh'],
      familyHistory: ['family history', 'fh'],
      socialHistory: ['social history', 'sh'],
      assessment: ['assessment'],
      plan: ['plan', 'treatment plan'],
      notes: ['notes', 'additional notes', 'comments']
    };

    for (const [dataKey, dataValue] of Object.entries(parsedData.fields)) {
      const keywords = fieldKeywords[dataKey] || [dataKey];
      
      let bestMatch = null;
      let bestScore = 0;

      for (const field of fields) {
        if (field.readonly || field.disabled) continue;

        const score = this.calculateMatchScore(field.identifier, keywords);
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = field;
        }
      }

      if (bestMatch && bestScore > 0.3) {
        mappings.push({
          field: bestMatch,
          value: dataValue,
          dataKey: dataKey,
          confidence: bestScore
        });
      }
    }

    return mappings;
  }

  calculateMatchScore(identifier, keywords) {
    let maxScore = 0;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      
      if (identifier === keywordLower) {
        return 1.0;
      }

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
        console.error('[Smart Autofill] Error filling field:', error);
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

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;

    if (element.tagName === 'TEXTAREA') {
      nativeTextAreaValueSetter.call(element, value);
    } else {
      nativeInputValueSetter.call(element, value);
    }

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

  clearSourceField(field) {
    setTimeout(() => {
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[Smart Autofill] Source field cleared');
    }, 500);
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

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

const smartAutofill = new SmartAutofill();
console.log('[Smart Autofill] Ready - paste structured text into any field!');
