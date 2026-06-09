'use strict';

const axios = require('axios');

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodificarTexto(texto) {
  const aliases = {
    'cdmx': 'Ciudad de Mexico',
    'df': 'Ciudad de Mexico',
    'd.f.': 'Ciudad de Mexico',
    'mty': 'Monterrey',
    'gdl': 'Guadalajara',
    'gda': 'Guadalajara',
    'mex': 'Estado de Mexico',
    'qro': 'Queretaro',
    'pue': 'Puebla',
    'slp': 'San Luis Potosi',
    'ags': 'Aguascalientes',
    'zac': 'Zacatecas',
  };

  let textoNormalizado = texto;
  for (const [abrev, nombre] of Object.entries(aliases)) {
    const regex = new RegExp(`\\b${abrev}\\b`, 'gi');
    textoNormalizado = textoNormalizado.replace(regex, nombre);
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;

  if (!apiKey) {
    const err = new Error('GEOAPIFY_API_KEY no está configurada en el entorno.');
    err.code = 'CONFIG_ERROR';
    throw err;
  }

  const url = 'https://api.geoapify.com/v1/geocode/search';
  const { data } = await axios.get(url, {
    params: {
      text: textoNormalizado,
      apiKey,
      lang: 'es',
      limit: 1,
      bias: 'countrycode:mx',
    },
  });

  const feature = data.features?.[0];
  if (!feature) {
    const err = new Error(`No se pudo geocodificar la dirección: "${texto}"`);
    err.code = 'GEOCODING_NOT_FOUND';
    throw err;
  }

  return {
    lat: feature.geometry.coordinates[1],
    lon: feature.geometry.coordinates[0],
    direccion_resuelta: feature.properties.formatted,
  };
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

async function sucursalCercana(req, res) {
  const { lat, lon, direccion } = req.body;

  // Parsear sucursales si llega como string (comportamiento de la plataforma Plática)
  let sucursalesParseadas;
  try {
    sucursalesParseadas = typeof req.body.sucursales === 'string'
      ? JSON.parse(req.body.sucursales)
      : req.body.sucursales;
  } catch (e) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'El campo "sucursales" no es un JSON válido.',
    });
  }

  // --- Validaciones ---
  if (!sucursalesParseadas || !Array.isArray(sucursalesParseadas) || sucursalesParseadas.length === 0) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'El campo "sucursales" es requerido y debe ser un array con al menos un elemento.',
    });
  }

  const tieneCoordenadas = lat !== undefined && lon !== undefined;
  const tieneDireccion   = typeof direccion === 'string' && direccion.trim() !== '';

  if (!tieneCoordenadas && !tieneDireccion) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Se requiere "lat" + "lon" (ubicación nativa) o "direccion" (texto libre).',
    });
  }

  // Validar que cada sucursal tenga lat y lon
  for (let i = 0; i < sucursalesParseadas.length; i++) {
    const s = sucursalesParseadas[i];
    if (s.lat === undefined || s.lon === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `La sucursal en índice ${i} ("${s.nombre ?? 'sin nombre'}") no tiene "lat" y "lon".`,
      });
    }
  }

  // --- Resolver coordenadas del usuario ---
  let userLat, userLon, direccion_resuelta = null;

  if (tieneCoordenadas) {
    userLat = parseFloat(lat);
    userLon = parseFloat(lon);

    if (isNaN(userLat) || isNaN(userLon)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '"lat" y "lon" deben ser números válidos.',
      });
    }
  } else {
    try {
      const geo = await geocodificarTexto(direccion.trim());
      userLat = geo.lat;
      userLon = geo.lon;
      direccion_resuelta = geo.direccion_resuelta;
    } catch (err) {
      console.error('[GeoController] Error geocodificando:', err.message);

      if (err.code === 'CONFIG_ERROR') {
        return res.status(500).json({ error: 'Internal Server Error', message: err.message });
      }
      if (err.code === 'GEOCODING_NOT_FOUND') {
        return res.status(200).json({
          success: false,
          message: `No pude encontrar la dirección "${direccion}". ¿Puedes ser más específico? Por ejemplo, agrega la colonia o ciudad completa.`,
        });
      }
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Error al geocodificar la dirección. Revisa los logs.',
      });
    }
  }

  // --- Calcular distancias ---
  const conDistancia = sucursalesParseadas.map((s) => ({
    ...s,
    distancia_km: parseFloat(
      haversine(userLat, userLon, parseFloat(s.lat), parseFloat(s.lon)).toFixed(2)
    ),
  }));

  conDistancia.sort((a, b) => a.distancia_km - b.distancia_km);

  return res.status(200).json({
    ubicacion_usuario: {
      lat: userLat,
      lon: userLon,
      ...(direccion_resuelta && { direccion_resuelta }),
    },
    sucursal_mas_cercana: conDistancia[0],
    todas_ordenadas: conDistancia,
  });
}

module.exports = { sucursalCercana };