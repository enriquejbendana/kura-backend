const scrapeCatedralCategory = async (categoryUrl, pageNumber) => {
  // Extraer el ID de categoría de la URL o usar 1 (Medicamentos) por defecto
  const catMatch = categoryUrl ? categoryUrl.match(/\/categoria\/(\d+)/) : null;
  const categoryId = catMatch ? catMatch[1] : '1';
  
  const url = `https://www.farmaciacatedral.com.py/get-productos?page=${pageNumber}&categoria=${categoryId}&ordenar_por=0`;
  console.log(`[Catedral] Extrayendo API: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!res.ok) {
      console.warn(`[Catedral] HTTP ${res.status} en pág ${pageNumber}`);
      return { error: true, message: `HTTP ${res.status}` };
    }

    const json = await res.json();
    if (!json || !json.paginacion || !json.paginacion.data) {
      return [];
    }

    const items = json.paginacion.data;
    if (!items || items.length === 0) return [];

    const results = [];
    for (const item of items) {
      const name = item.nombre ? item.nombre.trim() : (item.nombre_seo ? item.nombre_seo.trim() : null);
      const price = item.getPrecio ? parseInt(item.getPrecio, 10) : null;
      if (!name || !price || isNaN(price)) continue;

      let originalPrice = item.getPrecioAnterior ? parseInt(item.getPrecioAnterior, 10) : price;
      if (isNaN(originalPrice) || originalPrice < price) originalPrice = price;

      let discountPercentage = item.descuento_porcentual || 0;
      if (originalPrice > price && discountPercentage === 0) {
        discountPercentage = Math.round(((originalPrice - price) / originalPrice) * 100);
      }

      results.push({
        commercialName: name,
        query: name,
        price: price,
        original_price: originalPrice,
        discount_percentage: discountPercentage,
        pharmacy_id: 'catedral',
        image_url: item.primera_imagen || null
      });
    }

    // Respetar Crawl-delay: 1 con pausa prudente de 1.5s
    await new Promise(r => setTimeout(r, 1500));

    return results;
  } catch (err) {
    console.error(`[Catedral] Error en pág ${pageNumber}:`, err.message);
    return { error: true, message: err.message };
  }
};

module.exports = { scrapeCatedralCategory };
