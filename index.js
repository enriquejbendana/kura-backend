require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    transport: WebSocket
  }
}) : null;

const fs = require('fs');
const path = require('path');
const { scrapePuntoFarma } = require('./scrapers/puntoFarma');
const { scrapeFarmacenter } = require('./scrapers/farmacenter');
const { scrapeCatedral } = require('./scrapers/catedral');
const { scrapeFarmaoliva } = require('./scrapers/farmaoliva');
const { scrapeFarmatotal } = require('./scrapers/farmatotal');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Base de datos local para popularidad
const popularityFile = path.join(__dirname, 'popularity.json');

const getPopularityData = () => {
  if (fs.existsSync(popularityFile)) {
    try {
      const data = fs.readFileSync(popularityFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error leyendo popularity.json:', error);
      return {};
    }
  }
  return {};
};

const savePopularityData = (data) => {
  try {
    fs.writeFileSync(popularityFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error guardando popularity.json:', error);
  }
};

// Contador de Visitas
const visitsFile = path.join(__dirname, 'visits.json');
const getVisits = () => {
  if (fs.existsSync(visitsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(visitsFile, 'utf8'));
      return data.count || 1253;
    } catch(e) { return 1253; }
  }
  return 1253;
};
const saveVisits = (count) => {
  try {
    fs.writeFileSync(visitsFile, JSON.stringify({ count }), 'utf8');
  } catch (e) { console.error('Error guardando visits.json:', e); }
};

app.get('/api/visits', (req, res) => {
  let count = getVisits();
  count += 1; // Sumar 1 visitante
  saveVisits(count);
  res.json({ visits: count });
});

app.post('/api/track-click', (req, res) => {
  const { productName } = req.body;
  if (!productName) {
    return res.status(400).json({ error: 'Falta productName' });
  }
  
  const db = getPopularityData();
  const normalizedName = productName.toLowerCase().trim();
  
  if (!db[normalizedName]) {
    db[normalizedName] = 0;
  }
  db[normalizedName] += 1;
  
  savePopularityData(db);
  console.log(`[Clic] Registrado para: "${normalizedName}" (Total: ${db[normalizedName]})`);
  
  res.json({ success: true, clicks: db[normalizedName] });
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Falta el parámetro de búsqueda "q"' });
  }

  console.log(`[Búsqueda] Solicitud entrante para: "${query}"`);

  try {
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
    
    let sharedBrowser;
    let combinedResults = [];
    let fromCache = false;

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('medicamentos_cache')
          .select('*')
          .eq('query', query.toLowerCase());
          
        if (!error && data && data.length > 0) {
          console.log(`[Cache] Cargando ${data.length} resultados desde Supabase`);
          fromCache = true;
          
          const pharmacyMap = {
            'punto-farma': { name: 'Punto Farma', class: 'badge-punto-farma' },
            'farmacenter': { name: 'Farmacenter', class: 'badge-farmacenter' },
            'catedral': { name: 'Farmacias Catedral', class: 'badge-catedral' },
            'farmaoliva': { name: 'Farmaoliva', class: 'badge-farmaoliva' },
            'farmatotal': { name: 'Farmatotal', class: 'badge-farmatotal' }
          };

          combinedResults = data.map(item => ({
            id: item.product_id,
            commercialName: item.commercial_name,
            composition: '---',
            laboratory: 'Desconocido',
            details: 'Extraído desde Caché',
            imageUrl: item.image_url,
            prices: [{
              pharmacy: pharmacyMap[item.pharmacy_id] || { id: item.pharmacy_id, name: item.pharmacy_id, class: 'badge-default' },
              price: item.price
            }]
          }));
        }
      } catch (err) {
        console.error("Error consultando Supabase:", err.message);
      }
    }

    const errors = [];

    // Si no hay datos en caché, intentamos raspar en vivo (fallará en Render, pero sirve en Local)
    if (!fromCache) {
      console.log(`[En Vivo] Sin caché para ${query}. Iniciando scraping en vivo...`);
      try {
        sharedBrowser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled']
        });

        const scrapers = [
          scrapePuntoFarma(query, sharedBrowser),
          scrapeFarmacenter(query, sharedBrowser),
          scrapeCatedral(query, sharedBrowser),
          scrapeFarmaoliva(query, sharedBrowser),
          scrapeFarmatotal(query, sharedBrowser)
        ];

        const liveResults = await Promise.allSettled(scrapers);
        
        liveResults.forEach(result => {
          if (result.status === 'fulfilled') {
            if (result.value && result.value.error) {
              errors.push(result.value);
            } else if (Array.isArray(result.value)) {
              combinedResults = combinedResults.concat(result.value);
            }
          }
        });

      } finally {
        if (sharedBrowser) await sharedBrowser.close();
      }
    }

    if (combinedResults.length === 0) {
      combinedResults = [
        {
          id: 'sim-1',
          commercialName: `${query.toUpperCase()} Simulado 500mg`,
          composition: query,
          laboratory: 'Lab Genérico',
          details: 'Caja x 20 comp',
          imageUrl: null,
          prices: [
            { pharmacy: { id: 'punto-farma', name: 'Punto Farma', class: 'badge-punto-farma' }, price: Math.floor(Math.random() * 20000) + 10000, url: 'https://puntofarma.com.py' },
            { pharmacy: { id: 'farmacenter', name: 'Farmacenter', class: 'badge-farmacenter' }, price: Math.floor(Math.random() * 20000) + 10000, url: 'https://farmacenter.com.py' },
            { pharmacy: { id: 'catedral', name: 'Farmacias Catedral', class: 'badge-catedral' }, price: Math.floor(Math.random() * 20000) + 10000, url: 'https://farmaciacatedral.com.py' },
            { pharmacy: { id: 'farmaoliva', name: 'Farmaoliva', class: 'badge-farmaoliva' }, price: Math.floor(Math.random() * 20000) + 10000, url: 'https://farmaoliva.com.py' },
            { pharmacy: { id: 'farmatotal', name: 'Farmatotal', class: 'badge-farmatotal' }, price: Math.floor(Math.random() * 20000) + 10000, url: 'https://farmatotal.com.py' }
          ]
        },
        {
          id: 'sim-2',
          commercialName: `${query.toUpperCase()} Premium`,
          composition: query,
          laboratory: 'Lab Premium',
          details: 'Caja x 10 comp',
          imageUrl: null,
          prices: [
            { pharmacy: { id: 'punto-farma', name: 'Punto Farma', class: 'badge-punto-farma' }, price: Math.floor(Math.random() * 30000) + 20000, url: 'https://puntofarma.com.py' },
            { pharmacy: { id: 'farmacenter', name: 'Farmacenter', class: 'badge-farmacenter' }, price: Math.floor(Math.random() * 30000) + 20000, url: 'https://farmacenter.com.py' },
            { pharmacy: { id: 'catedral', name: 'Farmacias Catedral', class: 'badge-catedral' }, price: Math.floor(Math.random() * 30000) + 20000, url: 'https://farmaciacatedral.com.py' },
            { pharmacy: { id: 'farmaoliva', name: 'Farmaoliva', class: 'badge-farmaoliva' }, price: Math.floor(Math.random() * 30000) + 20000, url: 'https://farmaoliva.com.py' },
            { pharmacy: { id: 'farmatotal', name: 'Farmatotal', class: 'badge-farmatotal' }, price: Math.floor(Math.random() * 30000) + 20000, url: 'https://farmatotal.com.py' }
          ]
        }
      ];
      errors.push({ error: true, message: 'Usando datos simulados debido a bloqueos de red en los servidores de las farmacias', pharmacy: { name: 'Sistema de Respaldo' } });
    }
    
    // Inyectar clics históricos
    const popDb = getPopularityData();
    combinedResults = combinedResults.map(item => {
      const normalizedName = item.commercialName.toLowerCase().trim();
      return {
        ...item,
        clicks: popDb[normalizedName] || 0
      };
    });

    res.json({
      query,
      count: combinedResults.length,
      data: combinedResults,
      errors: errors
    });
  } catch (error) {
    console.error('[Error General Scraping]', error);
    res.status(500).json({ error: 'Ocurrió un error al extraer los datos de las farmacias', details: error.toString() });
  }
});

app.post('/api/symptom-checker', (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms) return res.status(400).json({ error: 'No symptoms provided' });
  
  const text = symptoms.toLowerCase();
  
  const emergencyKeywords = ['pecho', 'brazo', 'respirar', 'ahogo', 'sangre', 'desmayo', 'corazón', 'infarto'];
  const isEmergency = emergencyKeywords.some(keyword => text.includes(keyword));
  
  if (isEmergency) {
    return res.json({
      isEmergency: true,
      message: 'Por la naturaleza de tus síntomas, es recomendable acudir a tu centro médico de confianza donde un médico especializado podrá brindarte el tratamiento exacto que necesitas. Por favor, realiza una consulta médica a la brevedad.',
      conditions: [],
      suggestedSearch: ''
    });
  }
  
  let conditions = [];
  let suggestedSearch = '';
  
  if (text.includes('cabeza') || text.includes('migraña')) {
    conditions.push('Cefalea o dolor de cabeza tensional');
    if (!suggestedSearch) suggestedSearch = 'analgésico';
  }
  if (text.includes('fiebre') || text.includes('calentura')) {
    conditions.push('Cuadro febril');
    if (!suggestedSearch) suggestedSearch = 'antitérmico';
  }
  if (text.includes('garganta') || text.includes('tos') || text.includes('moco') || text.includes('gripe')) {
    conditions.push('Cuadro gripal o resfriado común');
    if (!suggestedSearch) suggestedSearch = 'antigripal';
  }
  if (text.includes('estómago') || text.includes('acidez') || text.includes('reflujo') || text.includes('panza') || text.includes('ardor')) {
    conditions.push('Acidez o indigestión estomacal');
    if (!suggestedSearch) suggestedSearch = 'antiácido';
  }
  if (text.includes('alergia') || text.includes('estornudo') || text.includes('picazón') || text.includes('roncha')) {
    conditions.push('Alergia estacional o reacción alérgica leve');
    if (!suggestedSearch) suggestedSearch = 'antialérgico';
  }
  
  if (conditions.length === 0) {
    conditions.push('Malestar inespecífico');
    suggestedSearch = 'analgésico';
  }
  
  return res.json({
    isEmergency: false,
    message: `Tus síntomas podrían estar asociados a: ${conditions.join(' / ')}.`,
    conditions: conditions,
    suggestedSearch: suggestedSearch
  });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor Scraper corriendo en http://localhost:${PORT}`);
});
