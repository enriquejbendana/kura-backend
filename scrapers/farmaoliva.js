const puppeteer = require('puppeteer');

const scrapeFarmaoliva = async (query, sharedBrowser) => {
  console.log(`[Farmaoliva] Iniciando búsqueda de: ${query}`);
  const url = `https://www.farmaoliva.com.py/catalogo?q=${encodeURIComponent(query)}`;
  
  let browser = sharedBrowser;
  let closeBrowser = false;
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled']
      });
      closeBrowser = true;
    }
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

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

    await new Promise(r => setTimeout(r, 1000));
    
    const products = await page.evaluate(() => {
      const results = [];
      const elementsToParse = document.querySelectorAll('.product-item, .card, [class*="product"]');
      
      elementsToParse.forEach((el, index) => {
        if (index > 9) return;
        
        const titleEl = el.querySelector('.product-title, h2, h3');
        const priceEl = el.querySelector('.price, .precio');
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
              id: `oli-${index}`,
              commercialName: titleText,
              composition: '---',
              laboratory: 'Desconocido',
              details: 'Extraído en vivo',
              imageUrl: imageUrl,
              prices: [
                {
                  pharmacy: {
                    id: 'farmaoliva',
                    name: 'Farmaoliva',
                    class: 'badge-farmaoliva'
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
    console.error('[Farmaoliva] Error en scraping:', error.message);
    return { error: true, message: 'Caído o no responde', pharmacy: { id: 'farmaoliva', name: 'Farmaoliva' } };
  } finally {
    if (browser) if (closeBrowser) { await browser.close(); }
  }
};

module.exports = { scrapeFarmaoliva };
