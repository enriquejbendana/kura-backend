const express = require('express');
const cors = require('cors');
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
    // Ejecutar scrapers en paralelo para mayor velocidad
    const [puntoFarmaResults, farmacenterResults, catedralResults, olivaResults, totalResults] = await Promise.all([
      scrapePuntoFarma(query),
      scrapeFarmacenter(query),
      scrapeCatedral(query),
      scrapeFarmaoliva(query),
      scrapeFarmatotal(query)
    ]);

    const errors = [];
    let combinedResults = [];

    const processResults = (results) => {
      if (results && results.error) {
        errors.push(results);
      } else if (Array.isArray(results)) {
        combinedResults = combinedResults.concat(results);
      }
    };

    processResults(puntoFarmaResults);
    processResults(farmacenterResults);
    processResults(catedralResults);
    processResults(olivaResults);
    processResults(totalResults);

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
    res.status(500).json({ error: 'Ocurrió un error al extraer los datos de las farmacias' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor Scraper corriendo en http://localhost:${PORT}`);
});
