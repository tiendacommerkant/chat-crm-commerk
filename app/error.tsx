'use client'; // Error components must be Client Components

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24 text-center">
      <h2 className="text-2xl font-bold text-red-600 mb-4">Algo salió mal</h2>
      <p className="text-gray-600 mb-4 bg-gray-100 p-4 rounded text-left max-w-2xl overflow-auto">
        {error.message}
      </p>
      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-[#1B3A6B] text-white rounded hover:bg-blue-900"
      >
        Intentar de nuevo
      </button>
    </div>
  );
}
