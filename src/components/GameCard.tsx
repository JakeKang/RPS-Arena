import styles from './GameCard.module.css';

interface GameCardProps {
  type: 'rock' | 'paper' | 'scissors';
  onSelect: (choice: 'rock' | 'paper' | 'scissors') => void;
  isSelected: boolean;
  disabled: boolean;
}

export default function GameCard({
  type,
  onSelect,
  isSelected,
  disabled,
}: GameCardProps) {
  const symbols = {
    rock: '✊',
    paper: '✋',
    scissors: '✌️',
  };

  const labels = {
    rock: '바위',
    paper: '보',
    scissors: '가위',
  };

  const handleClick = () => {
    if (!disabled) {
      onSelect(type);
    }
  };

  const cardClasses = [
    styles.card,
    isSelected ? styles.selected : '',
    disabled ? styles.disabled : '',
  ].join(' ');

  return (
    <div className={cardClasses} onClick={handleClick}>
      <span className={styles.symbol}>{symbols[type]}</span>
      <span className={styles.label}>{labels[type]}</span>
    </div>
  );
}
