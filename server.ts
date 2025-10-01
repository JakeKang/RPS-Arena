import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import next from 'next';
import fs from 'fs';
import path from 'path';
import {
  Choice,
  Player,
  Room,
  RankedPlayer,
  RoundPlayerResult,
  RoundResultPayload,
} from '@/types/index.type';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const rooms: Record<string, Room> = {};
const MAX_ROUNDS = 50;

// 로그 디렉토리 생성
const LOGS_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 게임 로그 기록 함수
function logGameEvent(roomId: string, message: string) {
  const room = rooms[roomId];
  if (!room) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFileName = `${roomId}-${timestamp.split('T')[0]}.txt`;
  const logFilePath = path.join(LOGS_DIR, logFileName);

  const logMessage = `[${new Date().toISOString()}] ${message}\n`;

  try {
    fs.appendFileSync(logFilePath, logMessage, 'utf8');
  } catch (error) {
    console.error('로그 기록 실패:', error);
  }
}

function generateRoomId(length: number): string {
  const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function determineRoundOutcome(currentPlayers: Player[]): {
  winners: Player[];
  losers: Player[];
} {
  const choicesMap = new Map<Choice, Player[]>();
  const playersWhoDidNotChoose: Player[] = [];
  currentPlayers.forEach((p) => {
    if (p.choice) {
      if (!choicesMap.has(p.choice)) choicesMap.set(p.choice, []);
      choicesMap.get(p.choice)!.push(p);
    } else {
      playersWhoDidNotChoose.push(p);
    }
  });

  // 모든 플레이어가 선택하지 않았을 경우, 무승부로 처리하여 재대결
  if (choicesMap.size === 0) {
    return { winners: [], losers: [] };
  }

  const uniqueChoices = Array.from(choicesMap.keys());

  // 선택지가 1개이거나 3개 이상일 경우(무승부), 패자는 미선택자 뿐
  if (uniqueChoices.length !== 2) {
    const winners =
      choicesMap.size === 1 ? currentPlayers.filter((p) => p.choice) : [];
    return { winners, losers: playersWhoDidNotChoose };
  }

  const [c1, c2] = uniqueChoices;
  let winnerChoice: Choice = null;

  if (
    (c1 === 'rock' && c2 === 'scissors') ||
    (c1 === 'scissors' && c2 === 'rock')
  )
    winnerChoice = 'rock';
  else if (
    (c1 === 'paper' && c2 === 'rock') ||
    (c1 === 'rock' && c2 === 'paper')
  )
    winnerChoice = 'paper';
  else if (
    (c1 === 'scissors' && c2 === 'paper') ||
    (c1 === 'paper' && c2 === 'scissors')
  )
    winnerChoice = 'scissors';

  const winners = choicesMap.get(winnerChoice) || [];
  const roundLosers = choicesMap.get(winnerChoice === c1 ? c2 : c1) || [];
  const losers = roundLosers.concat(playersWhoDidNotChoose);

  return { winners, losers };
}

function assignRanks(
  playersToRank: Player[],
  isWinners: boolean,
  room: Room,
  newlyRankedPlayers: RankedPlayer[],
) {
  const totalPlayers = Object.keys(room.players).length;
  const takenRanks = new Set(room.rankedPlayers.map((p) => p.rank));

  playersToRank.forEach((player) => {
    let rank: number;
    if (isWinners) {
      rank = 1;
      while (takenRanks.has(rank)) rank++;
    } else {
      rank = totalPlayers;
      while (takenRanks.has(rank)) rank--;
    }

    player.status = 'eliminated';
    const rankedPlayer = { nickname: player.nickname, rank };
    room.rankedPlayers.push(rankedPlayer);
    newlyRankedPlayers.push(rankedPlayer);
    takenRanks.add(rank);
  });
}

const handlePlayerLeave = (io: Server, socketId: string) => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players[socketId]) {
      const playerNickname = room.players[socketId].nickname;
      delete room.players[socketId];
      if (Object.keys(room.players).length === 0) {
        if (room.gameTimer) clearInterval(room.gameTimer);
        delete rooms[roomId];
      } else {
        if (room.hostId === socketId)
          room.hostId = Object.keys(room.players)[0];
        logGameEvent(roomId, `플레이어 나감: ${playerNickname} (${socketId})`);
        io.to(roomId).emit('update_room', room);
      }
      break;
    }
  }
};

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket: Socket) => {
    socket.on('create_room', ({ nickname, maxPlayers, targetRank }) => {
      let roomId = generateRoomId(4);
      while (rooms[roomId]) {
        roomId = generateRoomId(4);
      }
      const newRoom: Room = {
        id: roomId,
        players: {},
        maxPlayers: Math.max(2, maxPlayers),
        targetRank: Math.max(1, Math.min(targetRank, maxPlayers)),
        gameState: 'waiting',
        gameTimer: null,
        hostId: socket.id,
        currentRound: 0,
        rankedPlayers: [],
      };
      const player: Player = {
        id: socket.id,
        nickname,
        choice: null,
        status: 'playing',
      };
      newRoom.players[socket.id] = player;
      rooms[roomId] = newRoom;
      socket.join(roomId);
      socket.emit('room_created', roomId);
      io.to(roomId).emit('update_room', newRoom);
      logGameEvent(roomId, `=== 게임방 생성 ===`);
      logGameEvent(
        roomId,
        `방 코드: ${roomId}, 최대 인원: ${maxPlayers}명, 목표 순위: ${newRoom.targetRank}등`,
      );
      logGameEvent(roomId, `방장: ${nickname} (${socket.id})`);
    });

    socket.on('join_room', ({ roomId, nickname }) => {
      const room = rooms[roomId];
      if (!room) return socket.emit('error_message', '방을 찾을 수 없습니다.');
      if (Object.keys(room.players).length >= room.maxPlayers)
        return socket.emit('error_message', '방이 가득 찼습니다.');
      if (room.gameState !== 'waiting')
        return socket.emit('error_message', '게임이 이미 시작되었습니다.');
      const player: Player = {
        id: socket.id,
        nickname,
        choice: null,
        status: 'playing',
      };
      room.players[socket.id] = player;
      socket.join(roomId);
      socket.emit('joined_room', roomId);
      io.to(roomId).emit('update_room', room);
      logGameEvent(roomId, `플레이어 입장: ${nickname} (${socket.id})`);
    });

    socket.on('get_room', (roomId: string) => {
      if (roomId && rooms[roomId]?.players[socket.id])
        socket.emit('update_room', rooms[roomId]);
    });

    const startRound = (roomId: string) => {
      const room = rooms[roomId];
      if (!room) return;

      room.currentRound += 1;
      Object.values(room.players).forEach((p) => {
        if (p.status === 'playing') p.choice = null;
      });

      const activePlayersForLog = Object.values(room.players).filter(
        (p) => p.status === 'playing',
      );
      logGameEvent(
        roomId,
        `\n=== 라운드 ${room.currentRound} 시작 === | 참가자 (${
          activePlayersForLog.length
        }명): ${activePlayersForLog.map((p) => p.nickname).join(', ')}`,
      );

      io.to(roomId).emit('new_round', room.currentRound);
      io.to(roomId).emit('update_room', room);
      let countdown = 5;
      io.to(roomId).emit('timer', countdown);

      room.gameTimer = setInterval(() => {
        countdown--;
        io.to(roomId).emit('timer', countdown);
        if (countdown === 0) {
          clearInterval(room.gameTimer!);

          const activePlayers = Object.values(room.players).filter(
            (p) => p.status === 'playing',
          );
          const { winners, losers } = determineRoundOutcome(activePlayers);
          const newlyRankedPlayers: RankedPlayer[] = [];

          const roundPlayersResult: RoundPlayerResult[] = activePlayers.map(
            (p) => ({
              nickname: p.nickname,
              choice: p.choice,
              eliminated: losers.some((l) => l.id === p.id),
            }),
          );

          if (winners.length === 0 && losers.length === 0) {
            logGameEvent(roomId, `라운드 결과: 무승부 재대결`);
          } else {
            const totalPlayers = Object.keys(room.players).length;
            const takenRanks = new Set(room.rankedPlayers.map((p) => p.rank));

            const potentialWinnerRanks: number[] = [];
            if (winners.length > 0) {
              let nextRank = 1;
              for (let i = 0; i < winners.length; i++) {
                while (takenRanks.has(nextRank)) nextRank++;
                potentialWinnerRanks.push(nextRank++);
              }
            }

            const potentialLoserRanks: number[] = [];
            if (losers.length > 0) {
              let nextRank = totalPlayers;
              for (let i = 0; i < losers.length; i++) {
                while (takenRanks.has(nextRank)) nextRank--;
                potentialLoserRanks.push(nextRank--);
              }
            }

            const winnersIncludeTarget = potentialWinnerRanks.includes(
              room.targetRank,
            );
            const losersIncludeTarget = potentialLoserRanks.includes(
              room.targetRank,
            );

            let winnersShouldHaveRematch =
              winnersIncludeTarget && winners.length > 1;
            let losersShouldHaveRematch =
              losersIncludeTarget && losers.length > 1;

            if (winnersShouldHaveRematch) {
              logGameEvent(
                roomId,
                `결과: 목표 순위(${room.targetRank}등)가 걸린 승자 그룹 재대결. 패자 그룹은 탈락.`,
              );
              if (losers) assignRanks(losers, false, room, newlyRankedPlayers);
            } else if (losersShouldHaveRematch) {
              logGameEvent(
                roomId,
                `결과: 목표 순위(${room.targetRank}등)가 걸린 패자 그룹 재대결. 승자 그룹은 탈락.`,
              );
              if (winners) assignRanks(winners, true, room, newlyRankedPlayers);
            } else {
              if (winners.length > 0)
                assignRanks(winners, true, room, newlyRankedPlayers);
              if (losers.length > 0)
                assignRanks(losers, false, room, newlyRankedPlayers);
            }
          }

          const remainingPlayers = Object.values(room.players).filter(
            (p) => p.status === 'playing',
          );
          if (
            remainingPlayers.length === 1 &&
            Object.values(room.players).length > 1
          ) {
            assignRanks(remainingPlayers, true, room, newlyRankedPlayers);
          }

          const isGameOver =
            Object.values(room.players).every((p) => p.status !== 'playing') ||
            room.currentRound >= MAX_ROUNDS;
          const achievedTarget = newlyRankedPlayers.find(
            (p) => p.rank === room.targetRank,
          );

          const payload: RoundResultPayload = {
            round: room.currentRound,
            isGameOver: isGameOver || !!achievedTarget,
            roundPlayers: roundPlayersResult,
            achievedTargetRank: achievedTarget ? [achievedTarget] : undefined,
          };

          io.to(roomId).emit('round_result', payload);
          io.to(roomId).emit('update_room', room);

          if (isGameOver || achievedTarget) {
            room.gameState = 'results';
            logGameEvent(roomId, `\n=== 게임 종료 ===`);
            const sortedRanks = [...room.rankedPlayers].sort(
              (a, b) => a.rank - b.rank,
            );
            sortedRanks.forEach((p) =>
              logGameEvent(
                roomId,
                `  ${p.rank}등: ${p.nickname} ${
                  p.rank === room.targetRank ? '⭐ 당첨!' : ''
                }`,
              ),
            );
            if (achievedTarget)
              logGameEvent(
                roomId,
                `🎉 목표 순위 달성! ${achievedTarget.nickname}님이 ${achievedTarget.rank}등으로 당첨!`,
              );

            setTimeout(() => {
              io.to(roomId).emit('game_over_redirect');
            }, 10000);
          } else {
            setTimeout(() => startRound(roomId), 4000);
          }
        }
      }, 1000);
    };

    socket.on('start_game', (roomId: string) => {
      const room = rooms[roomId];
      if (
        !room ||
        socket.id !== room.hostId ||
        Object.keys(room.players).length < 2
      )
        return;

      room.gameState = 'playing';
      room.rankedPlayers = [];
      Object.values(room.players).forEach((p) => (p.status = 'playing'));

      logGameEvent(
        roomId,
        `\n게임 시작! 참가자: ${Object.values(room.players)
          .map((p) => p.nickname)
          .join(', ')}`,
      );

      startRound(roomId);
    });

    socket.on(
      'make_choice',
      ({ roomId, choice }: { roomId: string; choice: Choice }) => {
        const room = rooms[roomId];
        if (
          room?.players[socket.id]?.status === 'playing' &&
          room.gameState === 'playing'
        ) {
          room.players[socket.id].choice = choice;
          io.to(roomId).emit('update_room', room);
        }
      },
    );

    socket.on('leave_room', (roomId: string) => {
      socket.leave(roomId);
      handlePlayerLeave(io, socket.id);
    });
    socket.on('disconnect', () => handlePlayerLeave(io, socket.id));
  });

  const PORT = process.env.PORT || 3005;
  httpServer.listen(PORT, () =>
    console.log(`> Ready on http://localhost:${PORT}`),
  );
});
