import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SocketProvider } from '@/contexts/SocketContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  // title: 'RPS Arena',
  title: '가위바위보 내기용',
  description: '안내면 진거!',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='ko'>
      <body className={inter.className}>
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
