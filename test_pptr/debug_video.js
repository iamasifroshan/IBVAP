const puppeteer = require('puppeteer');

const delay = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', request => {
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText);
  });
  page.on('response', response => {
    if (response.url().includes('.mp4')) {
      console.log('MP4 RESPONSE STATUS:', response.status());
      console.log('MP4 RESPONSE HEADERS:', response.headers());
    }
  });

  await page.goto('http://localhost:5173');
  await delay(2000);
  
  const cameras = await page.$$('text/BOP-NORTH-02');
  if (cameras.length > 0) {
    await cameras[0].click();
  }

  await delay(1000);
  const analysisBtn = await page.$$('text/Camera Analysis');
  if (analysisBtn.length > 0) {
    await analysisBtn[0].click();
  }

  await delay(5000);
  await browser.close();
})();
