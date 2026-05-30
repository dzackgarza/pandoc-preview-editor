import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function basename(path: string | null) {
  if (!path) return 'Untitled';
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function lineCount(markdown: string) {
  if (markdown.length === 0) return 1;
  return markdown.split('\n').length;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve((reader.result as string).split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
