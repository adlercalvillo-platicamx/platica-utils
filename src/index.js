'use strict';

require('dotenv').config();

const express = require('express');
const app = express();

const geoRoutes = require('./routes/geo.routes');

app.use(express.json());

// Health check — sin auth, igual que GoogleDocs
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'platica-utils', version: '1.0.0' });
});

app.use('/geo', geoRoutes);

// 404 genérico
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Ruta ${req.method} ${req.path} no existe.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[platica-utils] Servidor corriendo en puerto ${PORT}`);
});
