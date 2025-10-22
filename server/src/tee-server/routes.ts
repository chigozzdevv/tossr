import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TeeEngine, MarketType } from './tee-engine';

const teeEngine = new TeeEngine();

interface GenerateOutcomeBody {
  round_id: string;
  market_type: string;
  params?: {
    chain_hash?: number[];
    community_seeds?: number[];
  };
}

interface UpdateStreakBody {
  round_id: string;
  wallet: string;
  won: boolean;
  target: number;
}

export async function teeServerRoutes(fastify: FastifyInstance) {
  fastify.post('/generate_outcome', async (req: FastifyRequest<{ Body: GenerateOutcomeBody }>, reply: FastifyReply) => {
    try {
      const { round_id, market_type, params } = req.body;

      const mappedParams = params ? {
        chainHash: params.chain_hash,
        communitySeeds: params.community_seeds
      } : {};

      const attestation = teeEngine.generateOutcome(
        round_id,
        market_type as MarketType,
        mappedParams
      );

      return reply.status(200).send(attestation);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/update_streak', async (req: FastifyRequest<{ Body: UpdateStreakBody }>, reply: FastifyReply) => {
    try {
      const { wallet, won } = req.body;
      const new_streak = teeEngine.updateStreak(wallet, won);
      return reply.status(200).send({ new_streak });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/get_streak/:wallet', async (req: FastifyRequest<{ Params: { wallet: string } }>, reply: FastifyReply) => {
    try {
      const { wallet } = req.params;
      const streak = teeEngine.getStreak(wallet);
      return reply.status(200).send({ streak });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/health', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'ok',
      tee: 'operational',
      public_key: Buffer.from(teeEngine.getPublicKeyBytes()).toString('hex'),
    });
  });
}
