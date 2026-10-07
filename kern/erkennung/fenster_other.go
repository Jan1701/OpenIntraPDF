// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package erkennung

import "os/exec"

// ohneFenster: nur unter Windows noetig (fenster_windows.go).
func ohneFenster(*exec.Cmd) {}
