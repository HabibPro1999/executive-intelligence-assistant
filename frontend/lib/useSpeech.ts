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
  /** Call from a user gesture (e.g. send click) to allow later programmatic playback on iOS. */
  unlockAudio: () => void;
}

// Tiny silent WAV used to "unlock" the audio element inside a user gesture so a
// later, async-triggered play() (after the answer streams) is allowed on iOS Safari.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

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

  // One persistent <audio> element, reused for every utterance. Reusing the same
  // element (rather than `new Audio()` per play) is what lets a gesture-unlocked
  // element keep playing on iOS after async work.
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    const audio = ensureAudio();
    try {
      audio.src = SILENT_WAV;
      const p = audio.play();
      if (p) {
        void p
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch(() => {
            /* gesture not honored yet — best effort */
          });
      }
    } catch {
      /* ignore */
    }
  }, [ensureAudio]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
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
        // Reuse the persistent, gesture-unlocked element so iOS allows playback.
        const audio = ensureAudio();
        audioUrlRef.current = url;

        const cleanup = () => {
          setIsSpeaking(false);
          if (audioUrlRef.current === url) {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
          }
        };
        audio.onended = cleanup;
        audio.onerror = cleanup;

        audio.src = url;
        setIsSpeaking(true);
        await audio.play();
      } catch {
        // Demo-safe: swallow STT/TTS errors silently.
        stopAudio();
      }
    },
    [ensureAudio, stopAudio],
  );

  // Clean up recognition and audio on unmount.
  useEffect(() => {
    return () => {
      stop();
      stopAudio();
    };
  }, [stop, stopAudio]);

  return { supported, isListening, start, stop, isSpeaking, playTts, unlockAudio };
}

export default useSpeech;
