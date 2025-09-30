'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/contexts/SocketContext';
import styles from '@/styles/Home.module.css';

export default function Home() {
  const socket = useSocket();
  const router = useRouter();

  const [nickname, setNickname] = useState('');
  const [activeTab, setActiveTab] = useState('create');

  // Create Room State
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [targetRank, setTargetRank] = useState(1);

  // Join Room State
  const [roomIdInput, setRoomIdInput] = useState('');

  useEffect(() => {
    if (!socket) return;

    const handleRoomCreated = (roomId: string) =>
      router.push(`/game/${roomId}`);
    const handleJoinedRoom = (roomId: string) => router.push(`/game/${roomId}`);
    const handleErrorMessage = (msg: string) => alert(msg);

    socket.on('room_created', handleRoomCreated);
    socket.on('joined_room', handleJoinedRoom);
    socket.on('error_message', handleErrorMessage);

    return () => {
      socket.off('room_created', handleRoomCreated);
      socket.off('joined_room', handleJoinedRoom);
      socket.off('error_message', handleErrorMessage);
    };
  }, [socket, router]);

  const handleCreateRoom = () => {
    if (!nickname.trim()) return alert('닉네임을 입력해주세요.');
    socket?.emit('create_room', { nickname, maxPlayers, targetRank });
  };

  const handleJoinRoom = () => {
    if (!nickname.trim()) return alert('닉네임을 입력해주세요.');
    if (!roomIdInput.trim()) return alert('방 코드를 입력해주세요.');
    socket?.emit('join_room', {
      roomId: roomIdInput.trim().toUpperCase(),
      nickname,
    });
  };

  return (
    <main className={styles.container}>
      <div className={styles.logo}>
        {/*<h1>RPS Arena</h1>*/}
        <h1>가위바위보 내기용</h1>
        {/*<p>최후의 승자가 되어보세요!</p>*/}
        <p>안내면 진거!</p>
      </div>
      <div className={styles.lobbyCard}>
        <div className={styles.inputGroup}>
          <label htmlFor='nickname'>닉네임</label>
          <input
            id='nickname'
            type='text'
            placeholder='사용할 닉네임 입력'
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={10}
          />
        </div>

        <div className={styles.tabs}>
          <button
            onClick={() => setActiveTab('create')}
            className={activeTab === 'create' ? styles.active : ''}>
            방 만들기
          </button>
          <button
            onClick={() => setActiveTab('join')}
            className={activeTab === 'join' ? styles.active : ''}>
            참가하기
          </button>
        </div>

        {activeTab === 'create' && (
          <div className={styles.tabContent}>
            <div className={styles.inputGroup}>
              <label htmlFor='max-players'>최대 인원 (2-16)</label>
              <input
                id='max-players'
                type='number'
                min='2'
                max='16'
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
              />
            </div>
            <div className={styles.inputGroup}>
              <label htmlFor='target-rank'>당첨 순위 (1-{maxPlayers})</label>
              <input
                id='target-rank'
                type='number'
                min='1'
                max={maxPlayers}
                value={targetRank}
                onChange={(e) => setTargetRank(Number(e.target.value))}
              />
            </div>
            <button className={styles.actionButton} onClick={handleCreateRoom}>
              만들기
            </button>
          </div>
        )}

        {activeTab === 'join' && (
          <div className={styles.tabContent}>
            <div className={styles.inputGroup}>
              <label htmlFor='room-id'>방 코드</label>
              <input
                id='room-id'
                type='text'
                placeholder='네 자리 코드 입력'
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                maxLength={4}
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <button className={styles.actionButton} onClick={handleJoinRoom}>
              입장하기
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
