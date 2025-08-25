import "../styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Suppress MetaMask and other extension errors that don't affect our app
    const originalError = console.error;
    console.error = (...args) => {
      const message = args[0]?.toString() || '';
      // Filter out MetaMask and extension-related errors
      if (
        message.includes('MetaMask') ||
        message.includes('inpage.js') ||
        message.includes('Failed to connect to MetaMask') ||
        message.includes('MetaMask extension not found')
      ) {
        return; // Suppress these errors
      }
      originalError.apply(console, args);
    };

    // Also handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.toString() || '';
      if (
        reason.includes('MetaMask') ||
        reason.includes('Failed to connect to MetaMask') ||
        reason.includes('MetaMask extension not found')
      ) {
        event.preventDefault(); // Prevent the error from showing
        return;
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      console.error = originalError;
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <Component {...pageProps} />
    </>
  );
}
