import { useEffect, useRef, useState, useCallback, createElement } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { listen } from "@tauri-apps/api/event";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import NumberFlow, { NumberFlowGroup, continuous } from "@number-flow/react";
import { motion, AnimatePresence } from "framer-motion";
import OobeWizard from "./OobeWizard";

// ── Material Web components (registers custom elements) ─────────────────────
import "@material/web/checkbox/checkbox.js";
import "@material/web/switch/switch.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/ripple/ripple.js";
import "@material/web/dialog/dialog.js";
import "@material/web/button/text-button.js";
import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";

// ── Material Color Utilities ─────────────────────────────────────────────────
import {
  argbFromHex,
  themeFromSourceColor,
  applyTheme,
  hexFromArgb,
} from "@material/material-color-utilities";

// ── TypeScript shims ─────────────────────────────────────────────────────────
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "md-checkbox": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          checked?: boolean;
          onInput?: (e: Event) => void;
          onChange?: (e: Event) => void;
          ref?: any;
        },
        HTMLElement
      >;
      "md-switch": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          checked?: boolean;
          onInput?: (e: Event) => void;
          onChange?: (e: Event) => void;
          ref?: any;
        },
        HTMLElement
      >;
      "md-ripple": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "md-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          positioning?: string;
          id?: string;
          anchor?: string;
        },
        HTMLElement
      >;
      "md-menu-item": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { onClick?: (e: Event) => void },
        HTMLElement
      >;
      "md-outlined-text-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          label?: string;
          value?: string;
          onInput?: (e: Event) => void;
          type?: string;
          readOnly?: boolean;
          placeholder?: string;
          rows?: number;
        },
        HTMLElement
      >;
      "md-dialog": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: string;
          open?: boolean;
          onClosed?: (e: Event) => void;
          ref?: any;
        },
        HTMLElement
      >;
      "md-text-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          onClick?: (e: Event) => void;
          disabled?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-checkbox": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          checked?: boolean;
          onInput?: (e: Event) => void;
          onChange?: (e: Event) => void;
          ref?: any;
        },
        HTMLElement
      >;
      "md-switch": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          checked?: boolean;
          onInput?: (e: Event) => void;
          onChange?: (e: Event) => void;
          ref?: any;
        },
        HTMLElement
      >;
      "md-ripple": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "md-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          positioning?: string;
          id?: string;
          anchor?: string;
        },
        HTMLElement
      >;
      "md-menu-item": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { onClick?: (e: Event) => void },
        HTMLElement
      >;
      "md-outlined-text-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          label?: string;
          value?: string;
          onInput?: (e: Event) => void;
          type?: string;
          readOnly?: boolean;
          placeholder?: string;
          rows?: number;
        },
        HTMLElement
      >;
      "md-dialog": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: string;
          open?: boolean;
          onClosed?: (e: Event) => void;
          ref?: any;
        },
        HTMLElement
      >;
      "md-text-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          onClick?: (e: Event) => void;
          disabled?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatSecs(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatDateStr(dateStr: string, format: string): string {
  // If we couldn't parse or it's empty
  if (!dateStr) return dateStr;

  // Create a proper local date at noon so timezone doesn't shift it backwards
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const d = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    12,
    0,
    0,
  );

  const map: Record<string, string> = {
    "%a": d.toLocaleDateString("en-US", { weekday: "short" }),
    "%A": d.toLocaleDateString("en-US", { weekday: "long" }),
    "%d": String(d.getDate()).padStart(2, "0"),
    "%b": d.toLocaleDateString("en-US", { month: "short" }),
    "%B": d.toLocaleDateString("en-US", { month: "long" }),
    "%m": String(d.getMonth() + 1).padStart(2, "0"),
    "%y": String(d.getFullYear()).slice(-2),
    "%Y": String(d.getFullYear()),
  };
  return format.replace(/%[aAdbBmyY]/g, (m) => map[m] ?? m);
}

function InfoTooltip({
  content,
  width = 320,
}: {
  content: React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  }>({ left: 0 });

  const updatePosition = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 32);
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(16, Math.min(window.innerWidth - w - 16, left));

    if (rect.top < 230) {
      // Not enough space above, position below the icon
      setCoords({ top: rect.bottom + 8, left });
    } else {
      // Position above the icon
      setCoords({ bottom: window.innerHeight - rect.top + 8, left });
    }
  }, [width]);

  const handleMouseEnter = () => {
    updatePosition();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    setOpen(false);
  };

  return (
    <span
      ref={iconRef}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => {
        e.stopPropagation();
        updatePosition();
        setOpen(!open);
      }}
    >
      <span
        className="material-symbols-rounded"
        style={{
          fontSize: 18,
          cursor: "help",
          color: open
            ? "var(--md-sys-color-primary)"
            : "var(--md-sys-color-on-surface-variant)",
          opacity: open ? 1 : 0.75,
          userSelect: "none",
          transform: open ? "scale(1.2)" : "scale(1)",
          transition:
            "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease, opacity 0.2s ease",
          display: "inline-block",
        }}
      >
        info
      </span>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{
                opacity: 0,
                scale: 0.9,
                y: coords.top !== undefined ? -6 : 6,
              }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{
                opacity: 0,
                scale: 0.92,
                y: coords.top !== undefined ? -4 : 4,
              }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: "fixed",
                top: coords.top,
                bottom: coords.bottom,
                left: coords.left,
                zIndex: 999999,
                width: Math.min(width, window.innerWidth - 32),
                padding: "10px 14px",
                borderRadius: 12,
                background: "var(--md-sys-color-inverse-surface, #313033)",
                color: "var(--md-sys-color-inverse-on-surface, #f4eff4)",
                fontSize: 12,
                lineHeight: 1.5,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                pointerEvents: "none",
                textAlign: "left",
                transformOrigin:
                  coords.top !== undefined ? "top center" : "bottom center",
              }}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}

const DateFormatInfo = (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}
  >
    <div
      style={{
        fontWeight: 600,
        borderBottom: "1px solid rgba(255,255,255,0.2)",
        paddingBottom: 4,
      }}
    >
      Date Format Specifiers:
    </div>
    <div>
      <code>%a</code> – Short weekday name (e.g. <b>Mon</b>)
    </div>
    <div>
      <code>%A</code> – Full weekday name (e.g. <b>Monday</b>)
    </div>
    <div>
      <code>%d</code> – Day of month (e.g. <b>05</b>)
    </div>
    <div>
      <code>%b</code> – Short month name (e.g. <b>Jul</b>)
    </div>
    <div>
      <code>%B</code> – Full month name (e.g. <b>July</b>)
    </div>
    <div>
      <code>%m</code> – Month number (e.g. <b>07</b>)
    </div>
    <div>
      <code>%y</code> – 2-digit year (e.g. <b>26</b>)
    </div>
    <div>
      <code>%Y</code> – 4-digit year (e.g. <b>2026</b>)
    </div>
    <div style={{ opacity: 0.8, marginTop: 4 }}>
      Example: <code>%a, %d %b</code> &rarr; <i>Mon, 05 Jul</i>
    </div>
  </div>
);

const RegexInfo = (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}
  >
    <div
      style={{
        fontWeight: 600,
        borderBottom: "1px solid rgba(255,255,255,0.2)",
        paddingBottom: 4,
      }}
    >
      Regex Pattern Instructions:
    </div>
    <div>
      Matches against app process name, window title, or executable path.
    </div>
    <div>
      Add <code>(?i)</code> for case-insensitive matching.
    </div>
    <div style={{ marginTop: 4, fontWeight: 600 }}>Common Examples:</div>
    <div>
      <code>(?i)code\.exe|devenv\.exe</code> – Exclude VS Code & Visual Studio
    </div>
    <div>
      <code>(?i)^python</code> – Exclude any app starting with python
    </div>
    <div>
      <code>(?i)youtube|netflix</code> – Exclude browser tabs matching video
      sites
    </div>
    <div>
      <code>(?i)slack|discord|teams</code> – Exclude communication apps
    </div>
  </div>
);

const JsRuleInfo = (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}
  >
    <div
      style={{
        fontWeight: 600,
        borderBottom: "1px solid rgba(255,255,255,0.2)",
        paddingBottom: 4,
      }}
    >
      Custom JS Rule Context (<code>ctx</code>):
    </div>
    <div>
      <code>ctx.process_name</code> / <code>ctx.app_name</code> – App name (e.g.{" "}
      <i>Task Manager</i>)
    </div>
    <div>
      <code>ctx.exe_name</code> – Executable filename (e.g. <i>Taskmgr.exe</i>)
    </div>
    <div>
      <code>ctx.exe_path</code> – Full path to executable
    </div>
    <div>
      <code>ctx.window_title</code> / <code>ctx.title</code> – Active window
      title
    </div>
    <div>
      <code>ctx.idle_seconds</code> – Seconds of user inactivity
    </div>
    <div>
      <code>ctx.is_fullscreen</code> – True if running in true fullscreen
    </div>
    <div>
      <code>ctx.media_playing</code> – True if foreground app is playing media
    </div>
    <div
      style={{
        marginTop: 4,
        borderTop: "1px solid rgba(255,255,255,0.2)",
        paddingTop: 4,
      }}
    >
      Return <code>false</code> to stop tracking (idle), or <code>true</code> to
      track. Bare expressions like{" "}
      <code>ctx.exe_name.toLowerCase() !== 'taskmgr.exe'</code> are also
      supported.
    </div>
  </div>
);

interface SystemInfo {
  accent_color: string; // hex "#RRGGBB"
  dark_mode: boolean;
}

/** Generates and applies the full MD3 color scheme from a hex seed color */
function applyMaterialTheme(hexColor: string, dark: boolean) {
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

  // Manually inject all generated tokens to ensure new tokens (like surfaceContainer) are correctly populated.
  // applyTheme from the utility library doesn't always map the newer MD3.2 tokens automatically.
  const scheme = dark ? theme.schemes.dark : theme.schemes.light;
  const json = scheme.toJSON();
  for (const [key, value] of Object.entries(json)) {
    const kebab = key
      .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2")
      .toLowerCase();
    document.documentElement.style.setProperty(
      `--md-sys-color-${kebab}`,
      hexFromArgb(value as number),
    );
  }

  const surfaceHex = hexFromArgb(scheme.surface);
  const onSurfaceHex = hexFromArgb(scheme.onSurface);
  document.documentElement.style.setProperty(
    "--md-sys-color-surface-container",
    dark
      ? `color-mix(in srgb, ${surfaceHex} 88%, ${onSurfaceHex})`
      : `color-mix(in srgb, ${surfaceHex} 94%, ${onSurfaceHex})`,
  );
  document.documentElement.style.setProperty(
    "--md-sys-color-surface-container-low",
    dark
      ? `color-mix(in srgb, ${surfaceHex} 94%, ${onSurfaceHex})`
      : `color-mix(in srgb, ${surfaceHex} 96%, ${onSurfaceHex})`,
  );
  document.documentElement.style.setProperty(
    "--md-sys-color-surface-container-high",
    dark
      ? `color-mix(in srgb, ${surfaceHex} 82%, ${onSurfaceHex})`
      : `color-mix(in srgb, ${surfaceHex} 92%, ${onSurfaceHex})`,
  );

  // Also set AST custom tokens from the generated scheme
  document.documentElement.style.setProperty(
    "--ast-bar-inactive",
    "color-mix(in srgb, var(--md-sys-color-on-surface) 15%, transparent)",
  );
  document.documentElement.style.setProperty(
    "--ast-bar-active",
    hexFromArgb(scheme.primary),
  );
  document.documentElement.style.setProperty(
    "--ast-axis-text",
    hexFromArgb(scheme.onSurfaceVariant),
  );
}

interface MonthlyReportData {
  month_name: string;
  hours: number;
  mins: number;
  total_secs: number;
  active_days: number;
  avg_hours: number;
  avg_mins: number;
  most_active_day: string;
  top_apps?: {
    name: string;
    secs: number;
    time_str: string;
    pct: number;
  }[];
}

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  release_name: string;
  changelog: string;
  release_url: string;
  asset_name: string | null;
  asset_url: string | null;
  asset_size: number | null;
}

interface DownloadProgress {
  percent: number;
  downloaded: number;
  total: number;
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const win = getCurrentWindow();
  const dialogRef = useRef<any>(null);
  const monthlyDialogRef = useRef<any>(null);
  const updateDialogRef = useRef<any>(null);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportData | null>(
    null,
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState(0);
  const [todayUsage, setTodayUsage] = useState(0);
  const [appUsage, setAppUsage] = useState<[string, string, number][]>([]);
  const [history, setHistory] = useState<
    { name: string; dateStr: string; secs: number }[]
  >([]);
  const [trackerStatus, setTrackerStatus] = useState("idle");
  const [currentApp, setCurrentApp] = useState("");
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [chartEndDateStr, setChartEndDateStr] = useState<string>(
    formatLocalDate(),
  );
  const [appVersion, setAppVersion] = useState("0.1.1");
  const lastKnownDayRef = useRef<string>(formatLocalDate());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        datePickerOpen &&
        dateWrapperRef.current &&
        !dateWrapperRef.current.contains(e.target as Node)
      ) {
        setDatePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [datePickerOpen]);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [hoverData, setHoverData] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const [appIcons, setAppIcons] = useState<Record<string, string>>({});
  const loadedIcons = useRef<Set<string>>(new Set());

  // Settings / theme
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [themeMode, setThemeMode] = useState<"System" | "Light" | "Dark">(
    "System",
  );
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [excludeRegex, setExcludeRegex] = useState("");
  const [sysUiExpanded, setSysUiExpanded] = useState(false);
  const [showOobe, setShowOobe] = useState(false);

  // Compute active bar color from CSS var (set by applyTheme)
  const activeBarColor = sysInfo?.accent_color ?? "#006A6A";

  // ── Apply theme whenever themeMode or sysInfo changes ───────────────────
  useEffect(() => {
    if (!sysInfo) return;
    const dark =
      themeMode === "Dark" || (themeMode === "System" && sysInfo.dark_mode);
    applyMaterialTheme(sysInfo.accent_color, dark);
  }, [themeMode, sysInfo]);

  // ── Load usage data ───────────────────────────────────────────────────────
  const loadUsage = useCallback(async () => {
    const total = await invoke<number>("get_today_usage");
    setTodayUsage(total);

    const todayStr = formatLocalDate();
    const fetchDate = selectedDate || todayStr;
    const apps = await invoke<[string, string, number][]>(
      "get_app_usage_by_date",
      { date: fetchDate },
    );
    const filtered = apps.filter((a) => a[2] >= 60).sort((a, b) => b[2] - a[2]);
    setAppUsage(filtered);

    // Lazy-load icons for new exe paths only
    for (const [, exe] of filtered) {
      if (!loadedIcons.current.has(exe)) {
        loadedIcons.current.add(exe);
        invoke<string>("get_app_icon", { exePath: exe })
          .then((b64) => {
            if (b64) setAppIcons((prev) => ({ ...prev, [exe]: b64 }));
          })
          .catch(() => {});
      }
    }

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const parts = chartEndDateStr.split("-");
      const d = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2]),
        12,
        0,
        0,
      );
      d.setDate(d.getDate() - (6 - i));
      const dateStr = formatLocalDate(d);
      const name = d.toLocaleDateString("en-US", { weekday: "short" });
      return { dateStr, name, secs: 0 };
    });

    const startStr = last7Days[0].dateStr;
    const endStr = last7Days[6].dateStr;

    let hist: [string, number][];
    if (selectedApp) {
      hist = await invoke("get_app_history", {
        processName: selectedApp,
        start: startStr,
        end: endStr,
      });
    } else {
      hist = await invoke("get_history", { start: startStr, end: endStr });
    }

    for (const [d, s] of hist) {
      const match = last7Days.find((x) => x.dateStr === d);
      if (match) match.secs = s;
    }

    setHistory(last7Days);
  }, [selectedDate, selectedApp, chartEndDateStr]);

  // ── Load settings once ────────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    const sys = await invoke<SystemInfo>("get_system_info");
    setSysInfo(sys);
    const sets = await invoke<Record<string, string>>("get_settings");
    try {
      sets["autostart"] = (await isEnabled()) ? "1" : "0";
    } catch {}
    invoke<string>("get_app_version")
      .then((v) => {
        if (v) setAppVersion(v);
      })
      .catch(() => {});
    try {
      const pending = await invoke<UpdateInfo | null>("get_pending_update");
      if (pending) {
        setUpdateInfo(pending);
        setTimeout(() => updateDialogRef.current?.show(), 350);
      }
    } catch {}
    setSettings(sets);
    if (sets["first_run_completed"] !== "1") {
      setShowOobe(true);
    }
    if (sets["pending_monthly_report"]) {
      try {
        const data = JSON.parse(sets["pending_monthly_report"]);
        setMonthlyReport(data);
        setTimeout(() => monthlyDialogRef.current?.show(), 350);
      } catch {}
    }
    setExcludeRegex(sets["exclude_regex"] ?? "");
    const saved = (sets["theme"] as "System" | "Light" | "Dark") ?? "System";
    setThemeMode(saved);
    // Apply theme immediately with loaded info
    const dark = saved === "Dark" || (saved === "System" && sys.dark_mode);
    applyMaterialTheme(sys.accent_color, dark);
    if (sets["always_on_top"] === "1") {
      win.setAlwaysOnTop(true);
    }
    const p = await invoke<string | null>("is_paused");
    setPausedUntil(p);
  }, []);

  const handleOobeComplete = async (newSets: Record<string, string>) => {
    for (const [key, val] of Object.entries(newSets)) {
      await invoke("set_setting", { key, value: val });
    }
    if (newSets["autostart"] === "1") {
      try {
        await enable();
      } catch {}
    } else if (newSets["autostart"] === "0") {
      try {
        await disable();
      } catch {}
    }
    setSettings((prev) => ({ ...prev, ...newSets }));
    setShowOobe(false);
    loadUsage();
  };

  let windowTitle = "Active Screen Time";
  if (showOobe) windowTitle += " - Setup Wizard";
  else if (activeTab === 0 && selectedApp) windowTitle += ` - ${selectedApp}`;
  if (activeTab === 1) windowTitle += " - Goals";
  if (activeTab === 2) windowTitle += " - Settings";
  if (activeTab === 3) windowTitle += " - About";

  useEffect(() => {
    getCurrentWindow().setTitle(windowTitle);
  }, [windowTitle]);

  const isVisible = useRef(true);

  useEffect(() => {
    loadSettings();
    loadUsage();

    const interval = setInterval(() => {
      // Midnight day-rollover detection (00:00)
      const nowDay = formatLocalDate();
      if (nowDay !== lastKnownDayRef.current) {
        const prevDay = lastKnownDayRef.current;
        lastKnownDayRef.current = nowDay;
        // If the chart was showing the current week, advance to the new day
        setChartEndDateStr((prev) => (prev >= prevDay ? nowDay : prev));
        // Reset selected date if it was pointing to yesterday so today is auto-focused
        setSelectedDate((prev) => (prev === prevDay ? null : prev));
      }

      if (isVisible.current) {
        loadUsage();
      }
    }, 2000);

    const unlistenTheme = listen<SystemInfo>("system-theme-changed", (e) => {
      setSysInfo(e.payload);
    });

    const unlistenP = listen("tracker-event", (e: any) => {
      setTrackerStatus(e.payload.status);
      setCurrentApp(e.payload.app);
    });

    const unlistenVis = listen("visibility-changed", (e: any) => {
      isVisible.current = !!e.payload;
      if (e.payload) {
        loadUsage();
        loadSettings();
      }
    });

    const unlistenPause = listen("pause-state-changed", (e: any) => {
      setPausedUntil(e.payload);
    });

    const unlistenMonthly = listen("monthly-report", (e: any) => {
      setMonthlyReport(e.payload);
      setTimeout(() => monthlyDialogRef.current?.show(), 100);
    });

    const unlistenUpdate = listen<UpdateInfo>("update-available", (e) => {
      setUpdateInfo(e.payload);
      setTimeout(() => updateDialogRef.current?.show(), 150);
    });

    const unlistenProgress = listen<DownloadProgress>("update-download-progress", (e) => {
      setDownloadProgress(e.payload);
    });

    const unlistenErr = listen<string>("update-error", (e) => {
      setUpdateDownloading(false);
      setUpdateError(e.payload);
    });

    const noCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noCtx);

    return () => {
      clearInterval(interval);
      unlistenTheme.then((f) => f());
      unlistenP.then((f) => f());
      unlistenVis.then((f) => f());
      unlistenPause.then((f) => f());
      unlistenMonthly.then((f) => f());
      unlistenUpdate.then((f) => f());
      unlistenProgress.then((f) => f());
      unlistenErr.then((f) => f());
      document.removeEventListener("contextmenu", noCtx);
    };
  }, [selectedDate, selectedApp, loadSettings, loadUsage]);

  async function updateSetting(key: string, value: string) {
    await invoke("set_setting", { key, value });
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (key === "theme") {
      const mode = value as "System" | "Light" | "Dark";
      setThemeMode(mode);
      if (sysInfo) {
        const dark =
          mode === "Dark" || (mode === "System" && sysInfo.dark_mode);
        applyMaterialTheme(sysInfo.accent_color, dark);
      }
    }
    if (key === "autostart") {
      if (value === "1") await enable();
      else await disable();
    }
    if (key === "always_on_top") {
      win.setAlwaysOnTop(value === "1");
    }
  }

  async function resetData() {
    await invoke("reset_data");
    loadUsage();
  }

  async function dismissMonthlyReport() {
    monthlyDialogRef.current?.close();
    setMonthlyReport(null);
    await updateSetting("pending_monthly_report", "");
  }

  const handleManualCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateCheckStatus(null);
    try {
      const res = await invoke<UpdateInfo | null>("check_for_updates");
      if (res) {
        setUpdateInfo(res);
        setTimeout(() => updateDialogRef.current?.show(), 100);
      } else {
        setUpdateCheckStatus(`You're up to date! v${appVersion} is the latest version.`);
        setTimeout(() => setUpdateCheckStatus(null), 5000);
      }
    } catch (e: any) {
      setUpdateCheckStatus(`Check failed: ${e?.toString() || "Network error"}`);
      setTimeout(() => setUpdateCheckStatus(null), 5000);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleStartUpdate = async () => {
    if (!updateInfo?.asset_url || !updateInfo?.asset_name) {
      if (updateInfo?.release_url) {
        await invoke("open_external_url", { url: updateInfo.release_url }).catch(() => {
          window.open(updateInfo.release_url, "_blank");
        });
      }
      return;
    }
    setUpdateDownloading(true);
    setUpdateError(null);
    setDownloadProgress({ percent: 0, downloaded: 0, total: updateInfo.asset_size || 0 });
    try {
      await invoke("install_update", {
        assetUrl: updateInfo.asset_url,
        assetName: updateInfo.asset_name,
      });
    } catch (e: any) {
      setUpdateDownloading(false);
      setUpdateError(e?.toString() || "Failed to start installer.");
    }
  };

  const handleDismissUpdate = async () => {
    updateDialogRef.current?.close();
    setUpdateInfo(null);
    setUpdateDownloading(false);
    setDownloadProgress(null);
    setUpdateError(null);
    await invoke("dismiss_update").catch(() => {});
  };

  const todayStr = formatLocalDate();
  const isCurrentWeek = chartEndDateStr >= todayStr;

  function goPrevWeek() {
    const parts = chartEndDateStr.split("-");
    const d = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
      12,
      0,
      0,
    );
    d.setDate(d.getDate() - 7);
    setChartEndDateStr(formatLocalDate(d));
  }

  function goNextWeek() {
    const parts = chartEndDateStr.split("-");
    const d = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
      12,
      0,
      0,
    );
    d.setDate(d.getDate() + 7);
    let newStr = formatLocalDate(d);
    if (newStr > todayStr) newStr = todayStr;
    setChartEndDateStr(newStr);
  }

  const displaySecs =
    selectedDate && selectedDate !== todayStr
      ? (history.find((h) => h.dateStr === selectedDate)?.secs ?? 0)
      : todayUsage;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="flex flex-col h-screen overflow-hidden"
        style={{
          background: "var(--md-sys-color-background)",
          color: "var(--md-sys-color-on-background)",
        }}
      >
        {/* ── Custom Titlebar ────────────────────────────────────────────────── */}
        <div
          data-tauri-drag-region
          onContextMenu={(e) => {
            e.preventDefault();
            invoke("show_system_menu");
          }}
          style={{
            height: 32,
            background: "var(--md-sys-color-surface-container-low)",
            borderBottom: "1px solid var(--md-sys-color-outline-variant)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 8px 0 12px",
            flexShrink: 0,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <div
            data-tauri-drag-region
            className="md-typescale-label-medium"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "none",
              color: "var(--md-sys-color-on-surface-variant)",
              margin: 0,
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <img
              src="/logo.ico"
              data-tauri-drag-region
              style={{
                width: 18,
                height: 18,
                opacity: 0.85,
                pointerEvents: "none",
              }}
              alt=""
            />
            <span
              data-tauri-drag-region
              style={{
                pointerEvents: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              {windowTitle}
            </span>
          </div>
          <div
            style={{ display: "flex", gap: 2 }}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <TitleBarButton
              aria-label="Minimize"
              onClick={() => win.minimize()}
              hoverBg="color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)"
            >
              <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
                <rect width="10" height="1.5" y="0.25" />
              </svg>
            </TitleBarButton>
            <TitleBarButton
              aria-label="Close"
              onClick={() => win.close()}
              hoverBg="#c42b1c"
              hoverColor="#fff"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              >
                <line x1="1" y1="1" x2="9" y2="9" />
                <line x1="9" y1="1" x2="1" y2="9" />
              </svg>
            </TitleBarButton>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        {showOobe ? (
          <OobeWizard
            initialSettings={settings}
            onComplete={handleOobeComplete}
          />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* ── Navigation Rail (MD3 spec) ───────────────────────────────── */}
            <nav
              style={{
                width: 80,
                background: "var(--md-sys-color-surface-container-low)",
                borderRight: "1px solid var(--md-sys-color-outline-variant)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 0",
                gap: 8,
                flexShrink: 0,
              }}
            >
              {[
                { icon: "insert_chart", label: "Dashboard" },
                { icon: "flag", label: "Goals" },
                { icon: "settings", label: "Settings" },
                { icon: "info", label: "About" },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={() => setActiveTab(i)}
                  className="nav-item"
                  style={
                    activeTab === i
                      ? { color: "var(--md-sys-color-on-secondary-container)" }
                      : {}
                  }
                >
                  <div
                    className="nav-indicator"
                    style={
                      activeTab === i
                        ? {
                            background:
                              "var(--md-sys-color-secondary-container)",
                            width: 56,
                          }
                        : {}
                    }
                  />
                  <span
                    className="material-symbols-rounded"
                    style={{
                      position: "relative",
                      zIndex: 1,
                      fontVariationSettings:
                        activeTab === i ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >
                    {item.icon}
                  </span>
                  <span
                    className="md-typescale-label-medium"
                    style={{ position: "relative", zIndex: 1 }}
                  >
                    {item.label}
                  </span>
                </button>
              ))}
            </nav>

            {/* ── Main Content ─────────────────────────────────────────────── */}
            <main
              className="flex-1 overflow-y-auto"
              style={{ padding: "24px 24px 48px", overflowX: "hidden" }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  {/* ── Dashboard ─────────────────────────────────────────── */}
                  {activeTab === 0 && (
                    <div
                      style={{
                        maxWidth: 800,
                        margin: "0 auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 24,
                      }}
                    >
                      {/* Header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "space-between",
                          margin: 0,
                          marginBottom: 8,
                        }}
                      >
                        <div>
                          <p
                            className="md-typescale-title-medium"
                            style={{
                              color: "var(--md-sys-color-on-surface-variant)",
                              margin: 0,
                              marginBottom: 4,
                              fontWeight: 500,
                            }}
                          >
                            {(() => {
                              const fmt = settings["date_format"] || "%a, %d";
                              if (!selectedDate || selectedDate === todayStr) {
                                return `Today — ${formatDateStr(todayStr, fmt)}`;
                              }
                              return formatDateStr(selectedDate, fmt);
                            })()}
                          </p>
                          <TimeFlow
                            secs={displaySecs}
                            style={{
                              fontSize: "64px",
                              fontWeight: 700,
                              letterSpacing: "-1px",
                              color: "var(--md-sys-color-on-surface)",
                              lineHeight: 1,
                              margin: 0,
                            }}
                          />
                          {settings["goal_enabled"] === "1" &&
                            (() => {
                              const goalMins =
                                parseInt(
                                  settings["goal_minutes"] || "240",
                                  10,
                                ) || 240;
                              const goalSecs = goalMins * 60;
                              const pct =
                                goalSecs > 0
                                  ? Math.round((displaySecs / goalSecs) * 100)
                                  : 0;
                              const gh = Math.floor(goalMins / 60);
                              const gm = goalMins % 60;
                              const goalText =
                                gh > 0
                                  ? `${gh}h ${String(gm).padStart(2, "0")}m`
                                  : `${gm}m`;

                              return (
                                <div
                                  style={{
                                    marginTop: 0,
                                    width: "100%",
                                    maxWidth: 320,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "baseline",
                                      marginBottom: 6,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color:
                                          "var(--md-sys-color-on-surface-variant)",
                                        fontWeight: 500,
                                        fontSize: 13,
                                        letterSpacing: "0.2px",
                                      }}
                                    >
                                      Daily Goal: {goalText}
                                    </span>
                                    <span
                                      style={{
                                        color: "var(--md-sys-color-on-surface)",
                                        fontWeight: 700,
                                        fontSize: 14,
                                        display: "inline-flex",
                                        alignItems: "baseline",
                                      }}
                                    >
                                      <NumberFlow value={pct} suffix="%" />
                                    </span>
                                  </div>
                                  <div
                                    style={{
                                      width: "100%",
                                      height: 6,
                                      borderRadius: 9999,
                                      background:
                                        "color-mix(in srgb, var(--md-sys-color-on-surface) 14%, transparent)",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <motion.div
                                      initial={false}
                                      animate={{
                                        width: `${Math.min(100, Math.max(0, pct))}%`,
                                      }}
                                      transition={{
                                        duration: 0.4,
                                        ease: [0.16, 1, 0.3, 1],
                                      }}
                                      style={{
                                        height: "100%",
                                        borderRadius: 9999,
                                        background:
                                          "var(--md-sys-color-primary)",
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })()}
                          {settings["hide_active_app"] !== "1" &&
                            (() => {
                              const isCurrentlyPaused =
                                pausedUntil &&
                                new Date(pausedUntil).getTime() > Date.now();
                              let pausedLabel = "Paused";
                              if (isCurrentlyPaused) {
                                const diffMins = Math.ceil(
                                  (new Date(pausedUntil!).getTime() -
                                    Date.now()) /
                                    60000,
                                );
                                if (diffMins > 60 * 12)
                                  pausedLabel = "Paused until tomorrow";
                                else if (diffMins >= 60)
                                  pausedLabel = `Paused for ${Math.floor(diffMins / 60)}h ${diffMins % 60 > 0 ? (diffMins % 60) + "m" : ""}`;
                                else pausedLabel = `Paused for ${diffMins}m`;
                              }

                              return (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    marginTop: 12,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: "50%",
                                      background: isCurrentlyPaused
                                        ? "var(--md-sys-color-error)"
                                        : trackerStatus === "active"
                                          ? "var(--md-sys-color-tertiary)"
                                          : "var(--md-sys-color-outline)",
                                      display: "inline-block",
                                    }}
                                  />
                                  <span
                                    className="md-typescale-body-medium"
                                    style={{
                                      color:
                                        "var(--md-sys-color-on-surface-variant)",
                                    }}
                                  >
                                    {isCurrentlyPaused
                                      ? pausedLabel
                                      : trackerStatus === "active"
                                        ? `Active: ${currentApp}`
                                        : "Idle"}
                                  </span>
                                </div>
                              );
                            })()}
                        </div>

                        {(() => {
                          const isCurrentlyPaused =
                            pausedUntil &&
                            new Date(pausedUntil).getTime() > Date.now();

                          return (
                            <span
                              style={{
                                position: "relative",
                                alignSelf: "flex-start",
                                marginTop: 8,
                              }}
                            >
                              <motion.button
                                id="dashboard-pause-btn"
                                layout
                                style={{
                                  padding: "8px 16px",
                                  borderRadius: 99,
                                  border: "none",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  position: "relative",
                                  overflow: "hidden",
                                }}
                                initial={false}
                                animate={{
                                  background: isCurrentlyPaused
                                    ? "var(--md-sys-color-primary)"
                                    : "var(--md-sys-color-secondary-container)",
                                  color: isCurrentlyPaused
                                    ? "var(--md-sys-color-on-primary)"
                                    : "var(--md-sys-color-on-secondary-container)",
                                }}
                                transition={{ duration: 0.2 }}
                                onClick={() => {
                                  if (isCurrentlyPaused) {
                                    invoke("set_paused", { mins: 0 });
                                  } else {
                                    const menu = document.getElementById(
                                      "dashboard-pause-menu",
                                    ) as any;
                                    if (menu) menu.open = !menu.open;
                                  }
                                }}
                              >
                                <md-ripple></md-ripple>
                                <AnimatePresence mode="wait" initial={false}>
                                  <motion.div
                                    key={isCurrentlyPaused ? "resume" : "pause"}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.15 }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                    <span
                                      className="material-symbols-rounded"
                                      style={{ fontSize: 20 }}
                                    >
                                      {isCurrentlyPaused
                                        ? "play_arrow"
                                        : "pause"}
                                    </span>
                                    <span
                                      className="md-typescale-label-large"
                                      style={{ fontWeight: 600 }}
                                    >
                                      {isCurrentlyPaused ? "Resume" : "Pause"}
                                    </span>
                                  </motion.div>
                                </AnimatePresence>
                              </motion.button>

                              <md-menu
                                positioning="popover"
                                id="dashboard-pause-menu"
                                anchor="dashboard-pause-btn"
                              >
                                <md-menu-item
                                  onClick={() =>
                                    invoke("set_paused", { mins: 5 })
                                  }
                                >
                                  <div slot="headline">5 minutes</div>
                                </md-menu-item>
                                <md-menu-item
                                  onClick={() =>
                                    invoke("set_paused", { mins: 15 })
                                  }
                                >
                                  <div slot="headline">15 minutes</div>
                                </md-menu-item>
                                <md-menu-item
                                  onClick={() =>
                                    invoke("set_paused", { mins: 30 })
                                  }
                                >
                                  <div slot="headline">30 minutes</div>
                                </md-menu-item>
                                <md-menu-item
                                  onClick={() =>
                                    invoke("set_paused", { mins: 60 })
                                  }
                                >
                                  <div slot="headline">1 hour</div>
                                </md-menu-item>
                                <md-menu-item
                                  onClick={() => {
                                    const now = new Date();
                                    const tomorrow = new Date(
                                      now.getFullYear(),
                                      now.getMonth(),
                                      now.getDate() + 1,
                                    );
                                    const mins = Math.floor(
                                      (tomorrow.getTime() - now.getTime()) /
                                        60000,
                                    );
                                    invoke("set_paused", { mins });
                                  }}
                                >
                                  <div slot="headline">Until tomorrow</div>
                                </md-menu-item>
                              </md-menu>
                            </span>
                          );
                        })()}
                      </div>

                      {/* Chart card */}
                      <div
                        className="ast-card"
                        style={{
                          padding: "20px 20px 16px",
                          overflow: "visible",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 16,
                          }}
                        >
                          <h2
                            className="md-typescale-title-large"
                            style={{
                              color: "var(--md-sys-color-on-surface)",
                              margin: 0,
                              fontWeight: 700,
                            }}
                          >
                            {selectedApp
                              ? `${selectedApp} — Last 7 Days`
                              : "Last 7 Days"}
                          </h2>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            {selectedApp && (
                              <ChipButton onClick={() => setSelectedApp(null)}>
                                Show all apps
                              </ChipButton>
                            )}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <button
                                onClick={goPrevWeek}
                                style={{
                                  width: 32,
                                  padding: 4,
                                  borderRadius: 16,
                                  background: "transparent",
                                  cursor: "pointer",
                                  border: "none",
                                  color: "var(--md-sys-color-on-surface)",
                                }}
                              >
                                <span className="material-symbols-rounded">
                                  chevron_left
                                </span>
                              </button>
                              <div
                                ref={dateWrapperRef}
                                style={{
                                  position: "relative",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  color:
                                    "var(--md-sys-color-on-surface-variant)",
                                  fontSize: 14,
                                  fontWeight: 500,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "baseline",
                                  }}
                                  onClick={() =>
                                    setDatePickerOpen((prev) => !prev)
                                  }
                                >
                                  <NumberFlow
                                    value={
                                      Number(history[0]?.dateStr.slice(5, 7)) ||
                                      0
                                    }
                                    format={{ minimumIntegerDigits: 2 }}
                                    prefix={`${history[0]?.name || ""} `}
                                    suffix="-"
                                  />
                                  <NumberFlow
                                    value={
                                      Number(
                                        history[0]?.dateStr.slice(8, 10),
                                      ) || 0
                                    }
                                    format={{ minimumIntegerDigits: 2 }}
                                    suffix=" - "
                                  />
                                  <NumberFlow
                                    value={
                                      Number(history[6]?.dateStr.slice(5, 7)) ||
                                      0
                                    }
                                    format={{ minimumIntegerDigits: 2 }}
                                    prefix={`${history[6]?.name || ""} `}
                                    suffix="-"
                                  />
                                  <NumberFlow
                                    value={
                                      Number(
                                        history[6]?.dateStr.slice(8, 10),
                                      ) || 0
                                    }
                                    format={{ minimumIntegerDigits: 2 }}
                                  />
                                </div>
                                <AnimatePresence>
                                  {datePickerOpen && (
                                    <SimpleDatePicker
                                      value={chartEndDateStr}
                                      onChange={(v) => {
                                        setChartEndDateStr(
                                          v > todayStr ? todayStr : v,
                                        );
                                      }}
                                      onClose={() => setDatePickerOpen(false)}
                                    />
                                  )}
                                </AnimatePresence>
                              </div>
                              <button
                                onClick={goNextWeek}
                                style={{
                                  width: 32,
                                  padding: 4,
                                  borderRadius: 16,
                                  background: "transparent",
                                  border: "none",
                                  visibility: isCurrentWeek
                                    ? "hidden"
                                    : "visible",
                                  cursor: isCurrentWeek ? "default" : "pointer",
                                  color: "var(--md-sys-color-on-surface)",
                                }}
                              >
                                <span className="material-symbols-rounded">
                                  chevron_right
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                        <div
                          id="ast-main-chart"
                          style={{ height: 160, position: "relative" }}
                        >
                          <AnimatePresence>
                            {hoverData && history[hoverData.index] && (
                              <motion.div
                                initial={{
                                  opacity: 0,
                                  x: hoverData.x,
                                  y: hoverData.y - 10,
                                }}
                                animate={{
                                  opacity: 1,
                                  x: hoverData.x,
                                  y: hoverData.y - 36,
                                }}
                                exit={{ opacity: 0, y: hoverData.y - 10 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  zIndex: 10,
                                  pointerEvents: "none",
                                }}
                              >
                                <div
                                  style={{
                                    transform: "translateX(-50%)",
                                    background:
                                      "var(--md-sys-color-inverse-surface)",
                                    color:
                                      "var(--md-sys-color-inverse-on-surface)",
                                    padding: "4px 12px",
                                    borderRadius: 8,
                                    fontSize: 14,
                                    fontWeight: 500,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {formatSecs(history[hoverData.index].secs)}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              key={chartEndDateStr + (selectedApp || "")}
                              data={history}
                              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                              style={{ cursor: "pointer" }}
                              onClick={(e: any) => {
                                if (e && e.activeTooltipIndex !== undefined) {
                                  const entry = history[e.activeTooltipIndex];
                                  if (entry?.dateStr)
                                    setSelectedDate(entry.dateStr);
                                }
                              }}
                              onMouseMove={(e: any) => {
                                if (e && e.activeTooltipIndex !== undefined) {
                                  const idx = e.activeTooltipIndex;
                                  if (hoverIndexRef.current === idx) return;
                                  hoverIndexRef.current = idx;

                                  let barX = e.activeCoordinate?.x ?? 0;
                                  let barY = 130;
                                  const chartEl =
                                    document.getElementById("ast-main-chart");
                                  if (chartEl) {
                                    const bars = chartEl.querySelectorAll(
                                      ".recharts-bar-rectangle",
                                    );
                                    if (bars && bars[idx]) {
                                      try {
                                        const bbox = (
                                          bars[idx] as any
                                        ).getBBox();
                                        if (
                                          bbox &&
                                          typeof bbox.x === "number"
                                        ) {
                                          barX = bbox.x + bbox.width / 2;
                                          barY = bbox.y;
                                        }
                                      } catch {}
                                    }
                                  }
                                  setHoverData({
                                    index: idx,
                                    x: barX,
                                    y: barY,
                                  });
                                } else if (hoverIndexRef.current !== null) {
                                  hoverIndexRef.current = null;
                                  setHoverData(null);
                                }
                              }}
                              onMouseLeave={() => {
                                hoverIndexRef.current = null;
                                setHoverData(null);
                              }}
                            >
                              <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{
                                  fill: "var(--ast-axis-text)",
                                  fontSize: 11,
                                  fontFamily: "inherit",
                                }}
                                dy={8}
                              />
                              <Bar
                                dataKey="secs"
                                radius={[6, 6, 0, 0]}
                                isAnimationActive={false}
                                style={{ cursor: "pointer" }}
                                onClick={(data: any) => {
                                  const dateStr =
                                    data?.dateStr ?? data?.payload?.dateStr;
                                  if (dateStr) setSelectedDate(dateStr);
                                }}
                              >
                                {history.map((entry, i) => {
                                  const isSelected =
                                    entry.dateStr === selectedDate ||
                                    (!selectedDate && i === history.length - 1);

                                  let fill = "var(--ast-bar-inactive)";
                                  if (isSelected) {
                                    fill =
                                      hoverData?.index === i
                                        ? `color-mix(in srgb, var(--md-sys-color-on-surface) 15%, ${activeBarColor})`
                                        : activeBarColor;
                                  } else if (hoverData?.index === i) {
                                    fill =
                                      "color-mix(in srgb, var(--md-sys-color-on-surface) 12%, var(--ast-bar-inactive))";
                                  }

                                  return (
                                    <Cell
                                      key={entry.dateStr}
                                      fill={fill}
                                      style={{ transition: "fill 0.2s ease" }}
                                    />
                                  );
                                })}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <AnimatePresence>
                          {!selectedApp && settings["hide_stats"] !== "1" && (
                            <motion.div
                              initial={{ opacity: 0, height: 0, marginTop: 0 }}
                              animate={{
                                opacity: 1,
                                height: "auto",
                                marginTop: 12,
                              }}
                              exit={{ opacity: 0, height: 0, marginTop: 0 }}
                              transition={{ duration: 0.3, ease: "easeOut" }}
                              style={{
                                display: "flex",
                                gap: 16,
                                padding: "0 4px",
                                overflow: "hidden",
                              }}
                            >
                              <TimeFlow
                                secs={
                                  history.length
                                    ? Math.floor(
                                        history.reduce(
                                          (a, b) => a + b.secs,
                                          0,
                                        ) / 7,
                                      )
                                    : 0
                                }
                                prefix="Avg/day: "
                                style={{
                                  color:
                                    "var(--md-sys-color-on-surface-variant)",
                                  fontSize: 12,
                                }}
                              />
                              <TimeFlow
                                secs={
                                  history.length
                                    ? Math.max(...history.map((d) => d.secs))
                                    : 0
                                }
                                prefix="Longest: "
                                style={{
                                  color:
                                    "var(--md-sys-color-on-surface-variant)",
                                  fontSize: 12,
                                }}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Per-App Usage */}
                      <div className="ast-card">
                        <div style={{ padding: "16px 20px 12px" }}>
                          <h2
                            className="md-typescale-title-large"
                            style={{
                              color: "var(--md-sys-color-on-surface)",
                              margin: 0,
                              fontWeight: 700,
                            }}
                          >
                            Per-App Usage
                          </h2>
                        </div>
                        {appUsage.length === 0 ? (
                          <p
                            className="md-typescale-body-medium"
                            style={{
                              padding: "0 20px 20px",
                              color: "var(--md-sys-color-on-surface-variant)",
                              margin: 0,
                            }}
                          >
                            No activity recorded for this period.
                          </p>
                        ) : (
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <AnimatePresence mode="popLayout">
                              {appUsage.map(([app, exe, secs], i) => (
                                <motion.div
                                  key={`${app}-${exe}`}
                                  layout
                                  initial={{ opacity: 0, scale: 0.95 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.95 }}
                                  transition={{
                                    duration: 0.4,
                                    ease: "easeOut",
                                  }}
                                >
                                  {i > 0 && (
                                    <div
                                      style={{
                                        height: 1,
                                        background:
                                          "var(--md-sys-color-outline-variant)",
                                        margin: "0 20px",
                                      }}
                                    />
                                  )}
                                  <button
                                    className={`app-row${app === selectedApp ? " selected" : ""}`}
                                    onClick={() =>
                                      setSelectedApp(
                                        app === selectedApp ? null : app,
                                      )
                                    }
                                  >
                                    <md-ripple />
                                    <div
                                      className="md-typescale-title-small"
                                      style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: 12,
                                        overflow: "hidden",
                                        flexShrink: 0,
                                        background:
                                          "var(--md-sys-color-secondary-container)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color:
                                          "var(--md-sys-color-on-secondary-container)",
                                        margin: 0,
                                        padding: 6,
                                      }}
                                    >
                                      {appIcons[exe] ? (
                                        <img
                                          src={appIcons[exe]}
                                          alt=""
                                          style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                          }}
                                        />
                                      ) : (
                                        app.substring(0, 2).toUpperCase()
                                      )}
                                    </div>
                                    <span
                                      className="md-typescale-body-large"
                                      style={{
                                        flex: 1,
                                        color: "var(--md-sys-color-on-surface)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {app}
                                    </span>
                                    <TimeFlow
                                      secs={secs}
                                      style={{
                                        color:
                                          "var(--md-sys-color-on-surface-variant)",
                                        flexShrink: 0,
                                        fontSize: 14,
                                        fontWeight: 500,
                                      }}
                                    />
                                  </button>
                                </motion.div>
                              ))}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Settings ──────────────────────────────────────────── */}
                  {activeTab === 2 && (
                    <div
                      style={{
                        maxWidth: 800,
                        margin: "0 auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 24,
                      }}
                    >
                      <h1
                        className="md-typescale-display-small"
                        style={{
                          color: "var(--md-sys-color-on-surface)",
                          margin: 0,
                          fontWeight: 700,
                        }}
                      >
                        Settings
                      </h1>

                      {/* Appearance */}
                      <SettingSection label="Appearance">
                        <SettingRow
                          title="Theme"
                          subtitle="Follow system, or pick Light / Dark."
                        >
                          <div className="seg-group">
                            {(["System", "Light", "Dark"] as const).map(
                              (opt) => (
                                <button
                                  key={opt}
                                  className={`seg-btn${themeMode === opt ? " active" : ""}`}
                                  onClick={() => updateSetting("theme", opt)}
                                >
                                  <md-ripple />
                                  {opt}
                                </button>
                              ),
                            )}
                          </div>
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Date Format"
                          subtitle="E.g. %a, %d for Sun, 05 or %b %d for Jul 05"
                          infoTooltip={
                            <InfoTooltip content={DateFormatInfo} width={280} />
                          }
                        >
                          <md-outlined-text-field
                            type="text"
                            value={settings["date_format"] || "%a"}
                            onBlur={(e: any) =>
                              updateSetting("date_format", e.target.value)
                            }
                            style={{ width: 140 }}
                          />
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <MdSwitchRow
                          title="Hide Active App Status"
                          subtitle="Don't show the currently active app on the dashboard."
                          checked={settings["hide_active_app"] === "1"}
                          onChange={(v) =>
                            updateSetting("hide_active_app", v ? "1" : "0")
                          }
                        />
                        <MdSwitchRow
                          title="Hide Stats Labels"
                          subtitle="Hide the Avg/day and Longest labels on the dashboard."
                          checked={settings["hide_stats"] === "1"}
                          onChange={(v) =>
                            updateSetting("hide_stats", v ? "1" : "0")
                          }
                        />
                      </SettingSection>

                      {/* System */}
                      <SettingSection label="System">
                        <MdSwitchRow
                          title="Launch on Startup"
                          subtitle="Start tracking when you log in."
                          checked={settings["autostart"] === "1"}
                          onChange={(v) =>
                            updateSetting("autostart", v ? "1" : "0")
                          }
                          divider
                        />
                        <MdSwitchRow
                          title="Dashboard Always on Top"
                          subtitle="Keep the dashboard floating above other windows."
                          checked={settings["always_on_top"] === "1"}
                          onChange={(v) =>
                            updateSetting("always_on_top", v ? "1" : "0")
                          }
                          divider
                        />
                        <MdSwitchRow
                          title="Automatic Updates"
                          subtitle="Automatically check GitHub for new versions on startup. Can be disabled for 100% offline privacy."
                          checked={settings["auto_check_updates"] !== "0"}
                          onChange={(v) =>
                            updateSetting("auto_check_updates", v ? "1" : "0")
                          }
                          divider
                        />
                        <SettingRow
                          title="Check for Updates"
                          subtitle={
                            updateCheckStatus ||
                            `Current version: v${appVersion}. Releases from GitHub.`
                          }
                        >
                          <ChipButton
                            disabled={isCheckingUpdate}
                            onClick={handleManualCheckUpdates}
                          >
                            {isCheckingUpdate ? "Checking..." : "Check Now"}
                          </ChipButton>
                        </SettingRow>
                      </SettingSection>

                      {/* Tracking */}
                      <SettingSection label="Tracking">
                        <SettingRow
                          title="Idle Timeout (seconds)"
                          subtitle="Stop tracking if you are inactive for this long."
                        >
                          <md-outlined-text-field
                            type="number"
                            value={settings["idle_timeout"] || "300"}
                            onInput={(e: any) =>
                              updateSetting("idle_timeout", e.target.value)
                            }
                            onBlur={(e: any) =>
                              updateSetting("idle_timeout", e.target.value)
                            }
                            style={{ width: 100 }}
                          />
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <MdSwitchRow
                          title="Count Screentime on Fullscreen"
                          subtitle="Keep tracking even when a game or video is fullscreen."
                          checked={settings["track_fullscreen"] !== "0"}
                          onChange={(v) =>
                            updateSetting("track_fullscreen", v ? "1" : "0")
                          }
                          divider
                        />
                        <MdSwitchRow
                          title="Count Screentime on Media Playback"
                          subtitle="Keep tracking if audio or video is actively playing."
                          checked={settings["track_media"] === "1"}
                          onChange={(v) =>
                            updateSetting("track_media", v ? "1" : "0")
                          }
                          divider
                        />
                        <div
                          style={{ display: "flex", flexDirection: "column" }}
                        >
                          <div
                            onClick={() => setSysUiExpanded(!sysUiExpanded)}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "12px 20px",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                            className="app-row"
                          >
                            <div>
                              <h3
                                className="md-typescale-body-large"
                                style={{
                                  color: "var(--md-sys-color-on-surface)",
                                  margin: 0,
                                }}
                              >
                                Ignore Windows System UI
                              </h3>
                              <p
                                className="md-typescale-body-medium"
                                style={{
                                  color:
                                    "var(--md-sys-color-on-surface-variant)",
                                  margin: 0,
                                }}
                              >
                                Don't track internal Windows processes.
                              </p>
                            </div>
                            <span
                              className="material-symbols-rounded"
                              style={{
                                transform: sysUiExpanded
                                  ? "rotate(180deg)"
                                  : "rotate(0deg)",
                                transition: "transform 0.2s",
                              }}
                            >
                              expand_more
                            </span>
                          </div>
                          <AnimatePresence>
                            {sysUiExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{
                                  duration: 0.2,
                                  ease: "easeInOut",
                                }}
                                style={{ overflow: "hidden" }}
                              >
                                <div
                                  style={{
                                    padding: "0 20px 12px 40px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 12,
                                  }}
                                >
                                  <MdCheckboxItem
                                    label="LockApp.exe"
                                    checked={settings["ignore_lockapp"] !== "0"}
                                    onChange={(v) =>
                                      updateSetting(
                                        "ignore_lockapp",
                                        v ? "1" : "0",
                                      )
                                    }
                                  />
                                  <MdCheckboxItem
                                    label="SearchHost.exe"
                                    checked={
                                      settings["ignore_searchhost"] !== "0"
                                    }
                                    onChange={(v) =>
                                      updateSetting(
                                        "ignore_searchhost",
                                        v ? "1" : "0",
                                      )
                                    }
                                  />
                                  <MdCheckboxItem
                                    label="ShellHost.exe"
                                    checked={
                                      settings["ignore_shellhost"] !== "0"
                                    }
                                    onChange={(v) =>
                                      updateSetting(
                                        "ignore_shellhost",
                                        v ? "1" : "0",
                                      )
                                    }
                                  />
                                  <MdCheckboxItem
                                    label="ShellExperienceHost.exe"
                                    checked={
                                      settings["ignore_shellexperiencehost"] !==
                                      "0"
                                    }
                                    onChange={(v) =>
                                      updateSetting(
                                        "ignore_shellexperiencehost",
                                        v ? "1" : "0",
                                      )
                                    }
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <MdSwitchRow
                          title="Ignore Microsoft Store Apps"
                          subtitle="Don't track UWP apps like Calculator or Settings."
                          checked={settings["disable_windows_apps"] === "1"}
                          onChange={(v) =>
                            updateSetting("disable_windows_apps", v ? "1" : "0")
                          }
                        />
                      </SettingSection>

                      {/* Exclusions */}
                      <SettingSection label="Exclusions">
                        <div style={{ padding: "16px 20px 24px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              marginBottom: 4,
                            }}
                          >
                            <p
                              className="md-typescale-title-medium"
                              style={{
                                color: "var(--md-sys-color-on-surface)",
                                margin: 0,
                              }}
                            >
                              Exclude Regex
                            </p>
                            <InfoTooltip content={RegexInfo} width={340} />
                          </div>
                          <p
                            className="md-typescale-body-medium"
                            style={{
                              color: "var(--md-sys-color-on-surface-variant)",
                              margin: 0,
                              marginBottom: 16,
                            }}
                          >
                            Exclude apps whose process name, window title, or
                            executable path matches this regex.
                          </p>
                          <md-outlined-text-field
                            label="Regex pattern"
                            placeholder="e.g. (?i)^python|.*code\\.exe$"
                            value={excludeRegex}
                            className="font-mono-code"
                            style={{
                              width: "100%",
                              fontFamily: "'JetBrains Mono', monospace",
                              ["--md-outlined-text-field-input-text-font" as any]:
                                "'JetBrains Mono', monospace",
                            }}
                            onInput={(e: any) =>
                              setExcludeRegex(e.target.value)
                            }
                            onBlur={() =>
                              updateSetting("exclude_regex", excludeRegex)
                            }
                          />
                        </div>
                      </SettingSection>

                      {/* Advanced Rules */}
                      <SettingSection label="Advanced JS Rules">
                        <div style={{ padding: "16px 20px 24px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              marginBottom: 4,
                            }}
                          >
                            <p
                              className="md-typescale-title-medium"
                              style={{
                                color: "var(--md-sys-color-on-surface)",
                                margin: 0,
                              }}
                            >
                              Custom Javascript Logic
                            </p>
                            <InfoTooltip content={JsRuleInfo} width={340} />
                          </div>
                          <p
                            className="md-typescale-body-medium"
                            style={{
                              color: "var(--md-sys-color-on-surface-variant)",
                              margin: 0,
                              marginBottom: 16,
                            }}
                          >
                            Override tracking logic. Return <code>false</code>{" "}
                            to ignore, <code>true</code> to track. Leave empty
                            to use default logic.
                          </p>
                          <md-outlined-text-field
                            type="textarea"
                            rows={4}
                            placeholder="if (ctx.exe_name.toLowerCase() === 'code.exe') return false;"
                            value={settings["js_rule"] || ""}
                            onInput={(e: any) =>
                              updateSetting("js_rule", e.target.value)
                            }
                            className="font-mono-code"
                            style={{
                              width: "100%",
                              fontFamily: "'JetBrains Mono', monospace",
                              ["--md-outlined-text-field-input-text-font" as any]:
                                "'JetBrains Mono', monospace",
                            }}
                          />
                        </div>
                      </SettingSection>

                      {/* Data Management */}
                      <SettingSection label="Data Management">
                        <SettingRow
                          title="Export Settings"
                          subtitle="Save all your settings and rules to a JSON file (excluding usage history)."
                        >
                          <ChipButton onClick={() => invoke("export_settings")}>
                            Export Settings
                          </ChipButton>
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Import Settings"
                          subtitle="Restore your settings and rules from a JSON backup file."
                        >
                          <ChipButton
                            onClick={async () => {
                              try {
                                await invoke("import_settings");
                                await loadSettings();
                              } catch (e) {
                                console.error("Failed to restore settings:", e);
                              }
                            }}
                          >
                            Import Settings
                          </ChipButton>
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Export to CSV"
                          subtitle="Save your screen time history as a spreadsheet."
                        >
                          <ChipButton onClick={() => invoke("export_csv")}>
                            Export CSV
                          </ChipButton>
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Export Database Backup"
                          subtitle="Create a backup of your raw SQLite database."
                        >
                          <ChipButton onClick={() => invoke("export_db")}>
                            Backup DB
                          </ChipButton>
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Import Database Backup"
                          subtitle="Restore your history from a backup file."
                        >
                          <ChipButton
                            onClick={async () => {
                              try {
                                await invoke("import_db");
                                await loadUsage();
                                await loadSettings();
                              } catch (e) {
                                console.error("Failed to restore db:", e);
                              }
                            }}
                          >
                            Restore DB
                          </ChipButton>
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Setup Wizard"
                          subtitle="Re-run the initial welcome and configuration wizard."
                        >
                          <ChipButton onClick={() => setShowOobe(true)}>
                            Launch Wizard
                          </ChipButton>
                        </SettingRow>
                      </SettingSection>

                      {/* Danger */}
                      <SettingSection
                        label="Danger Zone"
                        labelColor="var(--md-sys-color-error)"
                      >
                        <div style={{ padding: "16px 20px 24px" }}>
                          <p
                            className="md-typescale-title-medium"
                            style={{
                              color: "var(--md-sys-color-on-surface)",
                              margin: 0,
                              marginBottom: 4,
                            }}
                          >
                            Clear All Data
                          </p>
                          <p
                            className="md-typescale-body-medium"
                            style={{
                              color: "var(--md-sys-color-on-surface-variant)",
                              margin: 0,
                              marginBottom: 16,
                            }}
                          >
                            Permanently delete all screen time history. Settings
                            are kept.
                          </p>
                          <button
                            onClick={() => dialogRef.current?.show()}
                            className="md-typescale-label-large"
                            style={{
                              position: "relative",
                              overflow: "hidden",
                              padding: "10px 24px",
                              borderRadius: 99,
                              border: "none",
                              cursor: "pointer",
                              background: "var(--md-sys-color-error)",
                              color: "var(--md-sys-color-on-error)",
                              fontFamily: "inherit",
                            }}
                          >
                            <md-ripple />
                            Delete All Data
                          </button>
                        </div>
                      </SettingSection>
                    </div>
                  )}

                  {/* ── About ────────────────────────────────────────────── */}
                  {activeTab === 3 && (
                    <div
                      style={{
                        maxWidth: 800,
                        margin: "0 auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 24,
                      }}
                    >
                      <h1
                        className="md-typescale-display-small"
                        style={{
                          color: "var(--md-sys-color-on-surface)",
                          margin: 0,
                          fontWeight: 700,
                        }}
                      >
                        About
                      </h1>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          textAlign: "center",
                          padding: "40px 0",
                        }}
                      >
                        <img
                          src="/logo.ico"
                          style={{ width: 64, height: 64, marginBottom: 16 }}
                          alt=""
                        />
                        <h2
                          className="md-typescale-headline-medium"
                          style={{
                            color: "var(--md-sys-color-on-surface)",
                            margin: 0,
                            fontWeight: 700,
                          }}
                        >
                          Active Screen Time
                        </h2>
                        <p
                          className="md-typescale-body-large"
                          style={{
                            color: "var(--md-sys-color-on-surface-variant)",
                            margin: "8px 0 24px",
                            maxWidth: 600,
                          }}
                        >
                          This app is designed to count CORRECT USER screen time
                          (because a screen can be active 24 hours, but you
                          wouldn't stare at it 24/7). It features an
                          auto-timeout, counts past the timeout if
                          fullscreen/media is playing, and excludes Windows
                          System UI that clutters the correct screen time.
                          <br />
                          Heavily inspired by Android Digital Wellbeing.
                        </p>
                        <div
                          style={{
                            display: "inline-flex",
                            gap: 32,
                            textAlign: "left",
                          }}
                        >
                          <div>
                            <p
                              className="md-typescale-label-large"
                              style={{
                                color: "var(--md-sys-color-on-surface-variant)",
                                margin: 0,
                              }}
                            >
                              Version
                            </p>
                            <p
                              className="md-typescale-body-medium"
                              style={{
                                color: "var(--md-sys-color-on-surface)",
                                margin: 0,
                              }}
                            >
                              {appVersion}
                            </p>
                          </div>
                          <div>
                            <p
                              className="md-typescale-label-large"
                              style={{
                                color: "var(--md-sys-color-on-surface-variant)",
                                margin: 0,
                              }}
                            >
                              Frontend
                            </p>
                            <p
                              className="md-typescale-body-medium"
                              style={{
                                color: "var(--md-sys-color-on-surface)",
                                margin: 0,
                              }}
                            >
                              React 18 + Tauri 2.0
                            </p>
                          </div>
                          <div>
                            <p
                              className="md-typescale-label-large"
                              style={{
                                color: "var(--md-sys-color-on-surface-variant)",
                                margin: 0,
                              }}
                            >
                              Backend
                            </p>
                            <p
                              className="md-typescale-body-medium"
                              style={{
                                color: "var(--md-sys-color-on-surface)",
                                margin: 0,
                              }}
                            >
                              Rust + SQLite
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Goals & Break Reminders ────────────────────────────── */}
                  {activeTab === 1 && (
                    <div
                      style={{
                        maxWidth: 800,
                        margin: "0 auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 24,
                      }}
                    >
                      <h1
                        className="md-typescale-display-small"
                        style={{
                          color: "var(--md-sys-color-on-surface)",
                          margin: 0,
                          fontWeight: 700,
                        }}
                      >
                        Goals & Reminders
                      </h1>

                      <SettingSection label="Screen Time Goal">
                        <MdSwitchRow
                          title="Enable daily screen time goal"
                          subtitle="Get notified when you exceed a set amount of screen time."
                          checked={settings["goal_enabled"] === "1"}
                          onChange={(v) =>
                            updateSetting("goal_enabled", v ? "1" : "0")
                          }
                        />
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow title="Goal duration (minutes)" subtitle="">
                          <md-outlined-text-field
                            type="number"
                            value={settings["goal_minutes"] || "240"}
                            onInput={(e: any) =>
                              updateSetting("goal_minutes", e.target.value)
                            }
                            onBlur={(e: any) =>
                              updateSetting("goal_minutes", e.target.value)
                            }
                            style={{ width: 140 }}
                          />
                        </SettingRow>
                      </SettingSection>

                      <SettingSection label="Break Reminders">
                        <MdSwitchRow
                          title="Enable break reminders"
                          subtitle="Get a popup notification reminding you to rest."
                          checked={settings["break_enabled"] === "1"}
                          onChange={(v) =>
                            updateSetting("break_enabled", v ? "1" : "0")
                          }
                        />
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Continuous active time (minutes)"
                          subtitle=""
                        >
                          <md-outlined-text-field
                            type="number"
                            value={
                              settings["break_interval"] ||
                              settings["break_minutes"] ||
                              "60"
                            }
                            onInput={(e: any) => {
                              updateSetting("break_minutes", e.target.value);
                              updateSetting("break_interval", e.target.value);
                            }}
                            onBlur={(e: any) => {
                              updateSetting("break_minutes", e.target.value);
                              updateSetting("break_interval", e.target.value);
                            }}
                            style={{ width: 140 }}
                          />
                        </SettingRow>
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Snooze duration (minutes)"
                          subtitle=""
                        >
                          <md-outlined-text-field
                            type="number"
                            value={settings["break_snooze"] || "10"}
                            onInput={(e: any) =>
                              updateSetting("break_snooze", e.target.value)
                            }
                            onBlur={(e: any) =>
                              updateSetting("break_snooze", e.target.value)
                            }
                            style={{ width: 140 }}
                          />
                        </SettingRow>
                      </SettingSection>

                      <SettingSection label="Notifications">
                        <MdSwitchRow
                          title="Monthly Notification"
                          subtitle="Receive a popup summarizing total and average screen time at the end of the month."
                          checked={settings["monthly_notification"] === "1"}
                          onChange={(v) =>
                            updateSetting("monthly_notification", v ? "1" : "0")
                          }
                        />
                        <div
                          style={{
                            height: 1,
                            background: "var(--md-sys-color-outline-variant)",
                            margin: "0 20px",
                          }}
                        />
                        <SettingRow
                          title="Preview Monthly Report"
                          subtitle="View current month's detailed summary, daily average, and top applications."
                        >
                          <ChipButton
                            onClick={async () => {
                              try {
                                const rep =
                                  await invoke<MonthlyReportData>(
                                    "get_monthly_report",
                                  );
                                setMonthlyReport(rep);
                                setTimeout(
                                  () => monthlyDialogRef.current?.show(),
                                  50,
                                );
                              } catch (e) {
                                console.error(
                                  "Failed to load monthly report preview:",
                                  e,
                                );
                              }
                            }}
                          >
                            View Report
                          </ChipButton>
                        </SettingRow>
                      </SettingSection>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        )}
      </div>

      <md-dialog
        ref={dialogRef}
        type="alert"
        style={{ userSelect: "none", WebkitUserSelect: "none" }}
      >
        <div
          slot="headline"
          style={{ userSelect: "none", WebkitUserSelect: "none" }}
        >
          Confirm deletion
        </div>
        <div
          slot="content"
          id="reset-form"
          style={{ userSelect: "none", WebkitUserSelect: "none" }}
        >
          Are you sure you wish to permanently delete all screen time history?
          This cannot be undone.
        </div>
        <div slot="actions">
          <md-text-button onClick={() => dialogRef.current?.close()}>
            Cancel
          </md-text-button>
          <md-text-button
            style={
              { "--md-sys-color-primary": "var(--md-sys-color-error)" } as any
            }
            onClick={() => {
              dialogRef.current?.close();
              resetData();
            }}
          >
            Delete
          </md-text-button>
        </div>
      </md-dialog>

      <md-dialog
        ref={monthlyDialogRef}
        type="alert"
        style={{
          maxWidth: 500,
          width: "100%",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div
          slot="headline"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{ color: "var(--md-sys-color-primary)", fontSize: 26 }}
          >
            calendar_month
          </span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--md-sys-color-on-surface)",
            }}
          >
            {monthlyReport?.month_name
              ? `${monthlyReport.month_name} Summary`
              : "Monthly Screen Time Report"}
          </span>
        </div>
        <div
          slot="content"
          style={{
            maxHeight: "65vh",
            overflowY: "auto",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {monthlyReport && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Hero Total Stats */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--md-sys-color-on-surface-variant)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Total Screen Time
                  </div>
                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: "var(--md-sys-color-primary)",
                      marginTop: 2,
                    }}
                  >
                    {monthlyReport.hours}h {monthlyReport.mins}m
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--md-sys-color-on-surface-variant)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Active Days
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: "var(--md-sys-color-on-surface)",
                      marginTop: 2,
                    }}
                  >
                    {monthlyReport.active_days}{" "}
                    {monthlyReport.active_days === 1 ? "day" : "days"}
                  </div>
                </div>
              </div>

              {/* Stats Row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    background: "var(--md-sys-color-surface-container)",
                    borderRadius: 14,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--md-sys-color-on-surface-variant)",
                      fontWeight: 500,
                    }}
                  >
                    Daily Average
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--md-sys-color-on-surface)",
                      marginTop: 2,
                    }}
                  >
                    {monthlyReport.avg_hours}h {monthlyReport.avg_mins}m{" "}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: "var(--md-sys-color-on-surface-variant)",
                      }}
                    >
                      / day
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--md-sys-color-surface-container)",
                    borderRadius: 14,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--md-sys-color-on-surface-variant)",
                      fontWeight: 500,
                    }}
                  >
                    Most Active Day
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--md-sys-color-on-surface)",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={monthlyReport.most_active_day}
                  >
                    {monthlyReport.most_active_day}
                  </div>
                </div>
              </div>

              {/* Top Apps List */}
              {monthlyReport.top_apps && monthlyReport.top_apps.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--md-sys-color-on-surface-variant)",
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Top Applications
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {monthlyReport.top_apps.map((app, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "var(--md-sys-color-surface-container)",
                          borderRadius: 12,
                          padding: "10px 14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--md-sys-color-on-surface)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: "65%",
                            }}
                          >
                            {idx + 1}. {app.name}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: "var(--md-sys-color-on-surface-variant)",
                            }}
                          >
                            {app.time_str} {app.pct > 0 && `(${app.pct}%)`}
                          </span>
                        </div>
                        {app.pct > 0 && (
                          <div
                            style={{
                              width: "100%",
                              height: 4,
                              borderRadius: 99,
                              background:
                                "color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(2, app.pct))}%`,
                                height: "100%",
                                borderRadius: 99,
                                background: "var(--md-sys-color-primary)",
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div slot="actions">
          <md-text-button onClick={dismissMonthlyReport}>Got it</md-text-button>
        </div>
      </md-dialog>

      <md-dialog
        ref={updateDialogRef}
        type="alert"
        style={{
          maxWidth: 500,
          width: "100%",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div
          slot="headline"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{ color: "var(--md-sys-color-primary)", fontSize: 26 }}
          >
            system_update
          </span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--md-sys-color-on-surface)",
            }}
          >
            Update Available!
          </span>
        </div>
        <div
          slot="content"
          style={{
            maxHeight: "65vh",
            overflowY: "auto",
            paddingRight: 4,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {updateInfo && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Version Comparison Card */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--md-sys-color-surface-container)",
                  borderRadius: 14,
                  padding: "12px 16px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--md-sys-color-on-surface-variant)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Current
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "var(--md-sys-color-on-surface)",
                      marginTop: 2,
                    }}
                  >
                    v{updateInfo.current_version}
                  </div>
                </div>
                <span
                  className="material-symbols-rounded"
                  style={{ color: "var(--md-sys-color-primary)", fontSize: 22 }}
                >
                  arrow_forward
                </span>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--md-sys-color-primary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    New Version
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "var(--md-sys-color-primary)",
                      marginTop: 2,
                    }}
                  >
                    {updateInfo.latest_version.startsWith("v")
                      ? updateInfo.latest_version
                      : `v${updateInfo.latest_version}`}
                  </div>
                </div>
              </div>

              {/* Changelog */}
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--md-sys-color-on-surface-variant)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 6,
                  }}
                >
                  {updateInfo.release_name || "Changelog"}
                </div>
                <div
                  style={{
                    background: "var(--md-sys-color-surface-container)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    maxHeight: "26vh",
                    overflowY: "auto",
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--md-sys-color-on-surface)",
                    whiteSpace: "pre-wrap",
                    border: "1px solid var(--md-sys-color-outline-variant)",
                  }}
                >
                  {updateInfo.changelog || "No changelog provided."}
                </div>
              </div>

              {/* Download Progress */}
              {updateDownloading && (
                <div
                  style={{
                    background: "var(--md-sys-color-surface-container)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--md-sys-color-on-surface)",
                    }}
                  >
                    <span>
                      {downloadProgress?.percent && downloadProgress.percent >= 100
                        ? "Launching installer..."
                        : "Downloading update..."}
                    </span>
                    <span>
                      {downloadProgress?.percent
                        ? `${downloadProgress.percent.toFixed(0)}%`
                        : "0%"}
                    </span>
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 6,
                      borderRadius: 99,
                      background:
                        "color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(3, downloadProgress?.percent || 0),
                        )}%`,
                        height: "100%",
                        borderRadius: 99,
                        background: "var(--md-sys-color-primary)",
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                  {downloadProgress?.total && downloadProgress.total > 0 ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--md-sys-color-on-surface-variant)",
                        textAlign: "right",
                      }}
                    >
                      {(downloadProgress.downloaded / 1048576).toFixed(1)} MB /{" "}
                      {(downloadProgress.total / 1048576).toFixed(1)} MB
                    </div>
                  ) : null}
                </div>
              )}

              {/* Error Alert */}
              {updateError && (
                <div
                  style={{
                    background: "var(--md-sys-color-error-container)",
                    color: "var(--md-sys-color-on-error-container)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {updateError}
                </div>
              )}
            </div>
          )}
        </div>
        <div slot="actions">
          <md-text-button
            disabled={updateDownloading}
            onClick={handleDismissUpdate}
          >
            Later
          </md-text-button>
          {updateInfo?.release_url && (
            <md-text-button
              disabled={updateDownloading}
              onClick={() => {
                invoke("open_external_url", { url: updateInfo.release_url }).catch(() => {
                  window.open(updateInfo.release_url, "_blank");
                });
              }}
            >
              View on GitHub
            </md-text-button>
          )}
          <md-text-button
            disabled={updateDownloading}
            onClick={handleStartUpdate}
          >
            {updateDownloading
              ? "Installing..."
              : updateInfo?.asset_url
                ? "Update Now"
                : "Download"}
          </md-text-button>
        </div>
      </md-dialog>
    </>
  );
}

// ── Reusable sub-components ───────────────────────────────────────────────────

function TitleBarButton({
  children,
  onClick,
  hoverBg,
  hoverColor,
  "aria-label": label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  hoverBg: string;
  hoverColor?: string;
  "aria-label": string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        background: hovered ? hoverBg : "transparent",
        color:
          hovered && hoverColor
            ? hoverColor
            : "var(--md-sys-color-on-surface-variant)",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function ChipButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "6px 16px",
        borderRadius: 99,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        background: "var(--md-sys-color-secondary-container)",
        color: "var(--md-sys-color-on-secondary-container)",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "inherit",
      }}
    >
      <md-ripple />
      {children}
    </button>
  );
}

function SimpleDatePicker({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const [curr, setCurr] = useState(() => {
    const parts = value.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  });

  const m = curr.getMonth();
  const y = curr.getFullYear();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const todayStr = formatLocalDate();
  const todayParts = todayStr.split("-");
  const todayY = Number(todayParts[0]);
  const todayM = Number(todayParts[1]) - 1;
  const todayD = Number(todayParts[2]);

  const isCurrentMonth = y === todayY && m === todayM;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="ast-card"
      onClick={(e) => e.stopPropagation()}
      style={{
        padding: 16,
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 8,
        zIndex: 100,
        width: 280,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        border: "1px solid var(--md-sys-color-outline-variant)",
        overflow: "visible",
        cursor: "default",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <button
          style={{
            width: 32,
            height: 32,
            padding: 4,
            borderRadius: 16,
            cursor: "pointer",
            background: "transparent",
            border: "none",
            color: "var(--md-sys-color-on-surface)",
          }}
          onClick={() => setCurr(new Date(y, m - 1, 1))}
        >
          <span className="material-symbols-rounded">chevron_left</span>
        </button>
        <span
          style={{ fontWeight: 500, color: "var(--md-sys-color-on-surface)" }}
        >
          {curr.toLocaleString("default", { month: "long", year: "numeric" })}
        </span>
        <button
          style={{
            width: 32,
            height: 32,
            padding: 4,
            borderRadius: 16,
            background: "transparent",
            border: "none",
            cursor: isCurrentMonth ? "default" : "pointer",
            visibility: isCurrentMonth ? "hidden" : "visible",
            color: "var(--md-sys-color-on-surface)",
          }}
          onClick={() => {
            if (!isCurrentMonth) setCurr(new Date(y, m + 1, 1));
          }}
        >
          <span className="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          textAlign: "center",
          fontSize: 14,
        }}
      >
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div
            key={d}
            style={{
              color: "var(--md-sys-color-on-surface-variant)",
              fontSize: 12,
              paddingBottom: 8,
            }}
          >
            {d}
          </div>
        ))}
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isSel = dateStr === value;
          const isToday = dateStr === todayStr;
          const isFuture =
            y > todayY ||
            (y === todayY && m > todayM) ||
            (isCurrentMonth && d > todayD);

          return (
            <div
              key={i}
              onClick={() => {
                if (!isFuture) {
                  onChange(dateStr);
                  onClose();
                }
              }}
              style={{
                cursor: isFuture ? "default" : "pointer",
                width: 32,
                height: 32,
                margin: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: isSel
                  ? "var(--md-sys-color-primary)"
                  : "transparent",
                color: isSel
                  ? "var(--md-sys-color-on-primary)"
                  : isToday
                    ? "var(--md-sys-color-primary)"
                    : "var(--md-sys-color-on-surface)",
                opacity: isFuture ? 0.38 : 1,
                fontWeight: isSel || isToday ? 700 : 400,
              }}
            >
              {d}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function TimeFlow({
  secs,
  style,
  prefix,
}: {
  secs: number;
  style?: React.CSSProperties;
  prefix?: string;
}) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;

  const isSeconds = h === 0 && m === 0;
  const subVal = isSeconds ? s : m;
  const subSuffix = isSeconds ? "s" : "m";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {prefix && <span style={{ marginRight: 6 }}>{prefix}</span>}
      <NumberFlowGroup>
        <AnimatePresence initial={false}>
          {h > 0 && (
            <motion.div
              key="hours-unit"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ type: "spring", duration: 0.9, bounce: 0 }}
              style={{
                overflow: "hidden",
                display: "inline-flex",
                alignItems: "baseline",
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  paddingRight: 8,
                }}
              >
                <NumberFlow
                  value={h}
                  suffix="h"
                  willChange
                  plugins={[continuous]}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ display: "inline-flex", alignItems: "baseline" }}>
          <NumberFlow
            value={subVal}
            suffix={subSuffix}
            willChange
            plugins={[continuous]}
          />
        </div>
      </NumberFlowGroup>
    </div>
  );
}

function SettingSection({
  label,
  labelColor = "var(--md-sys-color-primary)",
  children,
}: {
  label: string;
  labelColor?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p
        className="md-typescale-label-small"
        style={{
          color: labelColor,
          marginBottom: 8,
          paddingLeft: 4,
        }}
      >
        {label}
      </p>
      <div className="ast-card">{children}</div>
    </section>
  );
}

function SettingRow({
  title,
  subtitle,
  infoTooltip,
  children,
}: {
  title: string | React.ReactNode;
  subtitle: string;
  infoTooltip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 20px",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <p
            className="md-typescale-title-medium"
            style={{ color: "var(--md-sys-color-on-surface)", margin: 0 }}
          >
            {title}
          </p>
          {infoTooltip}
        </div>
        <p
          className="md-typescale-body-medium"
          style={{
            color: "var(--md-sys-color-on-surface-variant)",
            marginTop: 2,
            margin: 0,
          }}
        >
          {subtitle}
        </p>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function MdSwitchRow({
  title,
  subtitle,
  checked,
  onChange,
  divider = false,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  divider?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);

  // Keep the element's `.selected` property in sync with React state
  useEffect(() => {
    const el = ref.current as any;
    if (el) el.selected = checked;
  }, [checked]);

  // Listen to native `change` event from the web component
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => onChange((e.target as any).selected);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [onChange]);

  return (
    <>
      <SettingRow title={title} subtitle={subtitle}>
        <md-switch ref={ref as any} />
      </SettingRow>
      {divider && (
        <div
          style={{
            height: 1,
            background: "var(--md-sys-color-outline-variant)",
            margin: "0 20px",
          }}
        />
      )}
    </>
  );
}

function MdCheckboxItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current as any;
    if (el) el.checked = checked;
  }, [checked]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => onChange((e.target as any).checked);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [onChange]);

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        color: "var(--md-sys-color-on-surface)",
        padding: "4px 0",
      }}
    >
      {createElement("md-checkbox", { ref: ref as any })}
      {label}
    </label>
  );
}
