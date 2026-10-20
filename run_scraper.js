require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const crypto = require('crypto');

const { scrapePuntoFarmaCategory } = require('./scrapers/puntoFarmaCategory');
const { scrapeFarmacenterCategory } = require('./scrapers/farmacenterCategory');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('🚨 =================================================================');
  console.error('🚨 [ERROR CRÍTICO] SUPABASE_SERVICE_ROLE_KEY NO ESTÁ CONFIGURADA!');
  console.error('🚨 run_scraper.js requiere permisos de service_role para escribir en Supabase.');
  console.error('🚨 Por favor agrega SUPABASE_SERVICE_ROLE_KEY en el archivo .env o en los Secrets de GitHub.');
  console.error('🚨 =================================================================');
  process.exit(1);
}

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

// Configuración de cadenas, categorías y umbrales mínimos de seguridad (Circuit Breaker)
const CHAINS_CONFIG = [
  {
    id: 'punto_farma',
    name: 'Punto Farma',
    minThreshold: 2500, // En corridas sanas extrae ~5.800 items. Si cae de 2.500, no se toca la DB.
    categories: [
      'https://www.puntofarma.com.py/categoria/1/medicamentos',
      'https://www.puntofarma.com.py/categoria/130/cuidado-personal',
      'https://www.puntofarma.com.py/categoria/32/dermocosmetica',
      'https://www.puntofarma.com.py/categoria/84/mama-y-bebe',
      'https://www.puntofarma.com.py/categoria/235/suplementos-y-vitaminas',
      'https://www.puntofarma.com.py/categoria/271/primeros-auxilios',
      'https://www.puntofarma.com.py/categoria/20/perfumes-y-fragancias',
      'https://www.puntofarma.com.py/categoria/39/cosmeticos',
      'https://www.puntofarma.com.py/categoria/58/higiene',
      'https://www.puntofarma.com.py/categoria/208/salud',
      'https://www.puntofarma.com.py/categoria/219/hogar',
      'https://www.puntofarma.com.py/categoria/226/nutricion-y-deporte',
      'https://www.puntofarma.com.py/categoria/310/cuidado-del-adulto-mayor'
    ],
    scraper: scrapePuntoFarmaCategory
  },
  {
    id: 'farmacenter',
    name: 'Farmacenter',
    minThreshold: 500, // En corridas sanas extrae ~1.400 items. Si cae de 500, no se toca la DB.
    categories: [
      'https://www.farmacenter.com.py/medicamentos',
      'https://www.farmacenter.com.py/cuidado-de-la-salud',
      'https://www.farmacenter.com.py/belleza',
      'https://www.farmacenter.com.py/bebes',
      'https://www.farmacenter.com.py/infantiles',
      'https://www.farmacenter.com.py/higiene',
      'https://www.farmacenter.com.py/alimentos',
      'https://www.farmacenter.com.py/bazar-y-hogar'
    ],
    scraper: scrapeFarmacenterCategory
  }
];

async function executeChainScraping(chainConfig) {
  console.log(`\n================================================================`);
  console.log(`🚀 Iniciando extracción: ${chainConfig.name}`);
  console.log(`🎯 Categorías a procesar: ${chainConfig.categories.length} | Umbral mínimo seguro: >= ${chainConfig.minThreshold} productos`);
  console.log(`================================================================`);

  const results = [];
  const errors = [];
  let globalPageCount = 0;

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

  for (const catUrl of chainConfig.categories) {
    let page = 1;
    let hasMore = true;
    let retries = 0;
    let lastPageSignature = '';

    while (hasMore && page <= 1000) {
      // Auto-limpieza cada 50 páginas para liberar memoria RAM
      if (globalPageCount > 0 && globalPageCount % 50 === 0) {
        console.log(`[Lifecycle] 50 páginas procesadas. Reiniciando Chromium para evitar fugas de memoria...`);
        await browser.close().catch(() => {});
        browser = await puppeteer.launch({
          headless: 'new',
          protocolTimeout: 120000,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
      if (!browser || !browser.isConnected()) {
        console.log(`[Lifecycle] Proceso Chromium desconectado. Reiniciando navegador...`);
        browser = await puppeteer.launch({
          headless: 'new',
          protocolTimeout: 120000,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
      }

      try {
        const pageItems = await chainConfig.scraper(catUrl, page, browser);

        if (pageItems && pageItems.error) {
          throw new Error(pageItems.message || 'Error desconocido en scraper');
        }

        if (!pageItems || pageItems.length === 0) {
          hasMore = false;
          console.log(`[${chainConfig.name}] Fin de categoría: ${catUrl} (pág ${page})`);
        } else {
          // Detectar repetición de página (bucle infinito de paginación)
          const currentSignature = pageItems.map(r => r.commercialName).slice(0, 5).join('|');
          if (currentSignature && currentSignature === lastPageSignature) {
            console.log(`[${chainConfig.name}] [Fin de Categoría] Detectada página repetida en ${catUrl} (pág ${page}). Finalizando categoría limpiamente.`);
            hasMore = false;
            break;
          }
          lastPageSignature = currentSignature;

          results.push(...pageItems);
          page++;
          globalPageCount++;
          retries = 0;

          // Pausa respetuosa de 1.5s entre páginas para no sobrecargar el servidor
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err) {
        console.error(`[${chainConfig.name}] Error en ${catUrl} pág ${page}: ${err.message}`);
        retries++;
        if (retries > 3) {
          const errMsg = `Fallo tras 3 reintentos en categoría ${catUrl} (pág ${page}): ${err.message}`;
          console.error(`[${chainConfig.name}] ${errMsg}. Continuando con siguiente categoría.`);
          errors.push(errMsg);
          hasMore = false;
        } else {
          console.log(`[${chainConfig.name}] Reintentando pág ${page} (Intento ${retries}/3) en 10s...`);
          await new Promise(r => setTimeout(r, 10000));
          await browser.close().catch(() => {});
          browser = await puppeteer.launch({
            headless: 'new',
            protocolTimeout: 120000,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
          });
        }
      }
    }
  }

  await browser.close().catch(() => {});
  return { results, errors };
}

async function runScraper() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] ========================================================`);
  console.log(`[${new Date().toISOString()}] INICIANDO PIPELINE DE SCRAPING NOCTURNO KURA PY`);
  console.log(`[${new Date().toISOString()}] ========================================================`);

  const summary = [];
  let successfulUpserts = 0;

  for (const chain of CHAINS_CONFIG) {
    const { results: rawResults, errors: rawErrors } = await executeChainScraping(chain);

    // Deduplicar en memoria por nombre comercial limpio
    const uniqueMap = new Map();
    for (const item of rawResults) {
      if (!item || !item.commercialName) continue;
      const key = item.commercialName.trim().toLowerCase();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    }
    const cleanResults = Array.from(uniqueMap.values());
    console.log(`\n[${chain.name}] Total extraído: ${rawResults.length} items | Deduplicado único: ${cleanResults.length} productos.`);

    // --- UMBRAL DE SEGURIDAD (CIRCUIT BREAKER) ---
    const isHealthy = cleanResults.length >= chain.minThreshold;

    if (!isHealthy) {
      console.error(`\n🚨 =================================================================`);
      console.error(`🚨 [ALERTA DE SEGURIDAD - UMBRAL NO ALCANZADO]`);
      console.error(`🚨 Cadena: ${chain.name}`);
      console.error(`🚨 Productos únicos extraídos: ${cleanResults.length}`);
      console.error(`🚨 Umbral mínimo configurado: ${chain.minThreshold}`);
      console.error(`🚨 ACCIÓN: SE RECHAZA LA ACTUALIZACIÓN DE ${chain.name.toUpperCase()}.`);
      console.error(`🚨 Los datos existentes en medicamentos_cache permanecerán INTACTOS.`);
      console.error(`🚨 =================================================================\n`);

      summary.push({
        chain: chain.name,
        extracted: cleanResults.length,
        threshold: chain.minThreshold,
        status: '🚨 RECHAZADO (Bajo umbral)',
        dbAction: 'Preservado (sin cambios)',
        errors: rawErrors
      });
    } else {
      console.log(`✅ [APROBADO] ${chain.name}: ${cleanResults.length} productos cumplen el umbral mínimo (>= ${chain.minThreshold}).`);
      console.log(`📦 Aplicando upsert seguro en lotes de 500 en medicamentos_cache...`);

      const chunkSize = 500;
      let upsertErrors = 0;

      for (let i = 0; i < cleanResults.length; i += chunkSize) {
        const chunk = cleanResults.slice(i, i + chunkSize);
        const cacheMap = new Map();

        chunk.forEach(item => {
          const cleanName = item.commercialName.trim();
          const stableId = `${item.pharmacy_id}-${crypto.createHash('md5').update(cleanName.toLowerCase()).digest('hex').substring(0, 10)}`;
          cacheMap.set(stableId, {
            product_id: stableId,
            pharmacy_id: item.pharmacy_id,
            query: (item.query || cleanName).toLowerCase(),
            commercial_name: cleanName,
            price: item.price,
            original_price: item.original_price || item.price,
            discount_percentage: item.discount_percentage || null,
            image_url: item.image_url,
            updated_at: new Date().toISOString()
          });
        });

        const cacheItems = Array.from(cacheMap.values());
        const { error: upsertErr } = await supabase
          .from('medicamentos_cache')
          .upsert(cacheItems, { onConflict: 'product_id' });

        if (upsertErr) {
          console.error(`[${chain.name}] Error en upsert lote ${i} - ${i + chunk.length}:`, upsertErr.message);
          upsertErrors++;
        }
      }

      successfulUpserts++;
      summary.push({
        chain: chain.name,
        extracted: cleanResults.length,
        threshold: chain.minThreshold,
        status: upsertErrors === 0 ? '✅ APROBADO' : '⚠️ PARCIAL',
        dbAction: `Actualizados ${cleanResults.length} en DB`,
        errors: rawErrors
      });
    }
  }

  // --- RESUMEN FINAL FORMATEADO ---
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const durationMin = Math.floor(durationSec / 60);
  const durationRemainingSec = durationSec % 60;

  console.log('\n');
  console.log('================================================================================');
  console.log('📊 RESUMEN FINAL DE EJECUCIÓN - SCRAPER KURA PY');
  console.log('================================================================================');
  console.log(`⏰ Inicio: ${new Date(startTime).toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}`);
  console.log(`⏰ Fin:    ${new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}`);
  console.log(`⏱️ Duración Total: ${durationMin}m ${durationRemainingSec}s\n`);

  console.log('--------------------------------------------------------------------------------');
  console.log(
    'Cadena'.padEnd(16) +
    '| ' + 'Extraídos'.padEnd(12) +
    '| ' + 'Umbral Mín.'.padEnd(14) +
    '| ' + 'Estado'.padEnd(26) +
    '| ' + 'Acción en DB'
  );
  console.log('--------------------------------------------------------------------------------');
  for (const s of summary) {
    console.log(
      s.chain.padEnd(16) +
      '| ' + s.extracted.toString().padEnd(12) +
      '| ' + s.threshold.toString().padEnd(14) +
      '| ' + s.status.padEnd(26) +
      '| ' + s.dbAction
    );
  }
  console.log('--------------------------------------------------------------------------------\n');

  console.log('📝 Detalle de Errores e Incidentes:');
  let totalErrors = 0;
  for (const s of summary) {
    if (s.errors && s.errors.length > 0) {
      console.log(`  • [${s.chain}]:`);
      s.errors.forEach(e => console.log(`      - ${e}`));
      totalErrors += s.errors.length;
    }
  }
  if (totalErrors === 0) {
    console.log('  • Ningún error crítico detectado durante la ejecución.');
  }

  console.log('\n================================================================================');

  // Si al menos una cadena actualizó precios con éxito, ejecutamos la normalización
  if (successfulUpserts > 0) {
    console.log('\n🔄 Ejecutando pipeline de normalización (normalize_catalog.js)...');
    try {
      require('child_process').execSync('node normalize_catalog.js', { stdio: 'inherit' });
      console.log('✅ Pipeline de normalización completado con éxito.');
    } catch (err) {
      console.error('❌ Error durante la normalización:', err.message);
    }
  } else {
    console.warn('\n⚠️ Ninguna cadena cumplió los umbrales de seguridad. Se omite normalización.');
  }

  console.log(`\n[${new Date().toISOString()}] Scraper nocturno finalizado.\n`);
}

runScraper();
