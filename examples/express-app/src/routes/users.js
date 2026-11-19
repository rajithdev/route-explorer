const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => res.json([]));
router.get('/:id', (req, res) => res.json({ id: req.params.id }));
router.post('/', (req, res) => res.status(201).json(req.body));

module.exports = router;
