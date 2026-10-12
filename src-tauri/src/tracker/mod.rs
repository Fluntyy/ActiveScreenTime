pub mod windows;
pub use windows::run_tracker;

/// Cross-platform tracker event emitted from the background thread
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum TrackerEvent {
    Active {
        process_name: String,
        exe_path: String,
        window_title: String,
        media_playing: bool,
    },
    Idle {
        reason: IdleReason,
    },
}

#[derive(Debug, Clone)]
pub enum IdleReason {
    UserIdle,
    Paused,
    SystemUI,
    NoWindow,
}

/// Context passed to custom advanced rule script (future Lua/Rhai support)
#[derive(Debug, Clone)]
pub struct TrackContext {
    pub process_name: String,
    pub window_title: String,
    pub exe_path: String,
    pub idle_seconds: f64,
    pub is_fullscreen: bool,
    pub media_playing: bool,
    pub pid: u32,
}

/// Evaluate the counting decision given a context and settings
pub fn should_count(ctx: &TrackContext, idle_timeout: u64, count_fullscreen: bool, js_rule: &str) -> bool {
    let not_idle = ctx.idle_seconds < idle_timeout as f64;
    let default_decision = not_idle || (count_fullscreen && ctx.is_fullscreen) || ctx.media_playing;

    if js_rule.trim().is_empty() {
        return default_decision;
    }

    use boa_engine::{Context, Source};
    use boa_engine::object::ObjectInitializer;
    use boa_engine::property::Attribute;
    use boa_engine::string::JsString;
    use boa_engine::js_string;

    let mut context = Context::default();
    
    let exe_name = std::path::Path::new(&ctx.exe_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&ctx.process_name);

    // Inject `ctx` object
    let ctx_obj = ObjectInitializer::new(&mut context)
        .property(js_string!("process_name"), JsString::from(ctx.process_name.as_str()), Attribute::READONLY)
        .property(js_string!("app_name"), JsString::from(ctx.process_name.as_str()), Attribute::READONLY)
        .property(js_string!("exe_name"), JsString::from(exe_name), Attribute::READONLY)
        .property(js_string!("window_title"), JsString::from(ctx.window_title.as_str()), Attribute::READONLY)
        .property(js_string!("title"), JsString::from(ctx.window_title.as_str()), Attribute::READONLY)
        .property(js_string!("exe_path"), JsString::from(ctx.exe_path.as_str()), Attribute::READONLY)
        .property(js_string!("idle_seconds"), ctx.idle_seconds, Attribute::READONLY)
        .property(js_string!("is_fullscreen"), ctx.is_fullscreen, Attribute::READONLY)
        .property(js_string!("media_playing"), ctx.media_playing, Attribute::READONLY)
        .property(js_string!("pid"), ctx.pid, Attribute::READONLY)
        .build();

    let _ = context.register_global_property(js_string!("ctx"), ctx_obj, Attribute::READONLY);

    // Wrap script so that:
    // 1. If user wrote explicit `return ...`, wrap in IIFE: `(function() { <code> })()`
    // 2. If user wrote a bare expression like `false` or `ctx.idle_seconds < 10`, wrap with return: `(function() { return (<code>); })()`
    let trimmed = js_rule.trim();
    let wrapped_script = if trimmed.contains("return") {
        format!("(function() {{ {} \n}})()", trimmed)
    } else {
        format!("(function() {{ return ({}); \n}})()", trimmed)
    };

    match context.eval(Source::from_bytes(wrapped_script.as_bytes())) {
        Ok(value) => {
            if value.is_boolean() {
                return value.as_boolean().unwrap_or(default_decision);
            }
            default_decision
        }
        Err(err) => {
            eprintln!("JS eval error: {:?}", err);
            default_decision
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_custom_rule() {
        let ctx = TrackContext {
            process_name: "Code".into(),
            window_title: "VS Code".into(),
            exe_path: "C:\\code.exe".into(),
            idle_seconds: 0.0,
            is_fullscreen: false,
            media_playing: false,
            pid: 1234,
        };

        // 1. Explicit return false
        assert_eq!(should_count(&ctx, 300, true, "return false;"), false);
        assert_eq!(should_count(&ctx, 300, true, "return false"), false);

        // 2. Bare expression false
        assert_eq!(should_count(&ctx, 300, true, "false"), false);

        // 3. Conditional return false
        assert_eq!(should_count(&ctx, 300, true, "if (ctx.process_name === 'Code') return false;"), false);

        // 4. Conditional return true
        assert_eq!(should_count(&ctx, 300, true, "if (ctx.process_name === 'Code') return true;"), true);

        // 5. Condition doesn't match -> fallback to default (not_idle = true)
        assert_eq!(should_count(&ctx, 300, true, "if (ctx.process_name === 'Notepad') return false;"), true);
    }
}
