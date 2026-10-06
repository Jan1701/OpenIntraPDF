// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !windows

package main

import (
	"os"
	"strings"
)

// systemSprachen: unter Linux in der Reihenfolge, die gettext nimmt --
// LANGUAGE (Liste mit Doppelpunkt), dann LC_ALL, LC_MESSAGES, LANG. „C“ und
// „POSIX“ sind keine Sprache.
func systemSprachen() []string {
	var liste []string
	for _, s := range strings.Split(os.Getenv("LANGUAGE"), ":") {
		liste = append(liste, s)
	}
	for _, v := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		liste = append(liste, os.Getenv(v))
	}
	var echt []string
	for _, s := range liste {
		if s != "" && !strings.HasPrefix(s, "C.") && s != "C" && s != "POSIX" {
			echt = append(echt, s)
		}
	}
	return echt
}
