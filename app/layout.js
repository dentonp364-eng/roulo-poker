
import "./globals.css";

export const metadata = {
  title: "Trashguy Poker",
  description: "Join the Trashguy Poker tables.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
