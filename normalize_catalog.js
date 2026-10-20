require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('🚨 =================================================================');
  console.error('🚨 [ERROR CRÍTICO] SUPABASE_SERVICE_ROLE_KEY NO ESTÁ CONFIGURADA!');
  console.error('🚨 normalize_catalog.js requiere permisos de service_role para escribir en Supabase.');
  console.error('🚨 Por favor agrega SUPABASE_SERVICE_ROLE_KEY en el archivo .env');
  console.error('🚨 =================================================================');
  process.exit(1);
}

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

function normalizeName(name) {
    let s = name.toLowerCase();
    // Stop words to remove for grouping
    const stopWords = ['caja', 'cj', 'frasco', 'fr', 'x', 'comp', 'comprimidos', 'caps', 'capsulas', 'cápsulas', 'blandas', 'mg', 'gr', 'g', 'ml', 'suspension', 'susp', 'jbe', 'jarabe', 'sachet', 'parches', 'sobres', 'rec', 'recubiertos', 'de', 'con'];
    
    // Separate numbers from letters (e.g., 500mg -> 500 mg)
    s = s.replace(/(\d+)/g, ' $1 ');
    
    // Replace non-alphanumeric with space
    s = s.replace(/[^a-z0-9áéíóúñ]/g, ' ');
    
    // Tokenize
    let tokens = s.split(/\s+/).filter(t => t.length > 0);
    
    // Remove stop words
    tokens = tokens.filter(t => !stopWords.includes(t));
    
    // Sort and join to handle different word orders
    tokens.sort();
    return tokens.join(' ');
}

const crypto = require('crypto');
function generateUUID(str) {
    const hash = crypto.createHash('md5').update(str).digest('hex');
    return `${hash.substr(0,8)}-${hash.substr(8,4)}-${hash.substr(12,4)}-${hash.substr(16,4)}-${hash.substr(20,12)}`;
}

async function runNormalization() {
    if (!supabase) {
        console.error('No Supabase credentials found.');
        return;
    }

    console.log('Fetching raw data from medicamentos_cache...');
    let allCacheData = [];
    let start = 0;
    const limit = 1000;
    while(true) {
        const { data, error } = await supabase.from('medicamentos_cache').select('*').range(start, start + limit - 1);
        if (error) {
            console.error('Error fetching cache:', error);
            return;
        }
        if (!data || data.length === 0) break;
        allCacheData.push(...data);
        if (data.length < limit) break;
        start += limit;
    }
    const cacheData = allCacheData;

    console.log(`Found ${cacheData.length} records in cache. Normalizing...`);

    const groups = {};
    for (const item of cacheData) {
        const normKey = normalizeName(item.commercial_name);
        if (!normKey) continue;

        if (!groups[normKey]) {
            groups[normKey] = {
                id: generateUUID(normKey),
                canonicalName: item.commercial_name,
                query: item.query,
                image_url: item.image_url,
                prices: []
            };
        }

        const dbPharmacyId = item.pharmacy_id.replace('-', '_'); 
        if (dbPharmacyId === 'test') continue;

        const existingPriceIdx = groups[normKey].prices.findIndex(p => p.pharmacy_id === dbPharmacyId);
        if (existingPriceIdx >= 0) {
            if (item.price < groups[normKey].prices[existingPriceIdx].price) {
                groups[normKey].prices[existingPriceIdx].price = item.price;
            }
        } else {
            groups[normKey].prices.push({
                pharmacy_id: dbPharmacyId,
                price: item.price
            });
        }
    }

    const uniqueProducts = Object.values(groups);
    console.log(`Consolidated into ${uniqueProducts.length} unique products.`);

    const productsToInsert = [];
    const pricesToInsert = [];

    for (const p of uniqueProducts) {
        productsToInsert.push({
            id: p.id,
            commercial_name: p.canonicalName,
            laboratory: 'Desconocido',
            composition: p.query,
            details: 'Extraído de IQVIA Cache',
            image_url: p.image_url,
            active_principle_id: null
        });
        for (const priceObj of p.prices) {
            pricesToInsert.push({
                product_id: p.id,
                pharmacy_id: priceObj.pharmacy_id,
                price: priceObj.price
            });
        }
    }

    console.log(`Upserting ${productsToInsert.length} products...`);
    const { error: pErr } = await supabase.from('products').upsert(productsToInsert, { onConflict: 'id' });
    if (pErr) {
        console.error('Error inserting products:', pErr);
        return;
    }

    console.log(`Deleting old prices for updated products...`);
    const productIds = productsToInsert.map(p => p.id);
    // Delete in chunks to avoid URL too long errors if productIds is massive
    for (let i = 0; i < productIds.length; i += 100) {
        const chunk = productIds.slice(i, i + 100);
        await supabase.from('product_prices').delete().in('product_id', chunk);
    }

    console.log(`Inserting ${pricesToInsert.length} prices...`);
    const { error: ppErr } = await supabase.from('product_prices').insert(pricesToInsert);
    if (ppErr) {
        console.error('Error inserting prices:', ppErr);
        return;
    }

    console.log('Normalization and Data Lake to Read Model promotion completed successfully!');
}

runNormalization();
