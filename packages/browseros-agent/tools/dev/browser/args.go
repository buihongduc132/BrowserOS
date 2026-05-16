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
