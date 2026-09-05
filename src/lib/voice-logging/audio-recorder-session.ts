/**
 * Microphone / `MediaRecorder` / Web Audio boundary. Plain TS, no React.
 *
 * ## Why record audio at all, when `SpeechRecognition` captures its own
 *
 * The Web Speech API opens its own microphone internally and offers no way
 * to hand it a `MediaStream` — there is no such parameter in the spec. So
 * this module's capture is genuinely *separate* from transcription, and it
 * is fair to ask what it's for. Three things, all real:
 *
 * 1. **The permission moment.** `getUserMedia()` is an explicit, catchable,
 *    classifiable permission request. `SpeechRecognition.start()` surfaces
 *    a denial as a late, generic `not-allowed` error event, which is a much
 *    worse basis for routing a diver to manual entry with an accurate
 *    explanation.
 * 2. **The live level meter.** Mockup 02's waveform is not decoration — it
 *    is the only feedback that the mic is actually hearing something. A
 *    diver who records two minutes into a dead microphone and discovers it
 *    at the confirm screen has lost the log. Levels come from an
 *    `AnalyserNode`, which needs a real stream.
 * 3. **Honest duration.** Mockup 03 shows "0:52 recording"; measuring that
 *    from the capture session rather than a wall-clock guess keeps it true
 *    when the tab is throttled.
 *
 * The recorded `Blob` itself is held in memory and never uploaded or
 * persisted — consistent with the disclosure copy and with
 * THREAT_MODEL.md §3's consent finding. It exists so that a future,
 * explicitly-consented cloud-STT fallback has something to work with
 * without re-recording; today it is dropped when the session ends.
 *
 * ## Everything below the stream is optional
 *
 * `MediaRecorder` and `AudioContext` are each wrapped so that a failure
 * degrades that one capability and nothing else. A browser without
 * `MediaRecorder` still gets levels and transcription; one that refuses an
 * `AudioContext` still gets a recording and transcription. Only the
 * `getUserMedia` call itself is allowed to fail the session, because
 * without a stream there is no microphone to speak into.
 */

import { logger } from "./logger";

/** The two ways a capture request can fail, mapped to `ManualEntryReason` values. */
export type AudioCaptureFailure = "mic-denied" | "mic-unavailable";

/**
 * Classify a `getUserMedia` rejection by its `DOMException.name`.
 *
 * The distinction that matters to the diver is "you said no / your browser
 * says no" versus "there was nothing to record with" — those need different
 * sentences on the manual-entry screen, and only the first is worth
 * offering a settings hint for. Unknown names fall through to
 * `mic-unavailable` rather than `mic-denied`, because telling someone they
 * denied a permission they didn't deny sends them to fix something that
 * isn't broken.
 */
export function classifyGetUserMediaError(name: string): AudioCaptureFailure {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "mic-denied";
    default:
      return "mic-unavailable";
  }
}

export interface AudioRecorderStopResult {
  /** The captured audio, or null if `MediaRecorder` was unavailable or failed. */
  blob: Blob | null;
  /** Measured capture duration in ms. */
  durationMs: number;
}

export interface AudioRecorderSession {
  /**
   * Current input level, 0..1, sampled on demand.
   *
   * Pull-based rather than push-based deliberately: an `AnalyserNode`
   * callback firing at audio rate would drive React re-renders far faster
   * than a human can perceive. The hook polls this on a modest interval
   * instead.
   */
  getLevel(): number;
  /** Stop capture and release the microphone. Resolves with the recording. */
  stop(): Promise<AudioRecorderStopResult>;
  /** Abandon capture and release the microphone. No result. */
  cancel(): void;
}

export type StartAudioRecorderResult =
  | { ok: true; session: AudioRecorderSession }
  | { ok: false; reason: AudioCaptureFailure };

const FFT_SIZE = 256;

/**
 * Request the microphone and begin capture.
 *
 * Never throws — every failure path resolves to `{ ok: false }` with a
 * classified reason, because "offline is the default and network/permission
 * failures are an expected code path, not an edge case" (CLAUDE.md) applies
 * just as much to a denied mic as to a dropped request.
 */
export async function startAudioRecorderSession(): Promise<StartAudioRecorderResult> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    logger.info("recorder.unsupported", { reason: "no-media-devices" });
    return { ok: false, reason: "mic-unavailable" };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const reason = classifyGetUserMediaError(name);
    logger.warn("recorder.permission-failed", { name, reason });
    return { ok: false, reason };
  }

  const startedAt = Date.now();
  const chunks: Blob[] = [];
  let recorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let levelBuffer: Uint8Array<ArrayBuffer> | null = null;
  let released = false;

  // --- Optional: MediaRecorder ---
  try {
    if (typeof MediaRecorder !== "undefined") {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        logger.warn("recorder.media-recorder-error", { error: String((event as ErrorEvent).error ?? "unknown") });
      };
      recorder.start();
    } else {
      logger.info("recorder.media-recorder-unavailable", {});
    }
  } catch (err) {
    // Degrade: no audio blob, but levels and transcription still work.
    logger.warn("recorder.media-recorder-start-failed", { error: String(err) });
    recorder = null;
  }

  // --- Optional: Web Audio level metering ---
  try {
    const AudioContextCtor =
      typeof window !== "undefined"
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (AudioContextCtor) {
      audioContext = new AudioContextCtor();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      levelBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }
  } catch (err) {
    // Degrade: a static waveform instead of a live one.
    logger.warn("recorder.analyser-failed", { error: String(err) });
    analyser = null;
    levelBuffer = null;
  }

  /**
   * Releasing the stream tracks is not cleanup politeness — leaving them
   * live keeps the browser's "this site is using your microphone" indicator
   * on after the diver thinks they've stopped, which is both alarming and
   * a real privacy failure.
   */
  const release = () => {
    if (released) return;
    released = true;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (err) {
        logger.debug("recorder.track-stop-failed", { error: String(err) });
      }
    }
    if (audioContext) {
      void audioContext.close().catch((err: unknown) => {
        logger.debug("recorder.audio-context-close-failed", { error: String(err) });
      });
      audioContext = null;
    }
    analyser = null;
    levelBuffer = null;
  };

  logger.info("recorder.started", { hasRecorder: recorder !== null, hasAnalyser: analyser !== null });

  return {
    ok: true,
    session: {
      getLevel(): number {
        if (!analyser || !levelBuffer) return 0;
        try {
          analyser.getByteTimeDomainData(levelBuffer);
          // RMS around the 128 midpoint of unsigned 8-bit PCM, normalised
          // to roughly 0..1 for a speaking voice.
          let sumSquares = 0;
          for (let i = 0; i < levelBuffer.length; i += 1) {
            const deviation = (levelBuffer[i] - 128) / 128;
            sumSquares += deviation * deviation;
          }
          const rms = Math.sqrt(sumSquares / levelBuffer.length);
          return Math.min(1, rms * 4);
        } catch (err) {
          logger.debug("recorder.level-read-failed", { error: String(err) });
          return 0;
        }
      },

      stop(): Promise<AudioRecorderStopResult> {
        const durationMs = Date.now() - startedAt;

        if (!recorder || recorder.state === "inactive") {
          release();
          return Promise.resolve({ blob: null, durationMs });
        }

        return new Promise<AudioRecorderStopResult>((resolve) => {
          const active = recorder;
          if (!active) {
            release();
            resolve({ blob: null, durationMs });
            return;
          }

          let settled = false;
          const settle = (blob: Blob | null) => {
            if (settled) return;
            settled = true;
            release();
            resolve({ blob, durationMs });
          };

          active.onstop = () => {
            try {
              settle(chunks.length > 0 ? new Blob(chunks, { type: active.mimeType || "audio/webm" }) : null);
            } catch (err) {
              logger.warn("recorder.blob-assembly-failed", { error: String(err) });
              settle(null);
            }
          };

          // `onstop` not firing would strand the processing screen. Same
          // watchdog reasoning as the speech session's stop timeout.
          const watchdog = setTimeout(() => {
            logger.warn("recorder.stop-timeout", {});
            settle(null);
          }, 2000);

          const clearWatchdogAndSettle = active.onstop;
          active.onstop = (event) => {
            clearTimeout(watchdog);
            clearWatchdogAndSettle?.call(active, event);
          };

          try {
            active.stop();
          } catch (err) {
            logger.warn("recorder.stop-failed", { error: String(err) });
            clearTimeout(watchdog);
            settle(null);
          }
        });
      },

      cancel(): void {
        try {
          if (recorder && recorder.state !== "inactive") {
            recorder.onstop = null;
            recorder.stop();
          }
        } catch (err) {
          logger.debug("recorder.cancel-stop-failed", { error: String(err) });
        }
        chunks.length = 0;
        release();
        logger.info("recorder.cancelled", {});
      },
    },
  };
}
