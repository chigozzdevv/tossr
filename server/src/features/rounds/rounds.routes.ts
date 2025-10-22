import { FastifyInstance } from 'fastify';
import { RoundsController } from './rounds.controller';

const roundsController = new RoundsController();

export async function roundsRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/open',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Open a new round',
        description: 'Create and delegate a new betting round to ER',
        body: {
          type: 'object',
          properties: {
            marketId: { type: 'string', format: 'uuid' },
          },
          required: ['marketId'],
        },
      },
    },
    roundsController.openRound.bind(roundsController)
  );

  fastify.post(
    '/lock',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Lock a round',
        description: 'Lock a round and trigger outcome generation',
        body: {
          type: 'object',
          properties: {
            roundId: { type: 'string', format: 'uuid' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.lockRound.bind(roundsController)
  );

  fastify.post(
    '/:roundId/undelegate',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Undelegate round',
        description: 'Undelegate round from ER back to base layer',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.undelegateRound.bind(roundsController)
  );

  fastify.get(
    '/:roundId',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Get round details',
        description: 'Retrieve specific round information',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.getRound.bind(roundsController)
  );

  fastify.get(
    '/',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Get active rounds',
        description: 'Retrieve all active rounds',
        querystring: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
          },
        },
      },
    },
    roundsController.getActiveRounds.bind(roundsController)
  );
}
