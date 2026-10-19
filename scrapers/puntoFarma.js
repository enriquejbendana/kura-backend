const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const scrapePuntoFarma = async (query, sharedBrowser) => {
  console.log(`[Punto Farma] Iniciando búsqueda de: ${query}`);
  const url = `https://www.puntofarma.com.py/buscar?s=${encodeURIComponent(query)}`;
  
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
    
    // Dejar que stealth plugin maneje el User-Agent
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Radware Bot Manager a veces muestra una pantalla de carga y luego redirige.
    // Esperamos pacientemente a que aparezcan los resultados reales usando una clase específica del producto.
    await page.waitForSelector('.card-title', { timeout: 25000 }).catch(() => console.log('[Punto Farma] Timeout esperando card-title'));
    
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
      const cards = document.querySelectorAll('[class*="cardProducto"], #listado-productos .card, .product-item'); 
      const elementsToParse = cards.length > 0 ? cards : document.querySelectorAll('.card, [class*="product"]');
      
      elementsToParse.forEach((el, index) => {
        if (index > 20) return; // Permitir hasta 20 productos de resultados
        
        const titleEl = el.querySelector('h2, h3, .product-title, .name, .card-title');
        const imgEl = el.querySelector('img');
        
        if (titleEl) {
          const titleText = titleEl.innerText.trim();
          const cardText = el.innerText;
          const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.getAttribute('data-lazy-src') || imgEl.src) : null;
          
          const linkEl = el.querySelector('a[href*="/producto/"]') || el.querySelector('a[href]');
          let productUrl = null;
          if (linkEl && linkEl.getAttribute('href')) {
            const href = linkEl.getAttribute('href');
            productUrl = href.startsWith('http') ? href : `https://www.puntofarma.com.py${href}`;
          }

          // 1. Extraer precio normal web para todos los clientes (priceSection)
          const priceSection = el.querySelector('[class*="priceSection"], .precios-producto');
          let normalPrice = null;
          let originalPrice = null;

          if (priceSection) {
            // Precio de lista tachado si tiene descuento
            const delEl = priceSection.querySelector('del, strike, s, [class*="precioSinDescuento"]');
            if (delEl) {
              const matchDel = delEl.innerText.match(/Gs\.\s*([\d.]+)/);
              if (matchDel) originalPrice = parseInt(matchDel[1].replace(/\./g, ''), 10);
            }

            // Buscar el precio de venta web actual (no tachado)
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

          // 2. Extraer sección de descuento por método de pago / tarjeta / QR (campo aparte)
          const discountSection = el.querySelector('[class*="discountSection"], .metodos-de-pagos, .descuentos');
          let specialPrice = null;
          let specialMethod = null;

          if (discountSection) {
            const specialLeaf = Array.from(discountSection.querySelectorAll('*')).find(node => {
              return node.children.length === 0 && /Gs\.\s*[\d.]+/.test(node.innerText);
            });
            if (specialLeaf) {
              const mPrice = specialLeaf.innerText.match(/Gs\.\s*([\d.]+)/);
              if (mPrice) specialPrice = parseInt(mPrice[1].replace(/\./g, ''), 10);
            }

            const methodSmall = discountSection.querySelector('small');
            const imgMethod = discountSection.querySelector('img[alt]');
            if (methodSmall && methodSmall.innerText.trim()) {
              specialMethod = methodSmall.innerText.trim().replace(/^o pagando con\s*/i, '');
            } else if (imgMethod && imgMethod.alt) {
              specialMethod = imgMethod.alt;
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
              id: `pf-${index}`,
              commercialName: titleText,
              composition: '---',
              laboratory: 'Desconocido',
              details: discountPercentage > 0 ? `Descuento web: ${discountPercentage}% OFF` : 'Extraído en vivo',
              imageUrl: imageUrl,
              prices: [
                {
                  pharmacy: {
                    id: 'punto-farma',
                    name: 'Punto Farma',
                    class: 'badge-punto-farma'
                  },
                  price: normalPrice,
                  originalPrice: originalPrice,
                  discountPercentage: discountPercentage,
                  normalPrice: normalPrice,
                  specialPrice: specialPrice,
                  specialMethod: specialMethod,
                  url: productUrl
                }
              ],
              specialPrice: specialPrice ? { price: specialPrice, condition: specialMethod } : null,
              missingItems: 0
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
    if (page && !page.isClosed()) { await page.close().catch(() => {}); }
    if (browser) if (closeBrowser) { await browser.close(); }
  }
};

module.exports = { scrapePuntoFarma };
