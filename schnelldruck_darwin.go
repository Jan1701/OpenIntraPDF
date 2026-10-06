// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package main

// schnelldruckBefehl: lpr druckt auf den Standarddrucker.
func schnelldruckBefehl() (string, bool) { return "lpr", true }
