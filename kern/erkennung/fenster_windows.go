// SPDX-License-Identifier: Apache-2.0

//go:build windows

package erkennung

import (
	"os/exec"
	"syscall"
)

// ohneFenster: Unter Windows bekommt jedes Konsolenprogramm, das ein
// Fensterprogramm startet, ein eigenes Konsolenfenster -- unter Windows 11
// ein ganzes Terminal (07.10.2026, Test-VM: beim Start der App und bei jeder
// Texterkennung ging eins auf). CREATE_NO_WINDOW unterdrueckt es.
func ohneFenster(befehl *exec.Cmd) {
	const createNoWindow = 0x08000000
	befehl.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
