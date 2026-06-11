const puppeteer = require('puppeteer');

const scrapePuntoFarma = async (query) => {
  console.log(`[Punto Farma] Iniciando búsqueda de: ${query}`);
  const url = `https://www.puntofarma.com.py/buscar?s=${encodeURIComponent(query)}`;
  
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    
    // Bloquear recursos innecesarios para mayor velocidad
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
    
    // Auto-scroll para lazy loading
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

    // Pequeña espera extra para que renderice
    await new Promise(r => setTimeout(r, 1000));

    const products = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('.card'); 
      const elementsToParse = cards.length > 0 ? cards : document.querySelectorAll('[class*="product"]');
      
      elementsToParse.forEach((el, index) => {
        if (index > 9) return; // Aumentamos límite a 10
        
        const titleEl = el.querySelector('h2, h3, .product-title, .name, .card-title');
        const imgEl = el.querySelector('img');
        
        if (titleEl) {
          const titleText = titleEl.innerText.trim();
          const cardText = el.innerText;
          const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.getAttribute('data-lazy-src') || imgEl.src) : null;
          
          const priceMatch = cardText.match(/Gs\.\s*([\d.]+)/);
          
          if (titleText && priceMatch) {
            const priceText = priceMatch[1].replace(/\./g, '');
            
            results.push({
              id: `pf-${index}`,
              commercialName: titleText,
              composition: '---',
              laboratory: 'Desconocido',
              details: 'Extraído en vivo',
              imageUrl: imageUrl,
              prices: [
                {
                  pharmacy: {
                    id: 'punto-farma',
                    name: 'Punto Farma',
                    class: 'badge-punto-farma'
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
    console.error('[Punto Farma] Error en scraping:', error.message);
    return { error: true, message: 'Caído o no responde', pharmacy: { id: 'punto-farma', name: 'Punto Farma' } };
  } finally {
    if (browser) await browser.close();
  }
};

module.exports = { scrapePuntoFarma };
