const puppeteer = require('puppeteer');

const scrapeFarmacenter = async (query, sharedBrowser) => {
  console.log(`[Farmacenter] Iniciando búsqueda de: ${query}`);
  const url = `https://www.farmacenter.com.py/catalogo?q=${encodeURIComponent(query)}`;
  
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
      const elementsToParse = document.querySelectorAll('.info, [class*="product"]');
      
      elementsToParse.forEach((el, index) => {
        if (index > 9) return; // Limite 10
        
        const titleEl = el.querySelector('a.tit h2, .product-title, h3');
        const priceEl = el.querySelector('.precio.venta .monto, .price');
        // A veces la imagen está en el contenedor padre o hermano
        const imgEl = el.parentElement?.querySelector('img') || el.querySelector('img');
        
        if (titleEl && priceEl) {
          const titleText = titleEl.innerText.trim();
          const cardText = el.innerText;
          const cardHtml = el.innerHTML;
          const priceMatches = cardText.match(/\d[\d\.,]*/g);
          const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.getAttribute('data-lazy-src') || imgEl.src) : null;
          
          if (priceMatches) {
            const allPrices = priceMatches.map(str => parseInt(str.replace(/[^\d]/g, ''), 10)).filter(p => p > 1000);
            const uniquePrices = [...new Set(allPrices)].sort((a, b) => a - b);
            
            if (uniquePrices.length > 0 && titleText) {
              let normalPrice = uniquePrices[0];
              let specialPrice = null;
              let specialMethod = null;
              
              const methodMatches = [
                { regex: /ita[uú]\s*qr/i, name: "Itaú QR" },
                { regex: /ita[uú]/i, name: "Itaú" },
                { regex: /basa/i, name: "Basa" },
                { regex: /ueno/i, name: "Ueno" },
                { regex: /familiar/i, name: "Familiar" },
                { regex: /sudameris/i, name: "Sudameris" }
              ];
              
              const textAndHtml = cardText + " " + cardHtml;
              const foundMethods = methodMatches.filter(m => m.regex.test(textAndHtml));
              
              if (foundMethods.length > 0 && uniquePrices.length > 1) {
                specialMethod = "Con " + foundMethods[0].name;
                specialPrice = uniquePrices[0];
                normalPrice = uniquePrices[1];
              } else {
                normalPrice = uniquePrices[0];
              }
              
              results.push({
                id: `fc-${index}`,
                commercialName: titleText,
                composition: '---',
                laboratory: 'Desconocido',
                details: 'Extraído en vivo',
                imageUrl: imageUrl,
                prices: [
                  {
                    pharmacy: {
                      id: 'farmacenter',
                      name: 'Farmacenter',
                      class: 'badge-farmacenter'
                    },
                    price: normalPrice,
                    normalPrice: normalPrice,
                    specialPrice: specialPrice,
                    specialMethod: specialMethod
                  }
              ]
            });
            }
          }
        }
      });
      return results;
    });

    return products;
  } catch (error) {
    console.error('[Farmacenter] Error en scraping:', error.message);
    return { error: true, message: 'Caído o no responde', pharmacy: { id: 'farmacenter', name: 'Farmacenter' } };
  } finally {
    if (browser) if (closeBrowser) { await browser.close(); }
  }
};

module.exports = { scrapeFarmacenter };
