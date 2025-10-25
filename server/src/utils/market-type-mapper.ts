import { MarketType as ServerMarketType } from '@/shared/types';
import { $Enums } from '@prisma/client';

const teeMarketTypeMap: Record<ServerMarketType, string> = {
  [ServerMarketType.PICK_RANGE]: 'PickRange',
  [ServerMarketType.EVEN_ODD]: 'EvenOdd',
  [ServerMarketType.LAST_DIGIT]: 'LastDigit',
  [ServerMarketType.MODULO_THREE]: 'ModuloThree',
  [ServerMarketType.PATTERN_OF_DAY]: 'PatternOfDay',
  [ServerMarketType.SHAPE_COLOR]: 'ShapeColor',
  [ServerMarketType.JACKPOT]: 'Jackpot',
  [ServerMarketType.ENTROPY_BATTLE]: 'EntropyBattle',
  [ServerMarketType.STREAK_METER]: 'StreakMeter',
  [ServerMarketType.COMMUNITY_SEED]: 'CommunitySeed',
};

export function mapServerToTeeMarketType(serverType: ServerMarketType): string {
  return teeMarketTypeMap[serverType] || 'PickRange';
}

export function mapPrismaToServerMarketType(type: $Enums.MarketType): ServerMarketType {
  // Enum string values match; map via safe cast
  return type as unknown as ServerMarketType;
}

export function mapServerToPrismaMarketType(type: ServerMarketType): $Enums.MarketType {
  return type as unknown as $Enums.MarketType;
}
