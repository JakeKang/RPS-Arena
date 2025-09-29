'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSocket } from '@/contexts/SocketContext';
import GameCard from '@/components/GameCard';
import styles from '@/styles/Game.module.css';
import {
  Choice,
  Room,
  RoundResultPayload,
  RankedPlayer,
} from '@/types/index.type';

export default function GameRoom() {
  const socket = useSocket();
  const router = useRouter();
  const params = useParams();
  const roomId = params.roomId as string;

  const [room, setRoom] = useState<Room | null>(null);
  const [myChoice, setMyChoice] = useState<Choice>(null);
  const [timer, setTimer] = useState<number | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResultPayload | null>(
    null,
  );
  const [gameOverCountdown, setGameOverCountdown] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit('get_room', roomId);

    const handleUpdateRoom = (updatedRoom: Room) => setRoom(updatedRoom);
    const handleNewRound = () => {
      setMyChoice(null);
      setTimer(null);
      setRoundResult(null);
    };
    const handleTimer = (time: number) => setTimer(time);
    const handleRoundResult = (result: RoundResultPayload) => {
      setRoundResult(result);
      if (result.isGameOver) setGameOverCountdown(10);
    };
    const handleErrorMessage = (msg: string) => {
      alert(msg);
      router.push('/');
    };
    const handleGameOverRedirect = () => router.push('/');

    socket.on('update_room', handleUpdateRoom);
    socket.on('new_round', handleNewRound);
    socket.on('timer', handleTimer);
    socket.on('round_result', handleRoundResult);
    socket.on('error_message', handleErrorMessage);
    socket.on('game_over_redirect', handleGameOverRedirect);

    return () => {
      socket.off('update_room');
      socket.off('new_round');
      socket.off('timer');
      socket.off('round_result');
      socket.off('error_message');
      socket.off('game_over_redirect');
    };
  }, [socket, roomId, router]);

  useEffect(() => {
    if (gameOverCountdown === null) return;
    if (gameOverCountdown > 0) {
      const interval = setInterval(
        () => setGameOverCountdown((prev) => (prev ? prev - 1 : 0)),
        1000,
      );
      return () => clearInterval(interval);
    }
  }, [gameOverCountdown]);

  const playerList = useMemo(() => {
    if (!room) return [];
    return Object.values(room.players).sort((a, b) => {
      const rankA =
        room.rankedPlayers.find((p) => p.nickname === a.nickname)?.rank ||
        Infinity;
      const rankB =
        room.rankedPlayers.find((p) => p.nickname === b.nickname)?.rank ||
        Infinity;
      if (rankA !== Infinity || rankB !== Infinity) return rankA - rankB;
      return a.nickname.localeCompare(b.nickname);
    });
  }, [room]);

  const handleSelectCard = (choice: 'rock' | 'paper' | 'scissors') => {
    const myId = socket?.id;
    const me = myId ? room?.players[myId] : undefined;
    if (
      room?.gameState === 'playing' &&
      !myChoice &&
      me?.status === 'playing'
    ) {
      setMyChoice(choice);
      socket?.emit('make_choice', { roomId, choice });
    }
  };

  const handleStartGame = () => socket?.emit('start_game', roomId);
  const handleLeaveRoom = () => {
    socket?.emit('leave_room', roomId);
    router.push('/');
  };
  const getPlayerRank = (nickname: string): RankedPlayer | undefined =>
    room?.rankedPlayers.find((p) => p.nickname === nickname);

  const choiceToEmoji = (choice: Choice) => {
    if (choice === 'rock') return '✊';
    if (choice === 'paper') return '✋';
    if (choice === 'scissors') return '✌️';
    return '❔';
  };

  const isHost = socket?.id === room?.hostId;
  const me = socket?.id ? room?.players[socket.id] : null;

  const renderModalContent = () => {
    if (!roundResult) return null;
    if (roundResult.isGameOver) {
      const targetPlayer = roundResult.achievedTargetRank?.[0];
      const winner = roundResult.finalWinner;
      return (
        <>
          <h2>게임 종료!</h2>
          {targetPlayer && (
            <h3>
              🎉 {targetPlayer.nickname}님, {targetPlayer.rank}위 달성! 🎉
            </h3>
          )}
          {winner && !targetPlayer && (
            <h3>🏆 최종 우승: {winner.nickname} 🏆</h3>
          )}
          <p className={styles.nextRoundMsg}>
            {gameOverCountdown}초 후 로비로 이동합니다.
          </p>
        </>
      );
    }
    return (
      <>
        <h2>라운드 {roundResult.round} 결과</h2>
        <ul className={styles.resultPlayerList}>
          {roundResult.roundPlayers.map((p) => (
            <li
              key={p.nickname}
              className={p.eliminated ? styles.eliminated : ''}>
              <span>{p.nickname}</span>
              <span className={styles.resultPlayerChoice}>
                {choiceToEmoji(p.choice)}
              </span>
              <span className={styles.resultPlayerStatus}>
                {p.eliminated ? '❌ 탈락' : '✅ 생존'}
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.nextRoundMsg}>
          잠시 후 다음 라운드가 시작됩니다...
        </p>
      </>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h1>RPS Arena</h1>
        </div>
        <button onClick={handleLeaveRoom} className={styles.leaveButton}>
          나가기
        </button>
      </header>

      {roundResult && (
        <div className={styles.overlay}>
          <div className={styles.modal}>{renderModalContent()}</div>
        </div>
      )}

      <div className={styles.mainContent}>
        <div className={styles.leftColumn}>
          <div className={styles.gameInfoContainer}>
            <div className={styles.infoCard}>
              <span>ROOM CODE</span>
              <h2>{roomId}</h2>
            </div>
            <div className={styles.infoCard}>
              <span>TARGET RANK</span>
              <h2>{room?.targetRank}위</h2>
            </div>
          </div>
          <div className={styles.playerListContainer}>
            <h2>
              참가자 ({Object.keys(room?.players || {}).length}/
              {room?.maxPlayers})
            </h2>
            <ul className={styles.playerList}>
              {playerList.map((p) => {
                const rankInfo = getPlayerRank(p.nickname);
                return (
                  <li
                    key={p.id}
                    className={
                      p.status !== 'playing' ? styles.eliminatedPlayer : ''
                    }>
                    <span className={styles.playerRank}>
                      {rankInfo ? `${rankInfo.rank}위` : '-'}
                    </span>
                    <span className={styles.playerName}>
                      {p.id === room?.hostId && '👑 '}
                      {p.nickname}
                      {p.id === socket?.id && ' (나)'}
                    </span>
                    <span className={styles.playerStatus}>
                      {p.status === 'winner' && '🏆'}
                      {p.status === 'eliminated' && '❌'}
                      {room?.gameState === 'playing' &&
                        p.status === 'playing' &&
                        (p.choice ? '✅' : '🤔')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className={styles.gameArea}>
          <div className={styles.status}>
            {room?.gameState === 'playing' && timer !== null && (
              <div className={styles.timer}>{timer}</div>
            )}
            <p className={styles.statusText}>
              {room?.gameState === 'waiting' &&
                '방장이 시작하기를 기다리는 중...'}
              {room?.gameState === 'playing' &&
                `라운드 ${room.currentRound}: 선택하세요!`}
              {room?.gameState === 'results' && '게임 종료!'}
            </p>
          </div>
          <div className={styles.cardContainer}>
            <GameCard
              type='rock'
              onSelect={handleSelectCard}
              isSelected={myChoice === 'rock'}
              disabled={!!myChoice || me?.status !== 'playing'}
            />
            <GameCard
              type='paper'
              onSelect={handleSelectCard}
              isSelected={myChoice === 'paper'}
              disabled={!!myChoice || me?.status !== 'playing'}
            />
            <GameCard
              type='scissors'
              onSelect={handleSelectCard}
              isSelected={myChoice === 'scissors'}
              disabled={!!myChoice || me?.status !== 'playing'}
            />
          </div>
          {isHost &&
            (room?.gameState === 'waiting' ||
              room?.gameState === 'results') && (
              <button
                onClick={handleStartGame}
                disabled={Object.keys(room?.players || {}).length < 2}
                className={styles.startButton}>
                {room?.gameState === 'results' ? '새 게임 시작' : '게임 시작'}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
