export type Choice = 'rock' | 'paper' | 'scissors' | null;
export type PlayerStatus = 'playing' | 'eliminated' | 'winner';

export interface Player {
  id: string;
  nickname: string;
  choice: Choice;
  status: PlayerStatus;
}

export interface RankedPlayer {
  nickname: string;
  rank: number;
}

// 라운드 결과에 포함될 개별 플레이어 정보
export interface RoundPlayerResult {
  nickname: string;
  choice: Choice;
  eliminated: boolean;
}

export interface Room {
  id: string;
  players: Record<string, Player>;
  maxPlayers: number;
  targetRank: number;
  gameState: 'waiting' | 'playing' | 'results';
  gameTimer: NodeJS.Timeout | null;
  hostId: string | null;
  currentRound: number;
  rankedPlayers: RankedPlayer[];
}

// 확장된 라운드 종료 정보
export interface RoundResultPayload {
  round: number;
  isGameOver: boolean;
  achievedTargetRank?: RankedPlayer[];
  finalWinner?: RankedPlayer;
  roundPlayers: RoundPlayerResult[]; // 모든 플레이어의 선택과 결과
}
