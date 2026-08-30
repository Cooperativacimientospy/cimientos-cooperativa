import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cooperativa Cimientos Ltda.',
  description: 'Solicitud de admisión y panel de administración de la Cooperativa Cimientos Ltda.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
