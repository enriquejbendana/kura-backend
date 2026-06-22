const puppeteer = require('puppeteer');

const scrapeCatedral = async (query, sharedBrowser = null) => {
  console.log(`[Catedral] Iniciando búsqueda de: ${query}`);
  const url = `https://www.farmaciacatedral.com.py/buscador?q=${encodeURIComponent(query)}`;
  
  let browser = sharedBrowser;
  let closeBrowser = false;
  let page = null;
  
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled']
      });
      closeBrowser = true;
    }
    page = await browser.newPage();
    
    /*
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    */

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 100;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if(totalHeight >= scrollHeight - window.innerHeight){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await page.waitForSelector('.card-producto', { timeout: 25000 }).catch(() => console.log('[Catedral] Timeout esperando card-producto'));
    
    const products = await page.evaluate(() => {
      const results = [];
      const elementsToParse = document.querySelectorAll('.card-producto');
      
      elementsToParse.forEach((el, index) => {
        if (index > 9) return;
        
        const titleEl = el.querySelector('.card-titulo, h2, h3');
        const priceEl = el.querySelector('.precio-principal, .precio');
        const imgEl = el.querySelector('img');
        
        if (titleEl && priceEl) {
          const titleText = titleEl.innerText.trim();
          const priceMatches = priceEl.innerText.match(/\d[\d\.,]*/g);
          let parsedPrice = 0;
          if (priceMatches) {
            const prices = priceMatches.map(str => parseInt(str.replace(/[^\d]/g, ''), 10)).filter(p => p > 0);
            if (prices.length > 0) parsedPrice = Math.min(...prices);
          }
          const priceText = parsedPrice > 0 ? parsedPrice.toString() : '';
          const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.src) : null;
          
          if (titleText && priceText) {
            results.push({
              id: `cat-${index}`,
              commercialName: titleText,
              composition: '---',
              laboratory: 'Desconocido',
              details: 'Extraído en vivo',
              imageUrl: imageUrl,
              prices: [
                {
                  pharmacy: {
                    id: 'catedral',
                    name: 'Farmacias Catedral',
                    class: 'badge-catedral'
                  },
                  price: parseInt(priceText, 10)
                }
              ]
            });
          }
        }
      });
      return results;
    });

    return products;
  } catch (error) {
    console.error('[Catedral] Error en scraping:', error.message);
    return { error: true, message: 'Caído o no responde', pharmacy: { id: 'catedral', name: 'Farmacias Catedral' } };
  } finally {
    if (page && !page.isClosed()) { await page.close().catch(() => {}); }
    if (browser) if (closeBrowser) { await browser.close(); }
  }
};

module.exports = { scrapeCatedral };
