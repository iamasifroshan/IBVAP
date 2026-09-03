const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Array to hold logs
  const logs = [];

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[MODAL DEBUG]') || text.includes('[CAMERA_ANALYSIS]')) {
      console.log(text);
      logs.push(text);
    }
  });

  page.on('request', request => {
    if (request.url().includes('detect-frame')) {
      console.log(`[NETWORK] REQ -> ${request.method()} ${request.url()}`);
    }
  });

  page.on('response', async response => {
    if (response.url().includes('detect-frame')) {
      console.log(`[NETWORK] RES <- ${response.status()} ${response.url()}`);
      try {
        const text = await response.text();
        console.log(`[NETWORK] RES BODY: ${text.substring(0, 300)}`);
      } catch (e) {
        console.log(`[NETWORK] RES BODY ERROR: ${e.message}`);
      }
    }
  });

  console.log("Navigating to dashboard...");
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle2' });

  console.log("Finding camera SECTOR-B-CAM-03...");
  // Try to find the camera button or wait a bit
  await page.waitForTimeout(2000);
  
  // The UI might require clicking on the camera card or a specific "Camera Analysis" button.
  // I will just evaluate script to click it.
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    // We want the analysis button for SECTOR-B-CAM-03
    // It could be in the Live Surveillance Page or Dashboard.
    const analysisBtn = buttons.find(b => b.textContent.includes('Analyze') || b.textContent.includes('Analysis') || b.title?.includes('Analysis'));
    if (analysisBtn) analysisBtn.click();
    
    // Alternatively, just dispatch a custom event or click the exact one if known.
    // Let's try to click the first camera card's analysis button.
  });

  // Let's wait a bit and see if modal opens
  await page.waitForTimeout(2000);
  
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const runBtn = buttons.find(b => b.textContent.includes('Run YOLO Inference') || b.textContent.includes('Run Inference'));
    if (runBtn) runBtn.click();
  });

  console.log("Waiting 15 seconds...");
  await page.waitForTimeout(15000);

  console.log("Done collecting logs.");
  
  await browser.close();
})();
