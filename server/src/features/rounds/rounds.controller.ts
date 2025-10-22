import { FastifyRequest, FastifyReply } from 'fastify';
import { RoundsService } from './rounds.service';
import { success, badRequest } from '@/utils/response';

const roundsService = new RoundsService();

export class RoundsController {
  async openRound(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { marketId } = req.body as { marketId: string };
      const round = await roundsService.openRound(marketId);
      return success(reply, round, 'Round opened successfully');
    } catch (error: any) {
      return badRequest(reply, error.message);
    }
  }

  async lockRound(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { roundId } = req.body as { roundId: string };
      const txHash = await roundsService.lockRound(roundId);
      return success(reply, { txHash }, 'Round locked successfully');
    } catch (error: any) {
      return badRequest(reply, error.message);
    }
  }

  async undelegateRound(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { roundId } = req.params as { roundId: string };
      const txHash = await roundsService.undelegateRound(roundId);
      return success(reply, { txHash }, 'Round undelegated successfully');
    } catch (error: any) {
      return badRequest(reply, error.message);
    }
  }

  async getRound(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { roundId } = req.params as { roundId: string };
      const round = await roundsService.getRound(roundId);
      return success(reply, round);
    } catch (error: any) {
      return badRequest(reply, error.message);
    }
  }

  async getActiveRounds(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { marketId } = req.query as { marketId?: string };
      const rounds = await roundsService.getActiveRounds(marketId);
      return success(reply, rounds);
    } catch (error: any) {
      return badRequest(reply, error.message);
    }
  }
}
