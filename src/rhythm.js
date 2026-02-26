/**
 * rhythm.js — Core logic for rhythm-encoded passwords.
 *
 * A "beat password" is a sequence of characters plus the normalized timing
 * ratios between consecutive keypresses.  Normalizing by the minimum inter-key
 * delay makes the encoding tempo-independent: the same rhythm typed fast or
 * slow produces the same ratio vector.
 *
 * Compact storage format:
 *   Each character except the last is followed by a 3-digit zero-padded
 *   integer representing the ratio × 10 (i.e. one decimal place, shifted).
 *   The final character stands alone.
 *
 *   Length rule: (string.length + 3) / 4 = number of password characters.
 *
 * Example for "hey!" typed with delays [120, 360, 120]:
 *   h010e030y010!
 *   (ratios 1.0, 3.0, 1.0 → integers 010, 030, 010)
 */

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Given raw inter-key delays (ms), return ratios normalized so the
 * shortest delay equals 1.0, each rounded to one decimal place.
 */
export function normalizeDelays(delays) {
    if (delays.length === 0) return []
    const min = Math.min(...delays)
    if (min === 0) return delays.map(() => 1.0)
    return delays.map((d) => Math.round((d / min) * 10) / 10)
}

// ─── Encoding / Decoding ────────────────────────────────────────────────────

/**
 * Encode characters + normalized ratios into compact storage string.
 * Format: char + 3-digit ratio for each char except the last.
 * Ratios are × 10 and clamped to 0–999.
 *
 * @param {string[]} chars  — array of single characters
 * @param {number[]} ratios — normalizeDelays result (length = chars.length - 1)
 * @returns {string}
 */
export function encode(chars, ratios) {
    let out = ""
    for (let i = 0; i < chars.length; i++) {
        out += chars[i]
        if (i < ratios.length) {
            const v = Math.min(999, Math.max(0, Math.round(ratios[i] * 10)))
            out += String(v).padStart(3, "0")
        }
    }
    return out
}

/**
 * Decode a compact storage string back to { chars, ratios }.
 * Every 4-char group is: 1 char + 3 digits.  The final char stands alone.
 */
export function decode(str) {
    const chars = []
    const ratios = []
    let i = 0
    while (i < str.length) {
        chars.push(str[i])
        i++
        if (i + 2 < str.length) {
            const digits = str.slice(i, i + 3)
            const v = parseInt(digits, 10)
            if (!isNaN(v)) {
                ratios.push(v / 10)
                i += 3
            }
        }
    }
    return { chars, ratios }
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Compare an attempt against a stored beat-password.
 *
 * @param {string} stored       — the encoded storage string
 * @param {string[]} attemptChars
 * @param {number[]} attemptDelays — raw ms delays (length = attemptChars.length - 1)
 * @param {number} tolerance    — allowed relative error per ratio (0.30 = 30 %)
 * @returns {{ match: boolean, charMatch: boolean, details: object[] }}
 */
export function verify(stored, attemptChars, attemptDelays, tolerance = 0.3) {
    const { chars: storedChars, ratios: storedRatios } = decode(stored)
    const attemptRatios = normalizeDelays(attemptDelays)

    // Characters must match exactly
    const charMatch = storedChars.length === attemptChars.length && storedChars.every((c, i) => c === attemptChars[i])

    // Build per-gap detail
    const details = storedRatios.map((sr, i) => {
        const ar = attemptRatios[i] ?? null
        if (ar === null) return { stored: sr, attempt: null, error: 1, pass: false }
        const error = Math.abs(sr - ar) / Math.max(sr, 0.1)
        return { stored: sr, attempt: ar, error: Math.round(error * 100) / 100, pass: error <= tolerance }
    })

    // If attempt has more gaps than stored, those are automatic fails
    for (let i = storedRatios.length; i < attemptRatios.length; i++) {
        details.push({ stored: null, attempt: attemptRatios[i], error: 1, pass: false })
    }

    const rhythmMatch = details.length > 0 && details.every((d) => d.pass)
    return { match: charMatch && rhythmMatch, charMatch, rhythmMatch, details }
}

// ─── Share helpers ──────────────────────────────────────────────────────────

export function toShareString(encoded) {
    return btoa(encodeURIComponent(encoded))
}

export function fromShareString(b64) {
    try {
        return decodeURIComponent(atob(b64))
    } catch (_e) {
        return null
    }
}
