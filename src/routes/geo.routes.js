'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { sucursalCercana } = require('../controllers/geo.controller');

router.use(authMiddleware);

router.post('/sucursal-cercana', sucursalCercana);

module.exports = router;
