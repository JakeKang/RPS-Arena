import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import next from 'next';
import {
  Choice,
  Player,
  Room,
  RoundResultPayload,
  RankedPlayer,
  RoundPlayerResult,
} from '@/types/index.type';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const rooms: Record<string, Room> = {};
const MAX_ROUNDS = 50;

function generateRoomId(length: number): string {
  const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function determineRoundOutcome(currentPlayers: Player[]): {
  winners?: Player[];
  losers?: Player[];
} {
  const choicesMap = new Map<Choice, Player[]>();
  currentPlayers.forEach((p) => {
    if (p.choice) {
      if (!choicesMap.has(p.choice)) choicesMap.set(p.choice, []);
      choicesMap.get(p.choice)!.push(p);
    }
  });

  const uniqueChoices = Array.from(choicesMap.keys());

  // 선택이 2가지가 아니면 무승부 (모두 같거나, 3가지 모두 나옴)
  if (uniqueChoices.length !== 2) return {};

  const [c1, c2] = uniqueChoices;
  let winnerChoice: Choice = null;
  let loserChoice: Choice = null;

  if (c1 === 'rock' && c2 === 'scissors') {
    winnerChoice = 'rock';
    loserChoice = 'scissors';
  } else if (c1 === 'scissors' && c2 === 'rock') {
    winnerChoice = 'rock';
    loserChoice = 'scissors';
  } else if (c1 === 'paper' && c2 === 'rock') {
    winnerChoice = 'paper';
    loserChoice = 'rock';
  } else if (c1 === 'rock' && c2 === 'paper') {
    winnerChoice = 'paper';
    loserChoice = 'rock';
  } else if (c1 === 'scissors' && c2 === 'paper') {
    winnerChoice = 'scissors';
    loserChoice = 'paper';
  } else if (c1 === 'paper' && c2 === 'scissors') {
    winnerChoice = 'paper';
    loserChoice = 'scissors';
  }

  const winners = choicesMap.get(winnerChoice) || [];
  const losers = choicesMap.get(loserChoice) || [];

  // 승자 또는 패자 중 한쪽이라도 있으면 결과 반환
  if (winners.length > 0 && losers.length > 0) {
    // 1:1 대결은 무조건 순위 확정
    if (winners.length === 1 && losers.length === 1) {
      return { winners, losers };
    }
    // 승자가 더 적으면 승자들을 탈락시킴 (상위 순위)
    else if (winners.length < losers.length) {
      return { winners };
    }
    // 패자가 더 적으면 패자들을 탈락시킴 (하위 순위)
    else if (losers.length < winners.length) {
      return { losers };
    }
    // 동수면 재대결 (아무도 탈락 안함)
    else {
      return {};
    }
  }

  return {};
}

const handlePlayerLeave = (io: Server, socketId: string) => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players[socketId]) {
      delete room.players[socketId];
      if (Object.keys(room.players).length === 0) {
        if (room.gameTimer) clearInterval(room.gameTimer);
        delete rooms[roomId];
      } else {
        if (room.hostId === socketId)
          room.hostId = Object.keys(room.players)[0];
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
    socket.on(
      'create_room',
      ({
        nickname,
        maxPlayers,
        targetRank,
      }: {
        nickname: string;
        maxPlayers: number;
        targetRank: number;
      }) => {
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
      },
    );

    socket.on(
      'join_room',
      ({ roomId, nickname }: { roomId: string; nickname: string }) => {
        const room = rooms[roomId];
        if (!room)
          return socket.emit('error_message', '방을 찾을 수 없습니다.');
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
      },
    );

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
          const roundOutcome = determineRoundOutcome(activePlayers);
          const newlyRankedPlayers: RankedPlayer[] = [];

          const roundPlayersResult: RoundPlayerResult[] = activePlayers.map(
            (p) => ({
              nickname: p.nickname,
              choice: p.choice,
              eliminated:
                roundOutcome.winners?.some((w) => w.id === p.id) ||
                roundOutcome.losers?.some((l) => l.id === p.id) ||
                false,
            }),
          );

          // ===== 핵심 수정: 목표 순위 기준 탈락 처리 =====
          const totalPlayers = Object.keys(room.players).length;
          const takenRanks = new Set(room.rankedPlayers.map((p) => p.rank));

          // 1:1 대결 특수 처리: 승자와 패자를 동시에 처리
          const is1v1 =
            roundOutcome.winners?.length === 1 &&
            roundOutcome.losers?.length === 1;

          if (is1v1) {
            const winner = roundOutcome.winners![0];
            const loser = roundOutcome.losers![0];

            // 승자 순위 계산 (위에서부터)
            let winnerRank = 1;
            while (takenRanks.has(winnerRank)) {
              winnerRank++;
            }

            // 패자 순위 계산 (아래에서부터, 승자 순위는 아직 추가 안됨)
            let loserRank = totalPlayers;
            while (takenRanks.has(loserRank)) {
              loserRank--;
            }

            // 둘 다 동시에 적용
            winner.status = 'eliminated';
            loser.status = 'eliminated';

            const winnerRankedPlayer = {
              nickname: winner.nickname,
              rank: winnerRank,
            };
            const loserRankedPlayer = {
              nickname: loser.nickname,
              rank: loserRank,
            };

            room.rankedPlayers.push(winnerRankedPlayer);
            room.rankedPlayers.push(loserRankedPlayer);
            newlyRankedPlayers.push(winnerRankedPlayer);
            newlyRankedPlayers.push(loserRankedPlayer);
          } else {
            // 일반 처리: 승자 또는 패자 중 한 그룹만 처리
            if (roundOutcome.winners && roundOutcome.winners.length > 0) {
              // 승자들이 받을 순위 계산
              const winnerRanks: number[] = [];
              const tempTakenRanks = new Set(takenRanks);

              roundOutcome.winners.forEach(() => {
                let rank = 1;
                while (tempTakenRanks.has(rank)) {
                  rank++;
                }
                winnerRanks.push(rank);
                tempTakenRanks.add(rank);
              });

              // 목표 순위가 배정 대상에 포함되는지 확인
              const includesTarget = winnerRanks.includes(room.targetRank);

              if (includesTarget && roundOutcome.winners.length > 1) {
                // 목표 순위를 포함하고 2명 이상 → 재대결
                // 아무도 탈락시키지 않음
              } else {
                // 목표 순위가 없거나, 1명만 승리 → 순위 확정
                roundOutcome.winners.forEach((winner) => {
                  let rank = 1;
                  while (takenRanks.has(rank)) {
                    rank++;
                  }
                  winner.status = 'eliminated';
                  const rankedPlayer = { nickname: winner.nickname, rank };
                  room.rankedPlayers.push(rankedPlayer);
                  newlyRankedPlayers.push(rankedPlayer);
                  takenRanks.add(rank);
                });
              }
            }

            if (roundOutcome.losers && roundOutcome.losers.length > 0) {
              // 패자들이 받을 순위 계산
              const loserRanks: number[] = [];
              const tempTakenRanks = new Set(takenRanks);

              roundOutcome.losers.forEach(() => {
                let rank = totalPlayers;
                while (tempTakenRanks.has(rank)) {
                  rank--;
                }
                loserRanks.push(rank);
                tempTakenRanks.add(rank);
              });

              // 목표 순위가 배정 대상에 포함되는지 확인
              const includesTarget = loserRanks.includes(room.targetRank);

              if (includesTarget && roundOutcome.losers.length > 1) {
                // 목표 순위를 포함하고 2명 이상 → 재대결
                // 아무도 탈락시키지 않음
              } else {
                // 목표 순위가 없거나, 1명만 패배 → 순위 확정
                roundOutcome.losers.forEach((loser) => {
                  let rank = totalPlayers;
                  while (takenRanks.has(rank)) {
                    rank--;
                  }
                  loser.status = 'eliminated';
                  const rankedPlayer = { nickname: loser.nickname, rank };
                  room.rankedPlayers.push(rankedPlayer);
                  newlyRankedPlayers.push(rankedPlayer);
                  takenRanks.add(rank);
                });
              }
            }
          }

          const remainingPlayers = Object.values(room.players).filter(
            (p) => p.status === 'playing',
          );

          // 남은 플레이어가 1명이면 자동으로 순위 부여
          if (remainingPlayers.length === 1) {
            const lastPlayer = remainingPlayers[0];
            lastPlayer.status = 'eliminated';

            // 이미 이 플레이어가 순위를 받았는지 확인
            const alreadyRanked = room.rankedPlayers.some(
              (p) => p.nickname === lastPlayer.nickname,
            );

            if (!alreadyRanked) {
              // 비어있는 순위 찾기 (보통 중간에 남은 순위)
              const totalPlayers = Object.keys(room.players).length;
              const takenRanks = new Set(room.rankedPlayers.map((p) => p.rank));
              let rank = 1;
              while (takenRanks.has(rank) && rank <= totalPlayers) {
                rank++;
              }
              const rankedPlayer = { nickname: lastPlayer.nickname, rank };
              room.rankedPlayers.push(rankedPlayer);
              newlyRankedPlayers.push(rankedPlayer);
            }
          }

          let isGameOver =
            remainingPlayers.length === 0 || room.currentRound >= MAX_ROUNDS;
          const achievedTarget = newlyRankedPlayers.find(
            (p) => p.rank === room.targetRank,
          );
          if (achievedTarget) isGameOver = true;

          const payload: RoundResultPayload = {
            round: room.currentRound,
            isGameOver,
            roundPlayers: roundPlayersResult,
            achievedTargetRank: achievedTarget ? [achievedTarget] : undefined,
          };
          io.to(roomId).emit('round_result', payload);
          io.to(roomId).emit('update_room', room);

          if (isGameOver) {
            room.gameState = 'results';
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
