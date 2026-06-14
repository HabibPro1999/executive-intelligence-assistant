'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Mirrors the API base convention in lib/api.ts: NEXT_PUBLIC_API_URL with the
// client appending /api. Kept local so this hook stays self-contained.
const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const API_BASE = `${BASE}/api`;

type AuthHeader = Record<string, string>;
type GetAuthHeader = () => AuthHeader | Promise<AuthHeader>;

// Minimal Web Speech API typings (not in the default DOM lib).
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: { length: number; [index: number]: SpeechRecognitionResult };
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface UseSpeech {
  supported: boolean;
  isListening: boolean;
  start: (onText: (t: string) => void) => void;
  stop: () => void;
  isSpeaking: boolean;
  playTts: (text: string, getAuthHeader: GetAuthHeader) => Promise<void>;
}

/**
 * Dependency-free speech hook.
 * - STT via the Web Speech API (no-ops when unsupported).
 * - TTS by POSTing { text } to `${API_BASE}/speech/tts` and playing the audio blob.
 * Errors are swallowed silently so the demo never breaks on speech failures.
 */
export function useSpeech(): UseSpeech {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const supported = getRecognitionCtor() !== null;

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(
    (onText: (t: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;

      // Tear down any in-flight session before starting a new one.
      if (recognitionRef.current) stop();

      const recognition = new Ctor();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i += 1) {
          transcript += event.results[i][0].transcript;
        }
        onText(transcript);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };
      recognition.onerror = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
      }
    },
    [stop],
  );

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const playTts = useCallback(
    async (text: string, getAuthHeader: GetAuthHeader) => {
      // Stop any prior playback first.
      stopAudio();
      try {
        const auth = await getAuthHeader();
        const res = await fetch(`${API_BASE}/speech/tts`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return;

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioUrlRef.current = url;
        audioRef.current = audio;

        const cleanup = () => {
          if (audioRef.current === audio) {
            audioRef.current = null;
            setIsSpeaking(false);
          }
          if (audioUrlRef.current === url) {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
          }
        };
        audio.onended = cleanup;
        audio.onerror = cleanup;

        setIsSpeaking(true);
        await audio.play();
      } catch {
        // Demo-safe: swallow STT/TTS errors silently.
        stopAudio();
      }
    },
    [stopAudio],
  );

  // Clean up recognition and audio on unmount.
  useEffect(() => {
    return () => {
      stop();
      stopAudio();
    };
  }, [stop, stopAudio]);

  return { supported, isListening, start, stop, isSpeaking, playTts };
}

export default useSpeech;
