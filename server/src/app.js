'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const logger = require('./lib/logger');
const { sequelize } = require('./db');
const { apiLimiter } = require('./middleware/rateLimits');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('etag', false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // swagger-ui (at /api/docs) needs inline styles; scripts stay same-origin only.
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    })
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.replace(/([?&](token|key|apiKey)=)[^&]+/gi, '$1[REDACTED]') }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    })
  );
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    // API responses can include user data — never cache them in shared caches.
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const checks = { database: 'ok', redis: 'unknown' };
    try {
      await sequelize.authenticate();
    } catch {
      checks.database = 'error';
    }
    try {
      const { pingRedis } = require('./modules/jobs/queue');
      checks.redis = (await Promise.race([pingRedis(), new Promise((r) => setTimeout(() => r(false), 1500))])) ? 'ok' : 'error';
    } catch {
      checks.redis = 'error';
    }
    const ok = checks.database === 'ok' && checks.redis === 'ok';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', app: env.APP_NAME, checks });
  });

  const swaggerUi = require('swagger-ui-express');
  const openapi = require('./docs/openapi');
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: `${env.APP_NAME} API` }));

  app.use('/api', apiLimiter);
  app.use('/api/auth', require('./modules/auth/auth.routes'));
  app.use('/api/profile', require('./modules/profile/profile.routes'));
  const jira = require('./modules/jira/jira.routes');
  app.use('/api/integrations/jira', jira.integrationRouter);
  app.use('/api/jira', jira.jiraRouter);
  const github = require('./modules/github/github.routes');
  app.use('/api/integrations/github', github.integrationRouter);
  app.use('/api/github', github.githubRouter);
  app.use('/api/ai', require('./modules/ai/ai.routes'));
  app.use('/api/plans', require('./modules/plans/plans.routes'));
  app.use('/api/planning-jobs', require('./modules/jobs/jobs.routes'));
  app.use('/api/dashboard', require('./modules/dashboard/dashboard.routes'));

  // Production: serve the built React app from the same origin.
  if (env.isProd) {
    const path = require('node:path');
    const fs = require('node:fs');
    const dist = path.resolve(__dirname, '../../client/dist');
    if (fs.existsSync(dist)) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.get(/^(?!\/api\/).*/, (_req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(dist, 'index.html'));
      });
    }
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
