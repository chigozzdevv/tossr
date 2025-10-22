import { FastifyInstance } from 'fastify';
import { AnalyticsController } from './analytics.controller';

const controller = new AnalyticsController();

export async function analyticsRoutes(fastify: FastifyInstance) {

  fastify.get(
    '/overview',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Platform overview metrics',
        description: 'High-level KPIs: bets, users, finances, timings, attestations',
      },
    },
    controller.getOverview
  );

  fastify.get(
    '/markets',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Per-market performance metrics',
        description: 'Rounds, bets, volume, payout, PnL per market',
      },
    },
    controller.getMarketMetrics
  );

  fastify.get(
    '/users',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'User activity metrics',
        description: 'DAU/WAU/MAU based on betting activity',
      },
    },
    controller.getUserMetrics
  );

  fastify.get(
    '/timeseries',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Timeseries of bets/volume/payout',
        description: 'Aggregated by day or week',
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number', minimum: 1, maximum: 180, default: 14 },
            granularity: { type: 'string', enum: ['daily', 'weekly'], default: 'daily' },
          },
        },
      },
    },
    controller.getTimeSeries
  );
}

