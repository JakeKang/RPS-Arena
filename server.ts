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
const MAX_ROUNDS = 50; // 무한 루프 방지를 위한 최대 라운드 제한

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
  draw: boolean;
} {
  const choices = currentPlayers
    .map((p) => p.choice)
    .filter((c): c is NonNullable<Choice> => c !== null);
  const uniqueChoices = [...new Set(choices)];

  if (uniqueChoices.length !== 2) {
    return { winners: currentPlayers, losers: [], draw: true };
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

  const winners = currentPlayers.filter((p) => p.choice === winnerChoice);
  const losers = currentPlayers.filter(
    (p) => p.choice !== null && p.choice !== winnerChoice,
  );

  return { winners, losers, draw: false };
}

// ... (handlePlayerLeave 함수는 이전과 동일)
const handlePlayerLeave = (io: Server, socketId: string) => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players[socketId]) {
      delete room.players[socketId];
      if (Object.keys(room.players).length === 0) {
        if (room.gameTimer) clearInterval(room.gameTimer);
        delete rooms[roomId];
      } else {
        if (room.hostId === socketId) {
          room.hostId = Object.keys(room.players)[0];
        }
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
    // ... ('create_room', 'join_room', 'get_room' 이벤트 핸들러는 이전과 동일)
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
      if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
        socket.emit('update_room', rooms[roomId]);
      }
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
          let isGameOver = false;

          // ===== 오류 해결: 최대 라운드 도달 시 게임 강제 종료 =====
          if (room.currentRound >= MAX_ROUNDS) {
            isGameOver = true;
            const finalRank = 1;
            activePlayers.forEach((p) => {
              room.players[p.id].status = 'winner';
              const rankedPlayer = { nickname: p.nickname, rank: finalRank };
              if (
                !room.rankedPlayers.some(
                  (rp) => rp.nickname === rankedPlayer.nickname,
                )
              ) {
                room.rankedPlayers.push(rankedPlayer);
              }
            });

            const payload: RoundResultPayload = {
              round: room.currentRound,
              isGameOver: true,
              roundPlayers: activePlayers.map((p) => ({
                nickname: p.nickname,
                choice: p.choice,
                eliminated: false,
              })),
              achievedTargetRank: room.rankedPlayers.filter(
                (p) => p.rank === room.targetRank,
              ),
              finalWinner: undefined, // 공동 우승 처리
            };

            io.to(roomId).emit('round_result', payload);
            io.to(roomId).emit('update_room', room);
            setTimeout(() => {
              io.to(roomId).emit('game_over_redirect');
            }, 10000);
            return; // 아래 로직 실행 방지
          }
          // =========================================================

          const playersForRound = activePlayers.filter(
            (p) => p.choice !== null,
          );
          const eliminatedForNotChoosing = activePlayers.filter(
            (p) => p.choice === null,
          );
          const roundOutcome = determineRoundOutcome(playersForRound);
          const eliminatedThisRound = roundOutcome.losers.concat(
            eliminatedForNotChoosing,
          );

          const roundPlayersResult: RoundPlayerResult[] = activePlayers.map(
            (p) => ({
              nickname: p.nickname,
              choice: p.choice,
              eliminated: eliminatedThisRound.some((e) => e.id === p.id),
            }),
          );

          const remainingPlayers = activePlayers.filter(
            (p) => !eliminatedThisRound.find((e) => e.id === p.id),
          );
          if (eliminatedThisRound.length > 0) {
            const rankForEliminated = remainingPlayers.length + 1;
            eliminatedThisRound.forEach((p) => {
              if (room.players[p.id]) {
                room.players[p.id].status = 'eliminated';
                const rankedPlayer = {
                  nickname: p.nickname,
                  rank: rankForEliminated,
                };
                if (
                  !room.rankedPlayers.some(
                    (rp) => rp.nickname === rankedPlayer.nickname,
                  )
                )
                  room.rankedPlayers.push(rankedPlayer);
              }
            });
          }

          let achievedTarget = room.rankedPlayers.find(
            (p) => p.rank === room.targetRank,
          );
          isGameOver = !!achievedTarget;
          let finalWinner: RankedPlayer | undefined = undefined;

          if (remainingPlayers.length === 1 && !isGameOver) {
            const winner = remainingPlayers[0];
            if (room.players[winner.id].status === 'playing') {
              room.players[winner.id].status = 'winner';
              finalWinner = { nickname: winner.nickname, rank: 1 };
              if (
                !room.rankedPlayers.some(
                  (rp) => rp.nickname === finalWinner!.nickname,
                )
              )
                room.rankedPlayers.push(finalWinner);
              if (room.targetRank === 1) {
                achievedTarget = finalWinner;
                isGameOver = true;
              }
            }
          } else if (remainingPlayers.length < 1 && !isGameOver) {
            isGameOver = true;
          }

          const payload: RoundResultPayload = {
            round: room.currentRound,
            isGameOver,
            roundPlayers: roundPlayersResult,
            achievedTargetRank: achievedTarget ? [achievedTarget] : undefined,
            finalWinner,
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

    // ... ('start_game', 'make_choice', 'leave_room', 'disconnect' 이벤트 핸들러는 이전과 동일)
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
        if (room?.players[socket.id]?.status === 'playing') {
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
