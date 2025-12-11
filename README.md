# EMR Smart Autofill v1.0

**Seamless transcription transfer and form filling across tabs**

## Key Features

- **Cross-Tab Autofill**: Automatically transfers transcriptions from your transcription app to EMR forms
- **Smart Field Detection**: Intelligently maps transcribed data to the appropriate form fields
- **Reliable & Robust**: Handles various edge cases with proper error handling
- **Minimal UI**: Works in the background without intrusive popups
- **Secure**: Processes all data locally in your browser

## Quick Start

### 1. Install the Extension

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **"Developer mode"** (top-right toggle)
4. Click **"Load unpacked"**
5. Select the directory where you cloned/downloaded the extension

### 2. Using the Extension

1. **Start a transcription session** in your preferred transcription app
2. **Complete your dictation** as usual
3. **Switch to your EMR** - the extension will automatically:
   - Detect the EMR tab
   - Transfer the transcription
   - Fill in the appropriate fields
   - Focus the EMR tab

### 3. Manual Paste (Fallback)

If auto-transfer doesn't work:
1. Copy the transcription text
2. Paste into any field in your EMR
3. The extension will process and fill other fields automatically

## 🔧 Troubleshooting

- **Extension not working?**
  - Ensure it's enabled in `chrome://extensions/`
  - Check the browser console for errors (Right-click → Inspect → Console)
  - Verify you're on a supported domain (check manifest.json for allowed domains)

- **Fields not filling correctly?**
  - Ensure the EMR form is fully loaded
  - Try refreshing the page
  - Check console for any error messages

## Requirements

- Google Chrome 88 or later
- No external dependencies required



3. **Watch the magic!** 
   - Form auto-fills
   - Pasted field clears
   - Green notification appears

---
