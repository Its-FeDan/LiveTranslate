"use client";

import {
  AudioLines,
  Captions,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Headphones,
  Languages,
  LockKeyhole,
  Mic,
  MicOff,
  Pencil,
  Radio,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  UserRoundPlus,
  Volume1,
  Volume2,
  Waves,
  Wifi,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDiarization } from "@/hooks/use-diarization";
import { useRealtimeTranslation } from "@/hooks/use-realtime-translation";
import { speakerDisplayName } from "@/lib/transcript";
import type { SpeakerSegment, TranslationStatus } from "@/lib/types";

const STATUS_COPY: Record<TranslationStatus, string> = {
  idle: "Ready",
  requesting_permission: "Microphone permission",
  connecting: "Connecting",
  listening: "Listening",
  delayed: "Signal delayed",
  reconnecting: "Reconnecting",
  stopped: "Stopped",
  error: "Needs attention",
};

export function TranslationApp() {
  const translation = useRealtimeTranslation();
  const [speakerLabelsEnabled, setSpeakerLabelsEnabled] = useState(false);
  const [showSource, setShowSource] = useState(true);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [showSpeakerTools, setShowSpeakerTools] = useState(false);
  const [replying, setReplying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const diarization = useDiarization(
    translation.stream,
    speakerLabelsEnabled && translation.isActive,
  );

  useEffect(() => {
    if (!translation.isActive || translation.metrics.startedAt === null) {
      setElapsedSeconds(0);
      return;
    }
    const tick = () => {
      setElapsedSeconds(
        Math.max(
          0,
          Math.floor((performance.now() - translation.metrics.startedAt!) / 1_000),
        ),
      );
    };
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [translation.isActive, translation.metrics.startedAt]);

  useEffect(() => {
    return () => {
      void wakeLockRef.current?.release();
    };
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const wakeLock = (
        navigator as Navigator & {
          wakeLock?: {
            request: (type: "screen") => Promise<{ release: () => Promise<void> }>;
          };
        }
      ).wakeLock;
      wakeLockRef.current = (await wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const handleStart = useCallback(async () => {
    await requestWakeLock();
    await translation.start();
  }, [requestWakeLock, translation]);

  const handleStop = useCallback(() => {
    translation.stop();
    diarization.reset();
    setReplying(false);
    setShowSpeakerTools(false);
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, [diarization, translation]);

  const beginReply = useCallback(() => {
    if (translation.muted) return;
    setReplying(true);
    translation.setMuted(true);
  }, [translation]);

  const endReply = useCallback(() => {
    if (!replying) return;
    setReplying(false);
    translation.setMuted(false);
  }, [replying, translation]);

  if (!translation.isActive) {
    return (
      <StartView
        speakerLabelsEnabled={speakerLabelsEnabled}
        onSpeakerLabelsChange={setSpeakerLabelsEnabled}
        onStart={handleStart}
        lastError={translation.error?.message ?? null}
      />
    );
  }

  return (
    <main className="app-shell live-shell">
      <LiveHeader status={translation.status} elapsedSeconds={elapsedSeconds} />

      <section className="live-content" aria-live="polite">
        {translation.error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={18} strokeWidth={2} />
            <span>{translation.error.message}</span>
            {translation.error.code === "audio_output_blocked" && (
              <button type="button" onClick={() => void translation.resumeAudio()}>
                Enable audio
              </button>
            )}
            {translation.error.retryable &&
              translation.error.code !== "audio_output_blocked" && (
                <button type="button" onClick={() => void handleStart()}>
                  Retry
                </button>
              )}
          </div>
        )}

        <div className="language-route compact-route" aria-label="Russian to English">
          <span><i className="flag-dot ru-dot" /> Russian</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span><i className="flag-dot en-dot" /> English</span>
        </div>

        <section className="translation-stage">
          <div className="stage-kicker">
            <span>English interpretation</span>
            <SpeechBars active={translation.status === "listening"} />
          </div>

          {captionsVisible ? (
            <p
              className={`translated-caption ${translation.translatedTranscript ? "has-copy" : ""}`}
            >
              {translation.translatedTranscript ||
                (translation.status === "listening"
                  ? "Listening for Russian…"
                  : "Preparing the interpreter…")}
            </p>
          ) : (
            <div className="captions-hidden">
              <Captions size={22} />
              Captions hidden
            </div>
          )}

          {showSource && captionsVisible && (
            <div className="source-caption-wrap">
              <span>RU</span>
              <p>{translation.sourceTranscript || "Исходная речь появится здесь"}</p>
            </div>
          )}
        </section>

        {speakerLabelsEnabled && (
          <SpeakerTimeline
            segments={diarization.segments}
            aliases={diarization.aliases}
            status={diarization.status}
            message={diarization.message}
            onOpenTools={() => setShowSpeakerTools(true)}
          />
        )}

        <div className="session-facts">
          <div>
            <LockKeyhole size={15} />
            <span>No recordings saved by Relay</span>
          </div>
          <div>
            <Wifi size={15} />
            <span>{translation.metrics.reconnectCount ? `${translation.metrics.reconnectCount} reconnects` : "Direct connection"}</span>
          </div>
        </div>
      </section>

      <LiveControls
        muted={translation.muted}
        replying={replying}
        volume={translation.volume}
        captionsVisible={captionsVisible}
        showSource={showSource}
        speakerLabelsEnabled={speakerLabelsEnabled}
        onMutedChange={translation.setMuted}
        onVolumeChange={translation.setVolume}
        onCaptionsChange={setCaptionsVisible}
        onSourceChange={setShowSource}
        onSpeakerLabelsChange={setSpeakerLabelsEnabled}
        onReplyStart={beginReply}
        onReplyEnd={endReply}
        onStop={handleStop}
      />

      {showSpeakerTools && (
        <SpeakerTools
          segments={diarization.segments}
          aliases={diarization.aliases}
          knownSpeakers={diarization.knownSpeakers}
          enrolling={diarization.enrolling}
          message={diarization.message}
          onRename={diarization.renameSpeaker}
          onEnroll={diarization.enrollSpeaker}
          onRemoveKnown={diarization.removeKnownSpeaker}
          onClose={() => setShowSpeakerTools(false)}
        />
      )}
    </main>
  );
}

function StartView({
  speakerLabelsEnabled,
  onSpeakerLabelsChange,
  onStart,
  lastError,
}: {
  speakerLabelsEnabled: boolean;
  onSpeakerLabelsChange: (enabled: boolean) => void;
  onStart: () => Promise<void>;
  lastError: string | null;
}) {
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await onStart();
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="app-shell start-shell">
      <header className="brand-header">
        <Brand />
        <span className="privacy-chip"><ShieldCheck size={14} /> Private by default</span>
      </header>

      <section className="start-hero">
        <div className="eyebrow"><Sparkles size={14} /> One-way live interpretation</div>
        <h1>Russian,<br /><em>understood.</em></h1>
        <p className="hero-copy">
          Hear nearby Russian as natural English while different speakers still sound distinct.
        </p>

        <div className="language-route" aria-label="Russian to English">
          <span><i className="flag-dot ru-dot" /> Русский</span>
          <div className="route-line"><AudioLines size={18} /></div>
          <span><i className="flag-dot en-dot" /> English</span>
        </div>

        <div className="listen-orb" aria-hidden="true">
          <div className="orb-ring ring-one" />
          <div className="orb-ring ring-two" />
          <div className="orb-core"><Mic size={34} strokeWidth={1.7} /></div>
        </div>
      </section>

      <section className="start-actions">
        {lastError && (
          <div className="start-error" role="alert">
            <CircleAlert size={17} />
            {lastError}
          </div>
        )}

        <label className="feature-toggle">
          <span className="feature-icon"><Waves size={20} /></span>
          <span className="feature-copy">
            <strong>Speaker labels <small>Beta</small></strong>
            <span>Identify and rename voices in this session</span>
          </span>
          <input
            type="checkbox"
            checked={speakerLabelsEnabled}
            onChange={(event) => onSpeakerLabelsChange(event.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
        </label>

        {speakerLabelsEnabled && (
          <p className="speaker-consent">
            Speaker labels send short audio windows through our server for analysis. Relay does not store them.
          </p>
        )}

        <button
          type="button"
          className="start-button"
          disabled={starting}
          onClick={() => void start()}
        >
          <span className="start-button-icon"><Mic size={22} /></span>
          <span>{starting ? "Starting…" : "Start listening"}</span>
          <ChevronRight size={22} />
        </button>

        <div className="headphone-note">
          <Headphones size={18} />
          <span><strong>Best with one earbud.</strong> Reply naturally in English.</span>
        </div>
      </section>

      <footer className="start-footer">
        <LockKeyhole size={13} /> Microphone access starts only after you tap
      </footer>
    </main>
  );
}

function LiveHeader({
  status,
  elapsedSeconds,
}: {
  status: TranslationStatus;
  elapsedSeconds: number;
}) {
  const active = status === "listening";
  return (
    <header className="live-header">
      <Brand compact />
      <div className="live-meta">
        <span className={`status-pill status-${status}`}>
          <i className={active ? "status-pulse" : "status-dot"} />
          {STATUS_COPY[status]}
        </span>
        <span className="session-time"><Clock3 size={13} /> {formatDuration(elapsedSeconds)}</span>
      </div>
    </header>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark"><Radio size={18} strokeWidth={2.2} /></span>
      <span>relay</span>
    </div>
  );
}

function SpeechBars({ active }: { active: boolean }) {
  return (
    <span className={`speech-bars ${active ? "is-active" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((bar) => <i key={bar} />)}
    </span>
  );
}

function SpeakerTimeline({
  segments,
  aliases,
  status,
  message,
  onOpenTools,
}: {
  segments: SpeakerSegment[];
  aliases: Record<string, string>;
  status: string;
  message: string | null;
  onOpenTools: () => void;
}) {
  const recent = segments.slice(-4);
  return (
    <section className="speaker-timeline">
      <div className="speaker-timeline-header">
        <div>
          <span className={`analysis-dot analysis-${status}`} />
          <strong>Speaker-aware transcript</strong>
          <small>{status === "analyzing" ? "Analyzing…" : "Labels may update"}</small>
        </div>
        <button type="button" onClick={onOpenTools}>
          Manage <ChevronRight size={15} />
        </button>
      </div>

      {recent.length > 0 ? (
        <div className="speaker-lines">
          {recent.map((segment) => (
            <div className="speaker-line" key={segment.id}>
              <span className={`speaker-avatar tone-${speakerTone(segment.speakerKey)}`}>
                {initials(speakerDisplayName(segment.speakerKey, aliases))}
              </span>
              <div>
                <strong>{speakerDisplayName(segment.speakerKey, aliases)}</strong>
                <p>{segment.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="speaker-empty">
          <Waves size={21} />
          <span>{message ?? "Speaker labels appear after the first short audio window."}</span>
        </div>
      )}
    </section>
  );
}

function LiveControls({
  muted,
  replying,
  volume,
  captionsVisible,
  showSource,
  speakerLabelsEnabled,
  onMutedChange,
  onVolumeChange,
  onCaptionsChange,
  onSourceChange,
  onSpeakerLabelsChange,
  onReplyStart,
  onReplyEnd,
  onStop,
}: {
  muted: boolean;
  replying: boolean;
  volume: number;
  captionsVisible: boolean;
  showSource: boolean;
  speakerLabelsEnabled: boolean;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onCaptionsChange: (visible: boolean) => void;
  onSourceChange: (visible: boolean) => void;
  onSpeakerLabelsChange: (enabled: boolean) => void;
  onReplyStart: () => void;
  onReplyEnd: () => void;
  onStop: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="control-dock">
      {expanded && (
        <div className="control-sheet">
          <div className="volume-row">
            <Volume1 size={18} />
            <input
              aria-label="Translation volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
            />
            <Volume2 size={18} />
          </div>
          <button type="button" onClick={() => onCaptionsChange(!captionsVisible)}>
            <Captions size={18} />
            English captions
            <Check className={captionsVisible ? "is-checked" : "is-unchecked"} size={17} />
          </button>
          <button type="button" onClick={() => onSourceChange(!showSource)}>
            <Languages size={18} />
            Russian source text
            <Check className={showSource ? "is-checked" : "is-unchecked"} size={17} />
          </button>
          <button type="button" onClick={() => onSpeakerLabelsChange(!speakerLabelsEnabled)}>
            <Waves size={18} />
            Speaker labels
            <Check className={speakerLabelsEnabled ? "is-checked" : "is-unchecked"} size={17} />
          </button>
        </div>
      )}

      <div className="dock-main">
        <button
          type="button"
          className={`dock-button ${muted && !replying ? "is-selected" : ""}`}
          onClick={() => onMutedChange(!muted)}
          aria-label={muted ? "Resume microphone" : "Pause microphone"}
        >
          {muted ? <MicOff size={21} /> : <Mic size={21} />}
          <span>{muted && !replying ? "Paused" : "Mic"}</span>
        </button>

        <button
          type="button"
          className={`reply-button ${replying ? "is-replying" : ""}`}
          onPointerDown={onReplyStart}
          onPointerUp={onReplyEnd}
          onPointerCancel={onReplyEnd}
          onPointerLeave={onReplyEnd}
        >
          <span className="reply-icon">{replying ? <MicOff size={22} /> : <Mic size={22} />}</span>
          <span><strong>{replying ? "Replying…" : "Hold to reply"}</strong><small>Pause translation input</small></span>
        </button>

        <button
          type="button"
          className={`dock-button ${expanded ? "is-selected" : ""}`}
          onClick={() => setExpanded((current) => !current)}
          aria-label="Audio and caption controls"
        >
          <Volume2 size={21} />
          <span>Controls</span>
        </button>

        <button type="button" className="stop-button" onClick={onStop} aria-label="Stop translation">
          <Square size={18} fill="currentColor" />
        </button>
      </div>
    </aside>
  );
}

function SpeakerTools({
  segments,
  aliases,
  knownSpeakers,
  enrolling,
  message,
  onRename,
  onEnroll,
  onRemoveKnown,
  onClose,
}: {
  segments: SpeakerSegment[];
  aliases: Record<string, string>;
  knownSpeakers: { id: string; name: string }[];
  enrolling: string | null;
  message: string | null;
  onRename: (speakerKey: string, name: string) => void;
  onEnroll: (name: string) => Promise<unknown>;
  onRemoveKnown: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const speakerKeys = useMemo(
    () =>
      Array.from(
        new Set(
          segments
            .map((segment) => segment.speakerKey)
            .filter((speakerKey) => speakerKey !== "overlap"),
        ),
      ),
    [segments],
  );

  const enroll = async () => {
    setLocalError(null);
    try {
      await onEnroll(name);
      setName("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not enroll this speaker.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="speaker-tools"
        role="dialog"
        aria-modal="true"
        aria-labelledby="speaker-tools-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-handle" />
        <header>
          <div>
            <span className="modal-kicker">Session only</span>
            <h2 id="speaker-tools-title">People in this conversation</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close speaker tools">
            <X size={20} />
          </button>
        </header>

        <div className="speaker-tool-body">
          <div className="detected-speakers">
            <h3>Detected voices</h3>
            {speakerKeys.length ? speakerKeys.map((key) => {
              const displayName = speakerDisplayName(key, aliases);
              return (
                <div className="speaker-edit-row" key={key}>
                  <span className={`speaker-avatar tone-${speakerTone(key)}`}>{initials(displayName)}</span>
                  {editing === key ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        onRename(key, editValue);
                        setEditing(null);
                      }}
                    >
                      <input autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} />
                      <button type="submit" aria-label="Save speaker name"><Check size={17} /></button>
                    </form>
                  ) : (
                    <>
                      <div><strong>{displayName}</strong><span>{key.startsWith("known:") ? "Voice reference matched" : "Provisional label"}</span></div>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          setEditing(key);
                          setEditValue(displayName);
                        }}
                        aria-label={`Rename ${displayName}`}
                      ><Pencil size={16} /></button>
                    </>
                  )}
                </div>
              );
            }) : <p className="empty-copy">Detected voices appear after the first analysis window.</p>}
          </div>

          <div className="enrollment-card">
            <div className="enrollment-title">
              <span><UserRoundPlus size={19} /></span>
              <div><strong>Add a known speaker</strong><small>They speak alone for 4 seconds</small></div>
            </div>
            <div className="enrollment-form">
              <input
                aria-label="Speaker name"
                placeholder="Name, e.g. Alexei"
                maxLength={32}
                value={name}
                disabled={Boolean(enrolling) || knownSpeakers.length >= 4}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="button"
                disabled={!name.trim() || Boolean(enrolling) || knownSpeakers.length >= 4}
                onClick={() => void enroll()}
              >
                {enrolling ? <><span className="recording-dot" /> Recording</> : <><Radio size={16} /> Record</>}
              </button>
            </div>
            {(localError || message) && <p className={localError ? "form-error" : "form-note"}>{localError ?? message}</p>}

            {knownSpeakers.length > 0 && (
              <div className="known-speakers">
                {knownSpeakers.map((speaker) => (
                  <span key={speaker.id}>
                    <Check size={14} /> {speaker.name}
                    <button type="button" onClick={() => onRemoveKnown(speaker.id)} aria-label={`Remove ${speaker.name}`}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="privacy-explainer">
            <ShieldCheck size={16} /> Voice samples and names live only in this browser session and are cleared when you stop.
          </p>
        </div>
      </section>
    </div>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function speakerTone(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 4;
}
