const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const scrapeFarmacenterCategory = async (categoryUrl, pageNumber, sharedBrowser = null) => {
  const url = `${categoryUrl}?js=1&pag=${pageNumber}`;
  console.log(`[Farmacenter] Extrayendo: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'text/html, */*; q=0.01'
      }
    });

    if (!res.ok) {
      console.warn(`[Farmacenter] HTTP ${res.status} en ${url}`);
      return [];
    }

    const html = await res.text();
    if (!html || html.length < 500) {
      return [];
    }

    let browser = sharedBrowser;
    let closeBrowser = false;
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });
      closeBrowser = true;
    }

    const page = await browser.newPage();
    try {
      await page.setContent(html);

      const products = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll('.cnt, .info');
        const seenNames = new Set();

        cards.forEach(card => {
          const titleEl = card.querySelector('a.tit h2, .product-title, h3, a.tit');
          const priceVentaEl = card.querySelector('.precio.venta .monto, strong.precio .monto');
          const priceListaEl = card.querySelector('.precio.lista .monto, del.precio .monto');
          const imgEl = card.querySelector('img[src*="catalogo"], a.img img:not([class*="ico"])') || card.querySelector('img');

          if (titleEl && priceVentaEl) {
            const titleText = titleEl.innerText.trim();
            if (seenNames.has(titleText)) return;
            seenNames.add(titleText);

            const priceNum = parseInt(priceVentaEl.innerText.replace(/[^\d]/g, ''), 10);
            let originalPriceNum = priceNum;
            if (priceListaEl) {
              const origParsed = parseInt(priceListaEl.innerText.replace(/[^\d]/g, ''), 10);
              if (origParsed && origParsed > priceNum) originalPriceNum = origParsed;
            }

            let discountPercentage = 0;
            if (originalPriceNum > priceNum) {
              discountPercentage = Math.round(((originalPriceNum - priceNum) / originalPriceNum) * 100);
            }

            let imageUrl = null;
            if (imgEl) {
              const src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src');
              if (src) {
                imageUrl = src.startsWith('//') ? `https:${src}` : src;
              }
            }

            if (titleText && priceNum > 0) {
              results.push({
                commercialName: titleText,
                query: titleText,
                price: priceNum,
                original_price: originalPriceNum,
                discount_percentage: discountPercentage,
                pharmacy_id: 'farmacenter',
                image_url: imageUrl
              });
            }
          }
        });

        return results;
      });

      // Pausa respetuosa de 1.5s para no sobrecargar el servidor
      await new Promise(r => setTimeout(r, 1500));

      return products;
    } finally {
      await page.close().catch(() => {});
      if (closeBrowser) await browser.close().catch(() => {});
    }
  } catch (error) {
    console.error(`[Farmacenter] Error extrayendo pág ${pageNumber}:`, error.message);
    return [];
  }
};

module.exports = { scrapeFarmacenterCategory };
