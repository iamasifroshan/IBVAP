import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Navigate to frontend
  await page.goto('http://localhost:5173');
  
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/videos/12522257-hd_1920_1080_24fps.mp4', {
        headers: { 'Range': 'bytes=0-1000' }
      });
      return { ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers.entries()) };
    } catch (e) {
      return { error: e.message };
    }
  });
  
  console.log("Fetch Result:", result);
  
  const videoTest = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      
      v.oncanplay = () => resolve({ event: 'canplay', width: v.videoWidth });
      v.onerror = () => resolve({ event: 'error', error: v.error ? v.error.message || v.error.code : 'unknown' });
      
      v.src = 'http://127.0.0.1:8000/videos/12522257-hd_1920_1080_24fps.mp4';
    });
  });
  
  console.log("Video Test:", videoTest);
  
  await browser.close();
})();
