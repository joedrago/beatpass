/**
 * ui.js — All DOM interaction for the BeatPass proof of concept.
 */

import { normalizeDelays, encode, decode, verify, toShareString, fromShareString } from "./rhythm.js"

// ─── State ──────────────────────────────────────────────────────────────────

let mode = "SET" // "SET" | "VERIFY"
let storedEncoded = null // the encoded beat-password string

// Current input session
let chars = []
let timestamps = [] // performance.now() of each keydown
let rawDelays = [] // ms between consecutive keys

// ─── DOM refs (filled on init) ──────────────────────────────────────────────

let $inputField,
    $timingViz,
    $statusBar,
    $modeLabel,
    $storedSection,
    $storedPlain,
    $storedEncoded,
    $storedRhythm,
    $resultPanel,
    $resultText,
    $resultDetails,
    $resetBtn,
    $shareBtn,
    $submitBtn,
    $keypadGrid,
    $toleranceSlider,
    $toleranceValue

// ─── Bootstrap ──────────────────────────────────────────────────────────────

export function init() {
    // Grab refs
    $inputField = document.getElementById("input-field")
    $timingViz = document.getElementById("timing-viz")
    $statusBar = document.getElementById("status-bar")
    $modeLabel = document.getElementById("mode-label")
    $storedSection = document.getElementById("stored-section")
    $storedPlain = document.getElementById("stored-plain")
    $storedEncoded = document.getElementById("stored-encoded")
    $storedRhythm = document.getElementById("stored-rhythm")
    $resultPanel = document.getElementById("result-panel")
    $resultText = document.getElementById("result-text")
    $resultDetails = document.getElementById("result-details")
    $resetBtn = document.getElementById("reset-btn")
    $shareBtn = document.getElementById("share-btn")
    $submitBtn = document.getElementById("submit-btn")
    $keypadGrid = document.getElementById("keypad-grid")
    $toleranceSlider = document.getElementById("tolerance-slider")
    $toleranceValue = document.getElementById("tolerance-value")

    // Events
    document.addEventListener("keydown", handleKeydown)
    $resetBtn.addEventListener("click", handleReset)
    $shareBtn.addEventListener("click", handleShare)
    $submitBtn.addEventListener("click", handleSubmit)
    $toleranceSlider.addEventListener("input", () => {
        $toleranceValue.textContent = `${$toleranceSlider.value}%`
    })

    buildKeypad()
    checkUrlForShared()
    resetInput()
    renderMode()
}

// ─── Keypad ─────────────────────────────────────────────────────────────────

function buildKeypad() {
    const rows = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"]
    const specials = ["!", "@", "#", "$", ".", "BK", "OK"]

    for (const row of rows) {
        const rowDiv = document.createElement("div")
        rowDiv.className = "keypad-row"
        for (const ch of row) {
            addKeypadButton(ch, ch, rowDiv)
        }
        $keypadGrid.appendChild(rowDiv)
    }

    const rowDiv = document.createElement("div")
    rowDiv.className = "keypad-row"
    for (const sp of specials) {
        addKeypadButton(sp, sp, rowDiv)
    }
    $keypadGrid.appendChild(rowDiv)
}

function addKeypadButton(label, value, parent) {
    const btn = document.createElement("button")
    btn.className = "key-btn"
    btn.textContent = label
    btn.setAttribute("data-key", value)
    btn.addEventListener("pointerdown", (e) => {
        e.preventDefault() // prevent focus steal
        if (value === "OK") {
            handleSubmit()
        } else if (value === "BK") {
            handleBackspace()
        } else {
            injectKey(value)
        }
    })
    parent.appendChild(btn)
}

// ─── Input handling ─────────────────────────────────────────────────────────

function handleKeydown(e) {
    // Ignore modifier-only keys
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return

    if (e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
        return
    }

    if (e.key === "Backspace") {
        e.preventDefault()
        handleBackspace()
        return
    }

    // Only single printable characters
    if (e.key.length === 1) {
        e.preventDefault()
        injectKey(e.key)
    }
}

function injectKey(ch) {
    const now = performance.now()
    if (chars.length > 0) {
        rawDelays.push(Math.round(now - timestamps[timestamps.length - 1]))
    }
    chars.push(ch)
    timestamps.push(now)
    renderInput()
}

function handleBackspace() {
    if (chars.length === 0) return
    chars.pop()
    timestamps.pop()
    if (rawDelays.length > chars.length - 1 && rawDelays.length > 0) {
        rawDelays.pop()
    }
    renderInput()
}

function resetInput({ clearResult = true } = {}) {
    chars = []
    timestamps = []
    rawDelays = []
    renderInput()
    if (clearResult) {
        $resultPanel.classList.add("hidden")
    }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderInput() {
    // Password field (masked)
    $inputField.textContent = chars.map(() => "\u2022").join("") || "\u00A0"

    // Timing visualisation
    if (chars.length === 0) {
        $timingViz.innerHTML = '<span class="viz-placeholder">start typing&hellip;</span>'
        return
    }

    const ratios = normalizeDelays(rawDelays)
    let html = ""
    for (let i = 0; i < chars.length; i++) {
        html += `<span class="viz-char">${escapeHtml(chars[i])}</span>`
        if (i < rawDelays.length) {
            const gap = rawDelays[i]
            const ratio = ratios[i]
            html += `<span class="viz-gap" style="min-width:${Math.min(ratio * 24, 200)}px">`
            html += `<span class="viz-raw">${gap}ms</span>`
            html += `<span class="viz-ratio">${ratio.toFixed(1)}x</span>`
            html += `</span>`
        }
    }
    $timingViz.innerHTML = html
}

function renderMode() {
    if (mode === "SET") {
        $modeLabel.textContent = "SET PASSRHYTHM"
        $modeLabel.className = "mode-set"
        $statusBar.textContent = "Type your rhythm password, then press Enter / OK to store it."
        $storedSection.classList.add("hidden")
        $shareBtn.classList.add("hidden")
        $resetBtn.classList.add("hidden")
    } else {
        $modeLabel.textContent = "VERIFY PASSRHYTHM"
        $modeLabel.className = "mode-verify"
        $statusBar.textContent = "Now try to type the same password with the same rhythm."
        $storedSection.classList.remove("hidden")
        $shareBtn.classList.remove("hidden")
        $resetBtn.classList.remove("hidden")
    }
}

function renderStored() {
    if (!storedEncoded) return
    const { chars: sc, ratios: sr } = decode(storedEncoded)
    $storedPlain.textContent = sc.join("")

    // Rhythm bar
    let barHtml = ""
    for (let i = 0; i < sc.length; i++) {
        barHtml += `<span class="rhy-char">${escapeHtml(sc[i])}</span>`
        if (i < sr.length) {
            const w = Math.min(sr[i] * 24, 200)
            barHtml += `<span class="rhy-gap" style="min-width:${w}px">${sr[i].toFixed(1)}x</span>`
        }
    }
    $storedRhythm.innerHTML = barHtml

    $storedEncoded.textContent = storedEncoded
}

function renderResult(result) {
    $resultPanel.classList.remove("hidden")
    if (result.match) {
        $resultText.textContent = "ACCESS GRANTED"
        $resultText.className = "result-pass"
    } else {
        const reason = !result.charMatch ? "WRONG CHARACTERS" : "WRONG RHYTHM"
        $resultText.textContent = `ACCESS DENIED — ${reason}`
        $resultText.className = "result-fail"
    }

    // Detail table
    if (!result.charMatch) {
        $resultDetails.textContent = "Character mismatch — rhythm not evaluated."
        return
    }

    let html = '<table class="detail-table"><tr><th>Gap</th><th>Stored</th><th>Yours</th><th>Error</th><th></th></tr>'
    for (let i = 0; i < result.details.length; i++) {
        const d = result.details[i]
        const cls = d.pass ? "cell-pass" : "cell-fail"
        html += `<tr class="${cls}">`
        html += `<td>${i + 1}</td>`
        html += `<td>${d.stored !== null ? d.stored.toFixed(1) + "x" : "—"}</td>`
        html += `<td>${d.attempt !== null ? d.attempt.toFixed(1) + "x" : "—"}</td>`
        html += `<td>${(d.error * 100).toFixed(0)}%</td>`
        html += `<td>${d.pass ? "OK" : "FAIL"}</td>`
        html += `</tr>`
    }
    html += "</table>"
    $resultDetails.innerHTML = html
}

// ─── Actions ────────────────────────────────────────────────────────────────

function handleSubmit() {
    if (chars.length === 0) return

    if (mode === "SET") {
        const ratios = normalizeDelays(rawDelays)
        storedEncoded = encode(chars, ratios)
        mode = "VERIFY"
        renderStored()
        renderMode()
        resetInput()
    } else {
        const tol = parseInt($toleranceSlider.value, 10) / 100
        const result = verify(storedEncoded, chars, rawDelays, tol)
        renderResult(result)
        resetInput({ clearResult: false })
    }
}

function handleReset() {
    if (!confirm("Clear the stored passrhythm and start over?")) return
    storedEncoded = null
    mode = "SET"
    resetInput()
    renderMode()
    $resultPanel.classList.add("hidden")
    // Clear URL hash
    history.replaceState(null, "", window.location.pathname)
}

function handleShare() {
    if (!storedEncoded) return
    const b64 = toShareString(storedEncoded)
    const url = `${window.location.origin}${window.location.pathname}#${b64}`
    navigator.clipboard.writeText(url).then(() => {
        $statusBar.textContent = "Share link copied to clipboard!"
        setTimeout(() => {
            $statusBar.textContent = "Now try to type the same password with the same rhythm."
        }, 2500)
    })
}

function checkUrlForShared() {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const decoded = fromShareString(hash)
    if (!decoded) return
    storedEncoded = decoded
    mode = "VERIFY"
    renderStored()
    renderMode()
    $statusBar.textContent = "A friend shared a passrhythm with you — try to type it!"
}

// ─── Util ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
