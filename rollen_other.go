// SPDX-License-Identifier: Apache-2.0

//go:build !darwin

package main

// rollenUebersetzen: Unter Linux und Windows baut Wails die Standardmenues
// nicht mit festen Texten in eine native Menueleiste wie auf dem Mac; dort
// gibt es nichts umzubenennen (Linux/Windows folgen eigens, Jan 06.10.2026).
func rollenUebersetzen(map[string]string) {}
