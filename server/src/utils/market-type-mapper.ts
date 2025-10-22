import { MarketType as ServerMarketType } from '@/shared/types';
import { MarketType as TeeMarketType } from '@/tee-server/tee-engine';
import { $Enums } from '@prisma/client';

export function mapServerToTeeMarketType(serverType: ServerMarketType): TeeMarketType {
  const mapping: Record<ServerMarketType, TeeMarketType> = {
    [ServerMarketType.PICK_RANGE]: TeeMarketType.PICK_RANGE,
    [ServerMarketType.EVEN_ODD]: TeeMarketType.EVEN_ODD,
    [ServerMarketType.LAST_DIGIT]: TeeMarketType.LAST_DIGIT,
    [ServerMarketType.MODULO_THREE]: TeeMarketType.MODULO_THREE,
    [ServerMarketType.PATTERN_OF_DAY]: TeeMarketType.PATTERN_OF_DAY,
    [ServerMarketType.SHAPE_COLOR]: TeeMarketType.SHAPE_COLOR,
    [ServerMarketType.JACKPOT]: TeeMarketType.JACKPOT,
    [ServerMarketType.ENTROPY_BATTLE]: TeeMarketType.ENTROPY_BATTLE,
    [ServerMarketType.STREAK_METER]: TeeMarketType.STREAK_METER,
    [ServerMarketType.COMMUNITY_SEED]: TeeMarketType.COMMUNITY_SEED,
  };

  return mapping[serverType] || TeeMarketType.PICK_RANGE;
}

export function mapPrismaToServerMarketType(type: $Enums.MarketType): ServerMarketType {
  // Enum string values match; map via safe cast
  return type as unknown as ServerMarketType;
}

export function mapServerToPrismaMarketType(type: ServerMarketType): $Enums.MarketType {
  return type as unknown as $Enums.MarketType;
}
