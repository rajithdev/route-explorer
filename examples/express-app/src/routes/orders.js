const express = require('express');

const router = express.Router();

router
  .route('/orders')
  .get((_req, res) => res.json([]))
  .post((req, res) => res.status(201).json(req.body));

router.delete('/orders/:id', (_req, res) => res.status(204).end());

module.exports = router;
