import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
  argbFromHex,
  themeFromSourceColor,
  applyTheme,
  hexFromArgb,
} from "@material/material-color-utilities";

// ── Material Web Components ──────────────────────────────────────────────────
import "@material/web/chips/chip-set.js";
import "@material/web/chips/filter-chip.js";
import "@material/web/switch/switch.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";

// ── TypeScript shims for Material Web ────────────────────────────────────────
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "md-chip-set": any;
      "md-filter-chip": any;
      "md-assist-chip": any;
      "md-filled-button": any;
      "md-outlined-button": any;
    }
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-chip-set": any;
      "md-filter-chip": any;
      "md-assist-chip": any;
      "md-filled-button": any;
      "md-outlined-button": any;
    }
  }
}

// ── Helper: Live Theme Application ───────────────────────────────────────────

function applyLiveTheme(hexColor: string, dark: boolean) {
  let argb: number;
  try {
    argb = argbFromHex(hexColor);
  } catch {
    argb = argbFromHex("#006A6A");
  }
  const theme = themeFromSourceColor(argb);
  applyTheme(theme, { target: document.documentElement, dark });

  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);

  const scheme = dark ? theme.schemes.dark : theme.schemes.light;
  const json = scheme.toJSON();
  for (const [key, value] of Object.entries(json)) {
    const kebab = key.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase();
    document.documentElement.style.setProperty(`--md-sys-color-${kebab}`, hexFromArgb(value as number));
  }

  const surfaceHex = hexFromArgb(scheme.surface);
  const onSurfaceHex = hexFromArgb(scheme.onSurface);
  document.documentElement.style.setProperty(
    "--md-sys-color-surface-container",
    dark
      ? `color-mix(in srgb, ${surfaceHex} 88%, ${onSurfaceHex})`
      : `color-mix(in srgb, ${surfaceHex} 94%, ${onSurfaceHex})`
  );
  document.documentElement.style.setProperty(
    "--md-sys-color-surface-container-low",
    dark
      ? `color-mix(in srgb, ${surfaceHex} 94%, ${onSurfaceHex})`
      : `color-mix(in srgb, ${surfaceHex} 96%, ${onSurfaceHex})`
  );
  document.documentElement.style.setProperty(
    "--md-sys-color-surface-container-high",
    dark
      ? `color-mix(in srgb, ${surfaceHex} 82%, ${onSurfaceHex})`
      : `color-mix(in srgb, ${surfaceHex} 92%, ${onSurfaceHex})`
  );

  document.documentElement.style.setProperty(
    "--ast-bar-inactive",
    "color-mix(in srgb, var(--md-sys-color-on-surface) 15%, transparent)"
  );
  document.documentElement.style.setProperty("--ast-bar-active", hexFromArgb(scheme.primary));
  document.documentElement.style.setProperty("--ast-axis-text", hexFromArgb(scheme.onSurfaceVariant));
}

// ── Controlled M3 Components ─────────────────────────────────────────────────

function M3Switch({
  selected,
  onChange,
  disabled,
}: {
  selected: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.selected = selected;
      if (disabled !== undefined) ref.current.disabled = disabled;
    }
  }, [selected, disabled]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => onChange((e.target as any).selected);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [onChange]);

  return <md-switch ref={ref} />;
}

function M3FilterChip({
  label,
  selected,
  onClick,
  leadingIcon,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  leadingIcon?: string;
}) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.selected = selected;
    }
  }, [selected]);

  return (
    <md-filter-chip
      ref={ref}
      label={label}
      selected={selected}
      onClick={(e: any) => {
        e.preventDefault();
        onClick();
      }}
    >
      {leadingIcon && (
        <span
          slot="icon"
          className="material-symbols-rounded"
          style={{ fontSize: 18, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {leadingIcon}
        </span>
      )}
    </md-filter-chip>
  );
}

// ── OOBE Wizard ──────────────────────────────────────────────────────────────

interface OobeWizardProps {
  initialSettings: Record<string, string>;
  onComplete: (configuredSettings: Record<string, string>) => void;
}

export default function OobeWizard({ initialSettings, onComplete }: OobeWizardProps) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [sysInfo, setSysInfo] = useState<any>(null);

  // Theme preferences (Default is "System")
  const [themeSystem, setThemeSystem] = useState<boolean>(
    initialSettings["theme"] ? initialSettings["theme"] === "System" : true
  );
  const [themeDark, setThemeDark] = useState<boolean>(
    initialSettings["theme"] === "Dark"
  );

  useEffect(() => {
    invoke<any>("get_system_info")
      .then((info) => {
        setSysInfo(info);
      })
      .catch(() => {});
  }, []);

  const handleSystemThemeChange = (isSystem: boolean) => {
    setThemeSystem(isSystem);
    const accent = sysInfo?.accent_color ?? "#006A6A";
    const isDark = isSystem ? (sysInfo?.dark_mode ?? true) : themeDark;
    applyLiveTheme(accent, isDark);
  };

  const handleDarkThemeChange = (isDark: boolean) => {
    setThemeDark(isDark);
    const accent = sysInfo?.accent_color ?? "#006A6A";
    applyLiveTheme(accent, isDark);
  };

  // Tracking preferences
  const [trackFullscreen, setTrackFullscreen] = useState<boolean>(
    initialSettings["track_fullscreen"] !== "0"
  );
  const [trackMedia, setTrackMedia] = useState<boolean>(
    initialSettings["track_media"] !== "0"
  );
  const [idleTimeout, setIdleTimeout] = useState<number>(
    parseInt(initialSettings["idle_timeout"] || "300", 10) || 300
  );
  const [customIdle, setCustomIdle] = useState<boolean>(
    ![60, 180, 300, 600].includes(parseInt(initialSettings["idle_timeout"] || "300", 10))
  );

  // Wellness & Goals
  const [goalEnabled, setGoalEnabled] = useState<boolean>(
    initialSettings["goal_enabled"] !== undefined
      ? initialSettings["goal_enabled"] === "1"
      : true
  );
  const [goalMinutes, setGoalMinutes] = useState<number>(
    parseInt(initialSettings["goal_minutes"] || "480", 10) || 480
  );
  const [customGoal, setCustomGoal] = useState<boolean>(
    ![240, 360, 480, 600].includes(parseInt(initialSettings["goal_minutes"] || "480", 10))
  );

  const [breakEnabled, setBreakEnabled] = useState<boolean>(
    initialSettings["break_enabled"] !== undefined
      ? initialSettings["break_enabled"] === "1"
      : true
  );
  const [breakInterval, setBreakInterval] = useState<number>(
    parseInt(initialSettings["break_interval"] || "60", 10) || 60
  );
  const [customBreak, setCustomBreak] = useState<boolean>(
    ![30, 45, 60, 90].includes(parseInt(initialSettings["break_interval"] || "60", 10))
  );

  // Recommended system settings
  const [autostart, setAutostart] = useState<boolean>(true);
  const [monthlyNotification, setMonthlyNotification] = useState<boolean>(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(
    initialSettings["auto_check_updates"] !== undefined
      ? initialSettings["auto_check_updates"] !== "0"
      : true
  );
  const [minimizeTray, setMinimizeTray] = useState<boolean>(true);

  const totalSteps = 5;

  const goToStep = (newStep: number) => {
    setDirection(newStep > step ? 1 : -1);
    setStep(newStep);
  };

  const handleFinish = () => {
    const finalTheme = themeSystem ? "System" : (themeDark ? "Dark" : "Light");
    const updated: Record<string, string> = {
      ...initialSettings,
      theme: finalTheme,
      theme_mode: finalTheme,
      track_fullscreen: trackFullscreen ? "1" : "0",
      count_fullscreen: trackFullscreen ? "1" : "0",
      track_media: trackMedia ? "1" : "0",
      idle_timeout: String(idleTimeout),
      goal_enabled: goalEnabled ? "1" : "0",
      goal_minutes: String(goalMinutes),
      break_enabled: breakEnabled ? "1" : "0",
      break_interval: String(breakInterval),
      break_minutes: String(breakInterval),
      break_snooze: "10",
      autostart: autostart ? "1" : "0",
      monthly_notification: monthlyNotification ? "1" : "0",
      auto_check_updates: autoCheckUpdates ? "1" : "0",
      minimize_tray: minimizeTray ? "1" : "0",
      ignore_system_ui: "1",
      ignore_lockapp: "1",
      first_run_completed: "1",
    };
    onComplete(updated);
  };

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 40 : -40,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -40 : 40,
      opacity: 0,
    }),
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--md-sys-color-background)",
        color: "var(--md-sys-color-on-background)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Top Header: Progression on top right */}
      <div
        style={{
          padding: "16px 32px 0 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexShrink: 0,
        }}
      >
        {/* Step Indicator Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
            <motion.div
              key={s}
              layout
              transition={{ duration: 0.25, ease: "easeInOut" }}
              style={{
                height: 6,
                borderRadius: 4,
                width: step === s ? 24 : 6,
                background:
                  step === s
                    ? "var(--md-sys-color-primary)"
                    : step > s
                    ? "var(--md-sys-color-primary-container)"
                    : "var(--md-sys-color-outline-variant)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Main Slide Content Area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          position: "relative",
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0 32px 12px 32px",
        }}
      >
        <AnimatePresence mode="wait" custom={direction}>
          {/* ── Slide 1: Welcome ── */}
          {step === 1 && (
            <motion.div
              key="step-1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: "100%",
                maxWidth: 640,
                margin: "auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: 20,
                padding: "0 0 20px 0",
              }}
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 28,
                  background: "var(--md-sys-color-primary-container)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
                }}
              >
                <img src="/logo.ico" alt="" style={{ width: 52, height: 52 }} />
              </motion.div>

              <div>
                <h1
                  className="md-typescale-display-small"
                  style={{
                    color: "var(--md-sys-color-on-surface)",
                    fontWeight: 700,
                    margin: "0 0 8px 0",
                  }}
                >
                  Welcome to Active Screen Time
                </h1>
                <p
                  className="md-typescale-body-large"
                  style={{
                    color: "var(--md-sys-color-on-surface-variant)",
                    margin: 0,
                    maxWidth: 520,
                    lineHeight: 1.5,
                  }}
                >
                  Your native, private, and lightweight productivity tracker. Let's personalize
                  your experience in just a few quick moments.
                </p>
              </div>

              {/* Feature Highlights Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 12,
                  width: "100%",
                  marginTop: 8,
                }}
              >
                {[
                  {
                    icon: "lock",
                    title: "100% Private",
                    desc: "Offline SQLite, never leaves your machine",
                  },
                  {
                    icon: "memory",
                    title: "Ultra Lightweight",
                    desc: "~8 MB background RAM footprint",
                  },
                  {
                    icon: "tune",
                    title: "Smart Tracking",
                    desc: "Media & fullscreen activity detection",
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--md-sys-color-surface-container)",
                      border: "1px solid var(--md-sys-color-outline-variant)",
                      borderRadius: 16,
                      padding: "16px 14px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      className="material-symbols-rounded"
                      style={{
                        fontSize: 24,
                        color: "var(--md-sys-color-primary)",
                      }}
                    >
                      {item.icon}
                    </span>
                    <span
                      className="md-typescale-title-small"
                      style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}
                    >
                      {item.title}
                    </span>
                    <span
                      className="md-typescale-body-small"
                      style={{ color: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                    >
                      {item.desc}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Slide 2: Preferences (Theme & Tracking) ── */}
          {step === 2 && (
            <motion.div
              key="step-2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: "100%",
                maxWidth: 640,
                margin: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: "0 0 16px 0",
              }}
            >
              <div>
                <h2
                  className="md-typescale-headline-medium"
                  style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 700, margin: "0 0 6px 0" }}
                >
                  Personal Preferences
                </h2>
                <p className="md-typescale-body-medium" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: 0 }}>
                  Customize your appearance and how the app detects your active time.
                </p>
              </div>

              {/* Theme Preference with M3 Switch (Default: System) */}
              <div
                style={{
                  background: "var(--md-sys-color-surface-container)",
                  borderRadius: 20,
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        palette
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        System Theme
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 8,
                          background: "var(--md-sys-color-primary-container)",
                          color: "var(--md-sys-color-on-primary-container)",
                        }}
                      >
                        Default
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Automatically match Windows system appearance (Light or Dark).
                    </p>
                  </div>
                  <M3Switch
                    selected={themeSystem}
                    onChange={handleSystemThemeChange}
                  />
                </div>

                <AnimatePresence>
                  {!themeSystem && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "14px 20px",
                          gap: 16,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <span className="md-typescale-title-small" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                            Dark Appearance
                          </span>
                          <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "2px 0 0 0" }}>
                            Turn on to use dark mode regardless of system setting.
                          </p>
                        </div>
                        <M3Switch
                          selected={themeDark}
                          onChange={handleDarkThemeChange}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Activity Tracking Options */}
              <div
                style={{
                  background: "var(--md-sys-color-surface-container)",
                  borderRadius: 20,
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  overflow: "hidden",
                }}
              >
                {/* Fullscreen tracking */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        fullscreen
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Count on Fullscreen
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Keep tracking active while gaming, watching fullscreen media, or running presentations.
                    </p>
                  </div>
                  <M3Switch
                    selected={trackFullscreen}
                    onChange={(val) => setTrackFullscreen(val)}
                  />
                </div>

                <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />

                {/* Foreground Media Playback */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        play_circle
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Foreground Media Playback
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Remain active past idle timeout when a focused browser or player is actively playing audio/video.
                    </p>
                  </div>
                  <M3Switch
                    selected={trackMedia}
                    onChange={(val) => setTrackMedia(val)}
                  />
                </div>

                <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />

                {/* Idle Timeout with Material 3 Chips & Animated Custom Field */}
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                      hourglass_empty
                    </span>
                    <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                      Mark Inactive as Idle After
                    </span>
                  </div>
                  <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "0 0 12px 0" }}>
                    Pauses tracking automatically when you step away from the keyboard and mouse.
                  </p>

                  <md-chip-set>
                    <M3FilterChip
                      label="1 min"
                      selected={!customIdle && idleTimeout === 60}
                      onClick={() => {
                        setIdleTimeout(60);
                        setCustomIdle(false);
                      }}
                    />
                    <M3FilterChip
                      label="3 mins"
                      selected={!customIdle && idleTimeout === 180}
                      onClick={() => {
                        setIdleTimeout(180);
                        setCustomIdle(false);
                      }}
                    />
                    <M3FilterChip
                      label="5 mins (Default)"
                      selected={!customIdle && idleTimeout === 300}
                      onClick={() => {
                        setIdleTimeout(300);
                        setCustomIdle(false);
                      }}
                    />
                    <M3FilterChip
                      label="10 mins"
                      selected={!customIdle && idleTimeout === 600}
                      onClick={() => {
                        setIdleTimeout(600);
                        setCustomIdle(false);
                      }}
                    />
                    <M3FilterChip
                      label="Custom"
                      selected={customIdle}
                      leadingIcon="edit"
                      onClick={() => setCustomIdle(true)}
                    />
                  </md-chip-set>

                  {/* Smooth slide animation for custom textfield */}
                  <AnimatePresence>
                    {customIdle && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -4 }}
                        animate={{ opacity: 1, height: "auto", y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        style={{ overflow: "hidden", paddingTop: 10, paddingBottom: 4, marginTop: 8 }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <md-outlined-text-field
                            label="Timeout"
                            type="number"
                            value={String(idleTimeout)}
                            onInput={(e: any) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val) && val > 0) setIdleTimeout(val);
                            }}
                            style={{ width: 140 }}
                          />
                          <span
                            className="md-typescale-body-medium"
                            style={{ color: "var(--md-sys-color-on-surface-variant)", fontWeight: 500 }}
                          >
                            secs
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Slide 3: Wellness & Goals ── */}
          {step === 3 && (
            <motion.div
              key="step-3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: "100%",
                maxWidth: 640,
                margin: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: "0 0 16px 0",
              }}
            >
              <div>
                <h2
                  className="md-typescale-headline-medium"
                  style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 700, margin: "0 0 6px 0" }}
                >
                  Wellness & Goals
                </h2>
                <p className="md-typescale-body-medium" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: 0 }}>
                  Build healthy computer habits with daily limits and restorative break reminders.
                </p>
              </div>

              <div
                style={{
                  background: "var(--md-sys-color-surface-container)",
                  borderRadius: 20,
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  overflow: "hidden",
                }}
              >
                {/* Daily Goal */}
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        flag
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Daily Screen Time Goal
                      </span>
                    </div>
                    <M3Switch
                      selected={goalEnabled}
                      onChange={(val) => setGoalEnabled(val)}
                    />
                  </div>
                  <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "0 0 12px 0" }}>
                    Get a gentle reminder when total screen time reaches your chosen daily limit.
                  </p>

                  <AnimatePresence>
                    {goalEnabled && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                      >
                        <md-chip-set>
                          <M3FilterChip
                            label="4 hours"
                            selected={!customGoal && goalMinutes === 240}
                            onClick={() => {
                              setGoalMinutes(240);
                              setCustomGoal(false);
                            }}
                          />
                          <M3FilterChip
                            label="6 hours"
                            selected={!customGoal && goalMinutes === 360}
                            onClick={() => {
                              setGoalMinutes(360);
                              setCustomGoal(false);
                            }}
                          />
                          <M3FilterChip
                            label="8 hours (Default)"
                            selected={!customGoal && goalMinutes === 480}
                            onClick={() => {
                              setGoalMinutes(480);
                              setCustomGoal(false);
                            }}
                          />
                          <M3FilterChip
                            label="10 hours"
                            selected={!customGoal && goalMinutes === 600}
                            onClick={() => {
                              setGoalMinutes(600);
                              setCustomGoal(false);
                            }}
                          />
                          <M3FilterChip
                            label="Custom"
                            selected={customGoal}
                            leadingIcon="edit"
                            onClick={() => setCustomGoal(true)}
                          />
                        </md-chip-set>

                        {/* Slide animation for custom goal minutes */}
                        <AnimatePresence>
                          {customGoal && (
                            <motion.div
                              initial={{ opacity: 0, height: 0, y: -4 }}
                              animate={{ opacity: 1, height: "auto", y: 0 }}
                              exit={{ opacity: 0, height: 0, y: -4 }}
                              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                              style={{ overflow: "hidden", paddingTop: 10, paddingBottom: 4, marginTop: 8 }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <md-outlined-text-field
                                  label="Goal"
                                  type="number"
                                  value={String(goalMinutes)}
                                  onInput={(e: any) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val > 0) setGoalMinutes(val);
                                  }}
                                  style={{ width: 140 }}
                                />
                                <span
                                  className="md-typescale-body-medium"
                                  style={{ color: "var(--md-sys-color-on-surface-variant)", fontWeight: 500 }}
                                >
                                  mins
                                </span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />

                {/* Break Reminders */}
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        coffee
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Healthy Break Reminders
                      </span>
                    </div>
                    <M3Switch
                      selected={breakEnabled}
                      onChange={(val) => setBreakEnabled(val)}
                    />
                  </div>
                  <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "0 0 12px 0" }}>
                    Prompts you to stretch and rest your eyes after continuous screen activity.
                  </p>

                  <AnimatePresence>
                    {breakEnabled && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                      >
                        <md-chip-set>
                          <M3FilterChip
                            label="Every 30 min"
                            selected={!customBreak && breakInterval === 30}
                            onClick={() => {
                              setBreakInterval(30);
                              setCustomBreak(false);
                            }}
                          />
                          <M3FilterChip
                            label="Every 45 min"
                            selected={!customBreak && breakInterval === 45}
                            onClick={() => {
                              setBreakInterval(45);
                              setCustomBreak(false);
                            }}
                          />
                          <M3FilterChip
                            label="Every 60 min (Default)"
                            selected={!customBreak && breakInterval === 60}
                            onClick={() => {
                              setBreakInterval(60);
                              setCustomBreak(false);
                            }}
                          />
                          <M3FilterChip
                            label="Every 90 min"
                            selected={!customBreak && breakInterval === 90}
                            onClick={() => {
                              setBreakInterval(90);
                              setCustomBreak(false);
                            }}
                          />
                          <M3FilterChip
                            label="Custom"
                            selected={customBreak}
                            leadingIcon="edit"
                            onClick={() => setCustomBreak(true)}
                          />
                        </md-chip-set>

                        {/* Slide animation for custom break minutes */}
                        <AnimatePresence>
                          {customBreak && (
                            <motion.div
                              initial={{ opacity: 0, height: 0, y: -4 }}
                              animate={{ opacity: 1, height: "auto", y: 0 }}
                              exit={{ opacity: 0, height: 0, y: -4 }}
                              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                              style={{ overflow: "hidden", paddingTop: 10, paddingBottom: 4, marginTop: 8 }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <md-outlined-text-field
                                  label="Interval"
                                  type="number"
                                  value={String(breakInterval)}
                                  onInput={(e: any) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val > 0) setBreakInterval(val);
                                  }}
                                  style={{ width: 140 }}
                                />
                                <span
                                  className="md-typescale-body-medium"
                                  style={{ color: "var(--md-sys-color-on-surface-variant)", fontWeight: 500 }}
                                >
                                  mins
                                </span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Slide 4: Recommended System Settings ── */}
          {step === 4 && (
            <motion.div
              key="step-4"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: "100%",
                maxWidth: 640,
                margin: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: "0 0 16px 0",
              }}
            >
              <div>
                <h2
                  className="md-typescale-headline-medium"
                  style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 700, margin: "0 0 6px 0" }}
                >
                  Recommended Settings
                </h2>
                <p className="md-typescale-body-medium" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: 0 }}>
                  Pre-configured for a smooth experience out of the box. You can modify them anytime in Settings.
                </p>
              </div>

              <div
                style={{
                  background: "var(--md-sys-color-surface-container)",
                  borderRadius: 20,
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  overflow: "hidden",
                }}
              >
                {/* Autostart */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        rocket_launch
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Start App Automatically
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 8,
                          background: "var(--md-sys-color-primary-container)",
                          color: "var(--md-sys-color-on-primary-container)",
                        }}
                      >
                        Recommended
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Starts quietly minimized in the tray on Windows login so no screen time is lost.
                    </p>
                  </div>
                  <M3Switch
                    selected={autostart}
                    onChange={(val) => setAutostart(val)}
                  />
                </div>

                <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />

                {/* Monthly Notification */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        notifications
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Monthly Summary Notification
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 8,
                          background: "var(--md-sys-color-primary-container)",
                          color: "var(--md-sys-color-on-primary-container)",
                        }}
                      >
                        Recommended
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Receive an unobtrusive monthly summary toast showing your productivity overview.
                    </p>
                  </div>
                  <M3Switch
                    selected={monthlyNotification}
                    onChange={(val) => setMonthlyNotification(val)}
                  />
                </div>

                <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />

                {/* Minimize to Tray */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        arrow_downward
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Minimize to System Tray
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 8,
                          background: "var(--md-sys-color-primary-container)",
                          color: "var(--md-sys-color-on-primary-container)",
                        }}
                      >
                        Recommended
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Closing the dashboard keeps background tracking alive in the tray.
                    </p>
                  </div>
                  <M3Switch
                    selected={minimizeTray}
                    onChange={(val) => setMinimizeTray(val)}
                  />
                </div>

                <div style={{ height: 1, background: "var(--md-sys-color-outline-variant)", margin: "0 20px" }} />

                {/* Automatic Updates */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--md-sys-color-primary)" }}>
                        system_update
                      </span>
                      <span className="md-typescale-title-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                        Automatic Updates
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 8,
                          background: "var(--md-sys-color-primary-container)",
                          color: "var(--md-sys-color-on-primary-container)",
                        }}
                      >
                        Recommended
                      </span>
                    </div>
                    <p className="md-typescale-body-small" style={{ color: "var(--md-sys-color-on-surface-variant)", margin: "4px 0 0 0" }}>
                      Automatically check GitHub for new versions on startup. Can be disabled for 100% offline privacy.
                    </p>
                  </div>
                  <M3Switch
                    selected={autoCheckUpdates}
                    onChange={(val) => setAutoCheckUpdates(val)}
                  />
                </div>
              </div>

              {/* Advanced Defaults Card (Informed & Protected) */}
              <div
                style={{
                  background: "var(--md-sys-color-surface-container-low)",
                  border: "1px dashed var(--md-sys-color-outline-variant)",
                  borderRadius: 16,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="md-typescale-label-medium" style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600 }}>
                    Pre-configured System Protections
                  </span>
                  <span style={{ fontSize: 11, color: "var(--md-sys-color-primary)", fontWeight: 600 }}>
                    Active
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, color: "var(--md-sys-color-on-surface-variant)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--md-sys-color-primary)" }}>
                      check_circle
                    </span>
                    Ignore System UI & Shell
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--md-sys-color-primary)" }}>
                      check_circle
                    </span>
                    Ignore Windows Lock Screen
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--md-sys-color-primary)" }}>
                      check_circle
                    </span>
                    Friendly App Names (PE Info)
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--md-sys-color-primary)" }}>
                      check_circle
                    </span>
                    Dynamic RAM Inactivity Reaper
                  </div>
                </div>
                <p style={{ margin: "4px 0 0 0", fontSize: 11, color: "var(--md-sys-color-outline)" }}>
                  Advanced options like Regex Exclusions and Custom JS Context Rules can be tuned anytime in Settings.
                </p>
              </div>
            </motion.div>
          )}

          {/* ── Slide 5: Ready to Go ── */}
          {step === 5 && (
            <motion.div
              key="step-5"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: "100%",
                maxWidth: 600,
                margin: "auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: 20,
                padding: "0 0 20px 0",
              }}
            >
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 24,
                  background: "var(--md-sys-color-primary-container)",
                  color: "var(--md-sys-color-on-primary-container)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 44 }}>
                  check_circle
                </span>
              </motion.div>

              <div>
                <h1
                  className="md-typescale-headline-large"
                  style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 700, margin: "0 0 8px 0" }}
                >
                  You're All Set!
                </h1>
                <p
                  className="md-typescale-body-large"
                  style={{ color: "var(--md-sys-color-on-surface-variant)", margin: 0, maxWidth: 480 }}
                >
                  Active Screen Time is now calibrated to your workflow.
                </p>
              </div>

              {/* Summary Recap Card */}
              <div
                style={{
                  width: "100%",
                  background: "var(--md-sys-color-surface-container)",
                  borderRadius: 18,
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  padding: "16px 20px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  textAlign: "left",
                }}
              >
                <div>
                  <span className="md-typescale-label-small" style={{ color: "var(--md-sys-color-outline)" }}>
                    THEME
                  </span>
                  <p className="md-typescale-body-medium" style={{ margin: "2px 0 0 0", color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                    {themeSystem ? "System (Auto)" : themeDark ? "Dark Appearance" : "Light Appearance"}
                  </p>
                </div>
                <div>
                  <span className="md-typescale-label-small" style={{ color: "var(--md-sys-color-outline)" }}>
                    INACTIVITY TIMEOUT
                  </span>
                  <p className="md-typescale-body-medium" style={{ margin: "2px 0 0 0", color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                    {idleTimeout >= 60 ? `${Math.round(idleTimeout / 60)} minutes` : `${idleTimeout} seconds`}
                  </p>
                </div>
                <div>
                  <span className="md-typescale-label-small" style={{ color: "var(--md-sys-color-outline)" }}>
                    FULLSCREEN & MEDIA
                  </span>
                  <p className="md-typescale-body-medium" style={{ margin: "2px 0 0 0", color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                    {trackFullscreen ? "Fullscreen On" : "Off"} • {trackMedia ? "Media On" : "Off"}
                  </p>
                </div>
                <div>
                  <span className="md-typescale-label-small" style={{ color: "var(--md-sys-color-outline)" }}>
                    DAILY GOAL
                  </span>
                  <p className="md-typescale-body-medium" style={{ margin: "2px 0 0 0", color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                    {goalEnabled ? `${(goalMinutes / 60).toFixed(1)} hours` : "Disabled"}
                  </p>
                </div>
                <div>
                  <span className="md-typescale-label-small" style={{ color: "var(--md-sys-color-outline)" }}>
                    BREAK REMINDER
                  </span>
                  <p className="md-typescale-body-medium" style={{ margin: "2px 0 0 0", color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                    {breakEnabled ? `Every ${breakInterval} mins` : "Disabled"}
                  </p>
                </div>
                <div>
                  <span className="md-typescale-label-small" style={{ color: "var(--md-sys-color-outline)" }}>
                    WINDOWS AUTOSTART
                  </span>
                  <p className="md-typescale-body-medium" style={{ margin: "2px 0 0 0", color: "var(--md-sys-color-on-surface)", fontWeight: 500 }}>
                    {autostart ? "Enabled (Tray)" : "Manual"}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Navigation with Material 3 Button Components */}
      <div
        style={{
          padding: "16px 32px 24px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid var(--md-sys-color-outline-variant)",
          background: "var(--md-sys-color-surface-container-low)",
          flexShrink: 0,
          minHeight: 72,
        }}
      >
        <div>
          {step > 1 ? (
            <md-outlined-button onClick={() => goToStep(step - 1)}>
              <svg
                slot="icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ display: "block", width: 18, height: 18 }}
              >
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
              Back
            </md-outlined-button>
          ) : (
            <div style={{ width: 1 }} />
          )}
        </div>

        <div>
          {step < totalSteps ? (
            <md-filled-button trailing-icon onClick={() => goToStep(step + 1)}>
              {step === 1 ? "Get Started" : "Continue"}
              <svg
                slot="icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ display: "block", width: 18, height: 18 }}
              >
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
              </svg>
            </md-filled-button>
          ) : (
            <md-filled-button onClick={handleFinish}>
              <svg
                slot="icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ display: "block", width: 18, height: 18 }}
              >
                <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
              </svg>
              Launch Dashboard
            </md-filled-button>
          )}
        </div>
      </div>
    </div>
  );
}
