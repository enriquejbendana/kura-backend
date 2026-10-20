const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');

// Obtener los 250 términos farmacéuticos principales de IQVIA
const getSeedTerms = () => {
  const seedsPath = path.join(__dirname, '..', 'iqvia_seeds.json');
  if (fs.existsSync(seedsPath)) {
    try {
      const allSeeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
      return allSeeds.slice(0, 250);
    } catch (e) {
      console.error('[Farmaoliva] Error leyendo iqvia_seeds.json:', e.message);
    }
  }
  // Fallback con los medicamentos esenciales más buscados
  return [
    'KITADOL', 'ACTRON', 'NOVALGINA', 'SEGURA', 'ZATIFEN', 'SELENE', 'PRODENT',
    'ACCORD', 'UNIGALEN', 'CORTAGRIP', 'ETIDOL', 'ANGRIPAS', 'PRONTA', 'BIOGRAMON',
    'ANALER', 'NOVOGRIP', 'ABRILAR', 'CLINOMIN', 'BERAFEN', 'MESIGYNA', 'MICARDIS',
    'DOLO', 'TELMINEST', 'HIPERCOR', 'FINIDOL', 'MIRACLE', 'EUROGESIC', 'LERCADIP',
    'PIASCLEDINE', 'TEMISAR', 'TEMLOSAL', 'NAFAZOLINA', 'ALKA-SELTZER', 'HIDROLAGENO',
    'HYNDRIAX', 'BISOLVON', 'ACOTOL', 'AMLO', 'PARACETAMOL', 'AMOXICILINA', 'IBUPROFENO'
  ];
};

const scrapeFarmaolivaBatch = async (customTerms = null, onProgress = null) => {
  const terms = customTerms && customTerms.length > 0 ? customTerms : getSeedTerms();
  console.log(`\n[Farmaoliva] Iniciando extracción batch de catálogo con ${terms.length} términos sembrados...`);

  let browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const collectedItems = [];
  const errors = [];
  let termIndex = 0;

  try {
    let page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const term of terms) {
      termIndex++;
      // Auto-limpieza cada 50 términos para evitar fugas de memoria
      if (termIndex > 1 && termIndex % 50 === 0) {
        console.log(`[Farmaoliva Lifecycle] 50 términos procesados (${termIndex}/${terms.length}). Reiniciando Chromium...`);
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        browser = await puppeteer.launch({
          headless: 'new',
          protocolTimeout: 120000,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      }

      const url = `https://www.farmaoliva.com.py/catalogo?q=${encodeURIComponent(term)}`;
      
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });

        // Auto-scroll para disparar lazy loading
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 150;
            let loops = 0;
            const timer = setInterval(() => {
              window.scrollBy(0, distance);
              totalHeight += distance;
              loops++;
              if (totalHeight >= document.body.scrollHeight - window.innerHeight || loops > 15) {
                clearInterval(timer);
                resolve();
              }
            }, 80);
          });
        });

        const products = await page.evaluate(() => {
          const results = [];
          const cards = document.querySelectorAll('.product-item, .card, [class*="product"]');

          cards.forEach(el => {
            const titleEl = el.querySelector('.product-title, h2, h3, .name, [class*="title"]');
            const priceEl = el.querySelector('.price, .precio, [class*="price"]');
            const imgEl = el.querySelector('img');

            if (titleEl && priceEl) {
              const titleText = titleEl.innerText.trim();
              const priceMatches = priceEl.innerText.match(/\d[\d\.,]*/g);
              let parsedPrice = 0;
              if (priceMatches) {
                const prices = priceMatches.map(str => parseInt(str.replace(/[^\d]/g, ''), 10)).filter(p => p > 0);
                if (prices.length > 0) parsedPrice = Math.min(...prices);
              }

              let imageUrl = null;
              if (imgEl) {
                imageUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.src;
              }

              if (titleText && parsedPrice > 0) {
                results.push({
                  commercialName: titleText,
                  query: titleText,
                  price: parsedPrice,
                  original_price: parsedPrice,
                  discount_percentage: 0,
                  pharmacy_id: 'farmaoliva',
                  image_url: imageUrl
                });
              }
            }
          });
          return results;
        });

        if (products && products.length > 0) {
          collectedItems.push(...products);
          console.log(`[Farmaoliva] (${termIndex}/${terms.length}) '${term}': ${products.length} productos encontrados.`);
        }

        if (onProgress) onProgress(termIndex, terms.length, collectedItems.length);

        // Pausa respetuosa de 1.5s entre pedidos
        await new Promise(r => setTimeout(r, 1500));

      } catch (err) {
        console.warn(`[Farmaoliva] Error consultando '${term}': ${err.message}`);
        errors.push(`Error en término '${term}': ${err.message}`);
      }
    }

    await page.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  // Deduplicar por nombre comercial
  const uniqueMap = new Map();
  for (const item of collectedItems) {
    if (!item || !item.commercialName) continue;
    const key = item.commercialName.trim().toLowerCase();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }

  const cleanResults = Array.from(uniqueMap.values());
  console.log(`\n[Farmaoliva] Extracción finalizada. Total únicos obtenidos: ${cleanResults.length} productos.`);
  return { results: cleanResults, errors };
};

module.exports = { scrapeFarmaolivaBatch };
