const express = require('express');
const usersRouter = require('./routes/users');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/users', usersRouter);
app.use('/api', require('./routes/orders'));

app.listen(app.get('port') ?? 3000);
