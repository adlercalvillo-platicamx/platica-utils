'use strict';

const axios = require('axios');

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

/**
 * Distancia en km entre dos coordenadas usando la fórmula de Haversine.
 */
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

/**
 * Convierte una dirección en texto a coordenadas usando Geoapify.
 * Docs: https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/
 */
async function geocodificarTexto(texto) {
  const apiKey = process.env.GEOAPIFY_API_KEY;

  if (!apiKey) {
    const err = new Error('GEOAPIFY_API_KEY no está configurada en el entorno.');
    err.code = 'CONFIG_ERROR';
    throw err;
  }

  const url = 'https://api.geoapify.com/v1/geocode/search';
  const { data } = await axios.get(url, {
    params: {
      text: texto,
      apiKey,
      lang: 'es',
      limit: 1,
      bias: 'countrycode:mx', // prioriza resultados en México
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

/**
 * POST /geo/sucursal-cercana
 *
 * Recibe la ubicación del usuario (lat+lon nativo de WhatsApp, o dirección en texto)
 * y un array de sucursales con sus coordenadas. Devuelve las sucursales ordenadas
 * por distancia, con la más cercana primero.
 *
 * Body:
 * {
 *   "lat": 21.88,              // coordenadas nativas de WhatsApp (preferido)
 *   "lon": -102.28,            // si se mandan lat+lon, se ignora "direccion"
 *   "direccion": "...",        // texto libre — se geocodifica si no hay lat+lon
 *   "sucursales": [
 *     {
 *       "nombre": "Sucursal Centro",
 *       "lat": 21.8818,
 *       "lon": -102.2845,
 *       "direccion": "Madero 45, Aguascalientes",  // opcional, para mostrar al usuario
 *       "telefono": "449-123-4567",                // cualquier campo extra se conserva
 *       "horario": "Lun-Vie 9-18"
 *     }
 *   ]
 * }
 */
async function sucursalCercana(req, res) {
  const { lat, lon, direccion, sucursales } = req.body;

  const sucursalesParseadas = typeof sucursales === 'string' 
  ? JSON.parse(sucursales) 
  : sucursales;

  // --- Validaciones ---
  if (!sucursales || !Array.isArray(sucursales) || sucursales.length === 0) {
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
  for (let i = 0; i < sucursales.length; i++) {
    const s = sucursales[i];
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
        return res.status(422).json({ error: 'Unprocessable Entity', message: err.message });
      }
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Error al geocodificar la dirección. Revisa los logs.',
      });
    }
  }

  // --- Calcular distancias ---
  const conDistancia = sucursales.map((s) => ({
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
