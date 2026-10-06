// SPDX-License-Identifier: Apache-2.0

//go:build linux

package main

// schnelldruckBefehl: lp (CUPS) druckt auf den Standarddrucker.
func schnelldruckBefehl() (string, bool) { return "lp", true }
