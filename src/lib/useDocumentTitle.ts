import { useEffect } from 'react';

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title === 'BuhurtOS' ? 'BuhurtOS' : `${title} · BuhurtOS`;
  }, [title]);
}
