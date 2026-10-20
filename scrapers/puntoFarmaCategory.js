const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const scrapePuntoFarmaCategory = async (categoryUrl, pageNumber, sharedBrowser) => {
  const url = `${categoryUrl}?page=${pageNumber}`;
  console.log(`[Punto Farma] Extrayendo: ${url}`);
  
  let browser = sharedBrowser;
  let closeBrowser = false;
  let page = null;
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        protocolTimeout: 120000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled']
      });
      closeBrowser = true;
    }
    page = await browser.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Check if we hit a 404 or empty page
    const is404 = await page.$('.error-404, .no-results').catch(()=>null);
    if (is404) return [];

    await page.waitForSelector('.card-title, .product-title, .name', { timeout: 15000 }).catch(() => console.log('[Punto Farma] Timeout esperando cards'));
    
    // Auto-scroll
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 100;
        let loops = 0;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          loops++;
          if(totalHeight >= scrollHeight - window.innerHeight || loops > 30){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    const products = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[class*="cardProducto"], #listado-productos .card, .product-item'); 
      const elementsToParse = cards.length > 0 ? cards : document.querySelectorAll('.card, [class*="product"]');
      
      elementsToParse.forEach((el, index) => {
        const titleEl = el.querySelector('h2, h3, .product-title, .name, .card-title');
        // Ignore 'cupon' images to get the actual product image
        const imgs = Array.from(el.querySelectorAll('img'));
        const imgEl = imgs.find(img => !(img.src || '').includes('cupon') && !(img.getAttribute('data-src') || '').includes('cupon'));
        
        if (titleEl) {
          const titleText = titleEl.innerText.trim();
          const cardText = el.innerText;
          const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.getAttribute('data-lazy-src') || imgEl.src) : null;
          
          // 1. Extraer precio normal web para todos los clientes (priceSection)
          const priceSection = el.querySelector('[class*="priceSection"], .precios-producto');
          let normalPrice = null;
          let originalPrice = null;

          if (priceSection) {
            const delEl = priceSection.querySelector('del, strike, s, [class*="precioSinDescuento"]');
            if (delEl) {
              const matchDel = delEl.innerText.match(/Gs\.\s*([\d.]+)/);
              if (matchDel) originalPrice = parseInt(matchDel[1].replace(/\./g, ''), 10);
            }

            const discountedEl = priceSection.querySelector('[class*="precioConDescuento"], [class*="precioActual"]');
            if (discountedEl) {
              const m = discountedEl.innerText.match(/Gs\.\s*([\d.]+)/);
              if (m) normalPrice = parseInt(m[1].replace(/\./g, ''), 10);
            }

            if (!normalPrice) {
              const leafPriceEls = Array.from(priceSection.querySelectorAll('*')).filter(node => {
                return node.children.length === 0 && 
                       /Gs\.\s*[\d.]+/.test(node.innerText) && 
                       !node.closest('del, strike, s, [class*="precioSinDescuento"]');
              });
              if (leafPriceEls.length > 0) {
                const m = leafPriceEls[0].innerText.match(/Gs\.\s*([\d.]+)/);
                if (m) normalPrice = parseInt(m[1].replace(/\./g, ''), 10);
              }
            }
          }

          // Fallback general si no se encontró priceSection
          if (!normalPrice) {
            const pricesMatches = [...cardText.matchAll(/Gs\.\s*([\d.]+)/g)];
            if (pricesMatches.length > 0) {
              const allPrices = pricesMatches.map(m => parseInt(m[1].replace(/\./g, ''), 10));
              normalPrice = allPrices[0];
            }
          }

          if (!originalPrice && normalPrice) {
            originalPrice = normalPrice;
          }

          let discountPercentage = 0;
          if (originalPrice > normalPrice) {
            discountPercentage = Math.round(((originalPrice - normalPrice) / originalPrice) * 100);
          }
          
          if (titleText && normalPrice) {
            results.push({
              commercialName: titleText,
              query: titleText, // We use the exact name as query to allow normalization to group it
              price: normalPrice,
              original_price: originalPrice,
              discount_percentage: discountPercentage,
              pharmacy_id: 'punto_farma',
              image_url: imageUrl
            });
          }
        }
      });
      return results;
    });

    return products;
  } catch (error) {
    console.error('[Punto Farma] Error en scraping category:', error.message);
    return [];
  } finally {
    if (page && !page.isClosed()) { await page.close().catch(() => {}); }
    if (browser) if (closeBrowser) { await browser.close(); }
  }
};

module.exports = { scrapePuntoFarmaCategory };
