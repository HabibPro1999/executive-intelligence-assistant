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
  /**
   * Barge-in / new-send reset. Bumps the generation token (instantly invalidating
   * every in-flight fetch and queued handler), aborts all fetches, revokes every
   * slot URL, stops playback, and clears the pipeline. Captures `getAuthHeader` for
   * the new utterance. No-op-safe when already empty. Call in the send gesture,
   * after unlockAudio().
   */
  resetQueue: (getAuthHeader: GetAuthHeader) => void;
  /**
   * Feed one raw streaming delta. Pure-sync: appends to the internal buffer, runs the
   * sentence splitter, and enqueues each completed sentence (which kicks off bounded
   * prefetch + ordered playback). Performs NO fetch itself.
   */
  pushStreamText: (chunk: string) => void;
  /**
   * Stream 'done'. Force-flushes the trailing partial as a final sentence (ignoring the
   * MIN_FIRST / abbreviation guards — it is the end) and marks the queue terminal so
   * isSpeaking clears after the last slot finishes.
   */
  finishStream: () => void;
  /**
   * Speak an instant acknowledgement (e.g. "Let me look through your documents") as the
   * FIRST utterance, before any answer sentence. Not counted toward SPOKEN_CAP. Call right
   * after resetQueue(), inside the send gesture.
   */
  speakAck: (text: string) => void;
}

// Tiny silent WAV used to "unlock" the audio element inside a user gesture so a
// later, async-triggered play() (after the answer streams) is allowed on iOS Safari.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// --- Sentence pipeline tuning -------------------------------------------------
// Minimum length (terminators stripped) of the FIRST emitted sentence. Protects
// time-to-first-audio from shipping a bare "Hi." — once flowing, no min gate.
const MIN_FIRST = 12;
// Soft cap: a terminator-less run-on (code fence, bullet list) is force-emitted at
// the last space so it can never hold first-audio hostage.
const MAX_LEN = 400;
// Bounded parallel prefetch: number of TTS fetches allowed to race ahead of playback.
const LOOKAHEAD = 2;
// Snappy voice: speak only the first N answer sentences (the gist). The full answer
// keeps rendering on screen — the spoken reply stays conversational, not a read-aloud
// essay. The acknowledgement (speakAck) does NOT count toward this cap.
const SPOKEN_CAP = 3;
// Spoken once the cap is hit, so the voice closes gracefully instead of cutting off.
const SPOKEN_CLOSER = 'The full answer is on your screen.';
// Abbreviations whose trailing '.' is NOT a sentence boundary.
const ABBR = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie',
  'no', 'fig', 'inc', 'ltd', 'co', 'us', 'am', 'pm', 'dept', 'approx', 'jan',
  'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

type SlotStatus = 'pending' | 'fetching' | 'ready' | 'failed' | 'done';
interface Slot {
  gen: number;
  status: SlotStatus;
  url: string | null;
  abort: AbortController;
  text: string;
}
interface QueueState {
  items: Slot[];
  nextToFetch: number;
  nextToPlay: number;
  inFlight: number;
  playing: boolean;
  terminal: boolean;
}

function freshQueue(): QueueState {
  return {
    items: [],
    nextToFetch: 0,
    nextToPlay: 0,
    inFlight: 0,
    playing: false,
    terminal: false,
  };
}

/**
 * Dependency-free speech hook.
 * - STT via the Web Speech API (no-ops when unsupported).
 * - Single-blob TTS via `playTts` (kept for the deck / non-streaming callers).
 * - Streaming sentence pipeline (resetQueue / pushStreamText / finishStream): splits
 *   deltas into sentences, prefetches TTS with bounded parallelism, and plays them in
 *   order on ONE persistent, gesture-unlocked audio element.
 * Errors are swallowed silently so the demo never breaks on speech failures.
 */
export function useSpeech(): UseSpeech {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // --- Streaming pipeline state (all refs — no re-render churn) ---------------
  // Monotonic utterance id. Bumped on every reset; every async closure captures it
  // at creation and no-ops on mismatch. This is the single mechanism that kills all
  // stale-fetch / stale-blob / stale-onended races on barge-in. LOAD-BEARING.
  const genRef = useRef(0);
  const authRef = useRef<GetAuthHeader | null>(null);
  const bufferRef = useRef('');
  const firstEmittedRef = useRef(false);
  // Snappy voice: count of ANSWER sentences voiced this utterance (ack excluded), and
  // whether the graceful closer has been queued. Both reset per utterance in teardown.
  const spokenCountRef = useRef(0);
  const closedRef = useRef(false);
  const queueRef = useRef<QueueState>(freshQueue());

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

  // --- Streaming pipeline -----------------------------------------------------
  // Design: split synthesis (parallel, touches NO audio element) from playback
  // (serial, sole owner of audioRef). Synthesis writes only its own slot.url; the
  // player is the only code that assigns audio.src / calls play(). Ordering is
  // structurally guaranteed because the player only ever acts on the slot AT
  // nextToPlay and advances by exactly one — a later fetch resolving first cannot
  // play early. The generation token kills every stale-utterance race.

  // Bounded prefetch window: start fetches while inFlight < LOOKAHEAD and the next
  // unfetched slot is still pending. Caps concurrent /speech/tts requests regardless
  // of how fast sentences arrive.
  const scheduleFetches = useCallback(() => {
    const q = queueRef.current;
    while (q.inFlight < LOOKAHEAD && q.nextToFetch < q.items.length) {
      const slot = q.items[q.nextToFetch];
      if (slot.status !== 'pending') {
        // Already settled (e.g. failed before fetch) — slide past it.
        q.nextToFetch += 1;
        continue;
      }
      slot.status = 'fetching';
      q.inFlight += 1;
      q.nextToFetch += 1;
      void synthesize(slot);
    }
  }, []);

  // The ONLY writer of audio.src / play(). Reentrancy-guarded by queueRef.playing.
  // Resumes via onended/onerror, which re-call playNext() after clearing the guard.
  const playNext = useCallback(() => {
    const q = queueRef.current;
    if (q.playing) return;

    // Skip over already-settled or failed slots, then act on the slot at nextToPlay.
    for (;;) {
      if (q.nextToPlay >= q.items.length) {
        // Drained. Clear isSpeaking whenever the queue is empty — leaving it true
        // strands the UI in 'speaking' if the user barges in after the last sentence
        // played but before finishStream() fires. (terminal only governs whether the
        // queue parks for more sentences vs. is truly done; both end speech here.)
        setIsSpeaking(false);
        return;
      }
      const slot = q.items[q.nextToPlay];
      if (slot.status === 'failed' || slot.status === 'done') {
        // A failed/done sentence never stalls the queue — skip it.
        slot.status = 'done';
        q.nextToPlay += 1;
        continue;
      }
      if (slot.status !== 'ready') {
        // 'pending' / 'fetching' — not ready yet. Park. When this slot's synthesize
        // resolves it calls playNext(), which resumes IN ORDER (nextToPlay unchanged).
        return;
      }

      // Ready: play it. Sole src write / play() call in the streaming path.
      const url = slot.url;
      if (!url) {
        // Defensive: 'ready' with no url should not happen — treat as failed.
        slot.status = 'done';
        q.nextToPlay += 1;
        continue;
      }
      const audio = ensureAudio();
      const myGen = slot.gen;
      q.playing = true;
      audioUrlRef.current = url;

      const advance = () => {
        // Detach handlers, revoke this slot's URL, and ALWAYS clear the reentrancy
        // guard / advance nextToPlay — even for a stale handler firing after barge-in.
        // Skipping the cleanup would leave q.playing stuck true, blocking every
        // playNext() of the new generation at the entry guard.
        audio.onended = null;
        audio.onerror = null;
        if (slot.url) {
          URL.revokeObjectURL(slot.url);
          slot.url = null;
        }
        if (audioUrlRef.current === url) audioUrlRef.current = null;
        slot.status = 'done';
        q.nextToPlay += 1;
        q.playing = false;
        // Guard against a late handler firing after barge-in under a new gen: the
        // cleanup above is unconditional, but we must NOT drive the new generation's
        // queue from a stale handler.
        if (myGen !== genRef.current) return;
        // Resume in the same tick; re-schedule the prefetch window forward.
        playNext();
        scheduleFetches();
      };
      audio.onended = advance;
      audio.onerror = advance;

      audio.src = url;
      setIsSpeaking(true);
      // Swallow play() rejections (AbortError on rapid src swaps) so a glitch never
      // breaks the chain.
      void audio.play().catch(() => {
        /* interrupted by a new load / not unlocked yet — best effort */
      });
      return; // resume happens via onended/onerror
    }
  }, [ensureAudio, scheduleFetches]);

  // Fetch + decode one slot's audio. Runs free, may resolve out of order. NEVER
  // touches the audio element. Every state-creating await is followed by a stale
  // check against the captured gen — LOAD-BEARING for ordering + URL-leak safety.
  const synthesize = useCallback(
    async (slot: Slot) => {
      const myGen = slot.gen;
      const getAuth = authRef.current;
      try {
        const auth = getAuth ? await getAuth() : {};
        if (myGen !== genRef.current) return;
        const res = await fetch(`${API_BASE}/speech/tts`, {
          method: 'POST',
          signal: slot.abort.signal,
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: slot.text }),
        });
        if (myGen !== genRef.current) return;
        if (!res.ok) throw new Error('tts failed');
        const blob = await res.blob();
        if (myGen !== genRef.current) return;
        const url = URL.createObjectURL(blob);
        // STALE CHECK after the URL is created — revoke it ourselves on barge-in so a
        // blob that materializes a tick after abort never leaks and never plays over
        // the new utterance.
        if (myGen !== genRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        slot.url = url;
        slot.status = 'ready';
      } catch {
        // Includes AbortError on barge-in. One failed sentence never stalls the queue.
        if (myGen === genRef.current) slot.status = 'failed';
      } finally {
        if (myGen === genRef.current) {
          queueRef.current.inFlight -= 1;
          // Wake the player (this slot may be the one it parked on) and slide the
          // prefetch window forward.
          playNext();
          scheduleFetches();
        }
      }
    },
    [playNext, scheduleFetches],
  );

  // Push a completed sentence into the queue and drive the pipeline. Idempotent
  // playNext() call here closes the lost-wakeup window (sentence arriving exactly as
  // the player parks empty-non-terminal).
  const enqueueSentence = useCallback(
    (text: string) => {
      const q = queueRef.current;
      q.items.push({
        gen: genRef.current,
        status: 'pending',
        url: null,
        abort: new AbortController(),
        text,
      });
      scheduleFetches();
      playNext();
    },
    [scheduleFetches, playNext],
  );

  // True iff buf[p] is a real sentence boundary char (not a decimal point, an
  // abbreviation dot, or an initial). A newline is always a boundary.
  const isBoundaryChar = useCallback((buf: string, p: number): boolean => {
    const ch = buf[p];
    if (ch === '\n') return true;
    if (ch !== '.' && ch !== '!' && ch !== '?') return false;
    if (ch === '.') {
      const prev = buf[p - 1];
      const next = buf[p + 1];
      // Decimal / version: 3.5, 1.2 — not a boundary.
      if (prev && next && /[0-9]/.test(prev) && /[0-9]/.test(next)) return false;
      // Walk back over the word ending at this '.'.
      let s = p - 1;
      while (s >= 0 && /[A-Za-z.]/.test(buf[s])) s -= 1;
      const word = buf.slice(s + 1, p).replace(/\./g, '').toLowerCase();
      if (word.length === 1) return false; // initial: "J."
      if (ABBR.has(word)) return false; // known abbreviation
    }
    return true;
  }, []);

  // Run the splitter over the current buffer, emitting every completed sentence and
  // keeping the trailing partial. force=true (finishStream) flushes the remainder
  // ignoring all guards.
  const drainBuffer = useCallback(
    (force: boolean) => {
      // Snappy voice: once the spoken cap is reached, stop voicing — the full answer
      // is already on screen. Drop any buffered remainder.
      if (spokenCountRef.current >= SPOKEN_CAP) {
        bufferRef.current = '';
        return;
      }
      const buf = bufferRef.current;
      let cut = 0;
      let i = 0;
      let halt = false;
      // Emit one answer sentence, counting it toward the cap. On hitting the cap, queue
      // a graceful closer (once) so the voice doesn't cut mid-thought, then halt.
      const emit = (text: string) => {
        enqueueSentence(text);
        firstEmittedRef.current = true;
        spokenCountRef.current += 1;
        if (spokenCountRef.current >= SPOKEN_CAP) {
          if (!closedRef.current) {
            enqueueSentence(SPOKEN_CLOSER);
            closedRef.current = true;
          }
          halt = true;
        }
      };
      while (i < buf.length) {
        if (isBoundaryChar(buf, i)) {
          // Extend over a contiguous run of terminators so "word.\n\n" collapses to
          // one boundary.
          let e = i;
          while (e + 1 < buf.length && /[.!?\n]/.test(buf[e + 1])) e += 1;
          const afterEnd = e + 1 >= buf.length;
          const valid =
            afterEnd || /\s/.test(buf[e + 1]) || buf[e] === '\n';
          if (!valid) {
            i = e + 1;
            continue;
          }
          const candidate = buf.slice(cut, e + 1).trim();
          if (candidate.length === 0) {
            cut = e + 1;
            i = e + 1;
            continue;
          }
          if (!firstEmittedRef.current) {
            // MIN_FIRST gate protects time-to-first-audio only: don't ship a tiny
            // first sentence — merge it forward.
            const bare = candidate.replace(/[.!?\n\s]+$/, '');
            if (bare.length < MIN_FIRST) {
              i = e + 1;
              continue;
            }
          }
          emit(candidate);
          cut = e + 1;
          i = e + 1;
          if (halt) {
            bufferRef.current = '';
            return;
          }
          continue;
        }

        // Soft cap: a terminator-less run-on must not hold first-audio hostage. Emit
        // at the last space before i.
        if (i - cut >= MAX_LEN) {
          const segment = buf.slice(cut, i);
          const lastSpace = segment.lastIndexOf(' ');
          const breakAt = lastSpace > 0 ? cut + lastSpace : i;
          const candidate = buf.slice(cut, breakAt).trim();
          if (candidate.length > 0) emit(candidate);
          cut = breakAt;
          // Skip the single break space if we broke on one.
          if (lastSpace > 0) cut += 1;
          i = cut;
          if (halt) {
            bufferRef.current = '';
            return;
          }
          continue;
        }
        i += 1;
      }

      if (force) {
        const remainder = buf.slice(cut).trim();
        // Ignore MIN_FIRST / abbrev guards — this is the end; a tail like "approx."
        // or a sub-12-char remainder must still speak.
        if (remainder.length > 0) emit(remainder);
        bufferRef.current = '';
      } else {
        bufferRef.current = buf.slice(cut);
      }
    },
    [isBoundaryChar, enqueueSentence],
  );

  const pushStreamText = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      bufferRef.current += chunk;
      drainBuffer(false);
    },
    [drainBuffer],
  );

  const speakAck = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // Instant acknowledgement: queued as the first slot (resetQueue already ran), so
      // it plays before any answer sentence. Not counted toward SPOKEN_CAP. Marking
      // firstEmitted means the first real answer sentence skips the MIN_FIRST merge and
      // speaks as soon as it lands.
      enqueueSentence(t);
      firstEmittedRef.current = true;
    },
    [enqueueSentence],
  );

  const finishStream = useCallback(() => {
    drainBuffer(true);
    queueRef.current.terminal = true;
    firstEmittedRef.current = false;
    // Flip isSpeaking off if the queue already drained (nothing was emitted, or all
    // slots finished before 'done' arrived).
    playNext();
  }, [drainBuffer, playNext]);

  // Hard reset of the pipeline. Order matters — see the inline notes.
  const teardownQueue = useCallback(() => {
    // 1. Invalidate every in-flight closure / queued handler INSTANTLY, before
    //    aborts even land.
    genRef.current += 1;
    const q = queueRef.current;
    // 2. Abort in-flight fetches + revoke every slot URL (slots that synthesized but
    //    never played hold objectURLs NOT tracked by audioUrlRef — must walk them).
    for (const slot of q.items) {
      try {
        slot.abort.abort();
      } catch {
        /* ignore */
      }
      if (slot.url) {
        URL.revokeObjectURL(slot.url);
        slot.url = null;
      }
    }
    // 3. Detach handlers BEFORE pausing so a late handler can't re-enter playNext
    //    under the new gen, then stop (pause + revoke current url + isSpeaking=false).
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
    }
    stopAudio();
    // 4. Clear buffer + slots + counters.
    bufferRef.current = '';
    firstEmittedRef.current = false;
    spokenCountRef.current = 0;
    closedRef.current = false;
    queueRef.current = freshQueue();
  }, [stopAudio]);

  const resetQueue = useCallback(
    (getAuthHeader: GetAuthHeader) => {
      teardownQueue();
      // Capture getAuthHeader ONCE for the new utterance (it may be async / refresh a
      // token); each fetch awaits authRef.current() independently.
      authRef.current = getAuthHeader;
    },
    [teardownQueue],
  );

  // Clean up recognition and audio on unmount. Also bump gen + abort all slots so
  // in-flight fetch blobs don't leak after unmount.
  useEffect(() => {
    return () => {
      stop();
      teardownQueue();
    };
  }, [stop, teardownQueue]);

  return {
    supported,
    isListening,
    start,
    stop,
    isSpeaking,
    playTts,
    unlockAudio,
    resetQueue,
    pushStreamText,
    finishStream,
    speakAck,
  };
}

export default useSpeech;
