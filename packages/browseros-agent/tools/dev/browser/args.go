package browser

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"browseros-dev/proc"
)

type ArgsConfig struct {
	Root              string
	Ports             proc.Ports
	UserDataDir       string
	Headless          bool
	LoadDevExtensions bool
}

// hasNvidiaGPU detects NVIDIA GPU on Linux by checking /proc/modules and /dev/dri.
func hasNvidiaGPU() bool {
	if data, err := os.ReadFile("/proc/modules"); err == nil {
		if contains(string(data), "nvidia") {
			return true
		}
	}
	if matches, _ := filepath.Glob("/dev/dri/by-path/*-nvidia*"); len(matches) > 0 {
		return true
	}
	return false
}

// contains checks if s contains substr (case-insensitive).
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		match := true
		for j := 0; j < len(substr); j++ {
			sc := s[i+j]
			tc := substr[j]
			if sc >= 'A' && sc <= 'Z' {
				sc += 32
			}
			if tc >= 'A' && tc <= 'Z' {
				tc += 32
			}
			if sc != tc {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

// resolveBrowserBinary returns the BrowserOS executable path for the current OS.
func resolveBrowserBinary() string {
	if runtime.GOOS == "linux" {
		// Check BROWSEROS_APP_PATH env first, then default location
		if p := os.Getenv("BROWSEROS_APP_PATH"); p != "" {
			return p
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Downloads", "alta", "BrowserOS.AppImage")
	}
	return "/Applications/BrowserOS.app/Contents/MacOS/BrowserOS"
}

func BuildArgs(cfg ArgsConfig) []string {
	binary := resolveBrowserBinary()

	args := []string{binary}

	// GPU workaround: NVIDIA + Chromium + Wayland = SIGILL crashes
	// --use-angle=vulkan bypasses the broken EGL/GBM shared memory path
	// See: scripts/gpu-flags.sh for full evidence + references
	if runtime.GOOS == "linux" && os.Getenv("BROWSEROS_SKIP_GPU_FLAGS") == "" {
		if gpuFlags := os.Getenv("BROWSEROS_GPU_FLAGS"); gpuFlags != "" {
			// Respect env override from mise/shell wrapper
			args = append(args, gpuFlags)
		} else if hasNvidiaGPU() {
			args = append(args, "--use-angle=vulkan")
		}
	}

	if cfg.LoadDevExtensions {
		args = append(args, "--no-first-run", "--no-default-browser-check")
	}

	args = append(args,
		"--use-mock-keychain",
		"--show-component-extension-options",
		"--disable-browseros-server",
	)

	if runtime.GOOS == "linux" {
		// --class sets the GTK application ID for GNOME taskbar association
		args = append(args, "--class=browseros-dev")
	} else {
		args = append(args, "--browseros-dock-icon=dev")
	}

	if cfg.LoadDevExtensions {
		args = append(args, "--disable-browseros-extensions")
	} else {
		args = append(args, "--enable-logging=stderr")
	}

	if cfg.Headless {
		args = append(args, "--headless=new")
	}

	args = append(args,
		fmt.Sprintf("--remote-debugging-port=%d", cfg.Ports.CDP),
		fmt.Sprintf("--browseros-mcp-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-server-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-proxy-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-extension-port=%d", cfg.Ports.Extension),
		"--remote-allow-origins=*",
		fmt.Sprintf("--user-data-dir=%s", cfg.UserDataDir),
	)

	if cfg.LoadDevExtensions {
		agentExtDir := filepath.Join(cfg.Root, "apps/agent/dist/chrome-mv3-dev")
		args = append(args, fmt.Sprintf("--load-extension=%s", agentExtDir))
		args = append(args, "chrome://newtab")
	}

	return args
}
