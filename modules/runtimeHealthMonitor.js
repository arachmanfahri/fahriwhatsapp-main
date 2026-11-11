"use strict"

const { monitorEventLoopDelay } = require("perf_hooks")

const startedAt = Date.now()
let nowProvider = () => Date.now()
const alertTimes = new Map()
const loopDelay = monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()

const state = {
    connection: "unknown",
    reconnectAttempts: 0,
    reconnectReason: "",
    lastConnectionAt: null,
    lastAppStateAt: null,
    sendActive: 0,
    sendFailures: 0,
    sendSuccess: 0,
    retryCount: 0,
    mediaUploadErrors: 0,
    circuitOpen: false,
    circuitReason: "",
    circuitOpenedAt: null,
    sourceWatcherEnabled: false,
}

function sanitizeReason(value) {
    return String(value || "").replace(/[0-9]{6,}/g, "[redacted]").slice(0, 160)
}

function recordConnection(connection, details = {}) {
    state.connection = String(connection || "unknown")
    state.lastConnectionAt = nowProvider()
    if (details.reason) state.reconnectReason = sanitizeReason(details.reason)
    if (state.connection === "open") state.reconnectAttempts = 0
}

function recordReconnect(reason) {
    state.reconnectAttempts += 1
    state.reconnectReason = sanitizeReason(reason)
}

function recordAppState() {
    state.lastAppStateAt = nowProvider()
}

function beginSend() {
    state.sendActive += 1
}

function endSend(error) {
    state.sendActive = Math.max(0, state.sendActive - 1)
    if (error) state.sendFailures += 1
    else state.sendSuccess += 1
}

function recordRetry() {
    state.retryCount += 1
}

function recordMediaUploadError() {
    state.mediaUploadErrors += 1
}

function openCircuit(reason) {
    state.circuitOpen = true
    state.circuitReason = sanitizeReason(reason || "restricted")
    state.circuitOpenedAt = nowProvider()
}

function closeCircuit() {
    state.circuitOpen = false
    state.circuitReason = ""
    state.circuitOpenedAt = null
}

function setSourceWatcherEnabled(enabled) {
    state.sourceWatcherEnabled = Boolean(enabled)
}

function shouldEmitAlert(key, cooldownMs = 5 * 60 * 1000) {
    const clean = String(key || "").slice(0, 80)
    if (!clean) return false
    const now = nowProvider()
    const previous = Number(alertTimes.get(clean) || 0)
    if (previous && now - previous < Math.max(0, Number(cooldownMs) || 0)) return false
    alertTimes.set(clean, now)
    return true
}

function setClockForTest(provider) {
    nowProvider = typeof provider === "function" ? provider : (() => Date.now())
}

function getSnapshot() {
    const usage = process.memoryUsage()
    return {
        ...state,
        pid: process.pid,
        pm2Id: process.env.pm_id || null,
        uptimeSeconds: Math.max(0, Math.floor((nowProvider() - startedAt) / 1000)),
        memory: {
            rssBytes: usage.rss,
            heapUsedBytes: usage.heapUsed,
            heapTotalBytes: usage.heapTotal,
        },
        eventLoop: {
            meanMs: Number.isFinite(loopDelay.mean) ? loopDelay.mean / 1e6 : 0,
            p99Ms: Number.isFinite(loopDelay.percentile(99)) ? loopDelay.percentile(99) / 1e6 : 0,
        },
    }
}

function resetForTest() {
    alertTimes.clear()
    Object.assign(state, {
        connection: "unknown", reconnectAttempts: 0, reconnectReason: "", lastConnectionAt: null,
        lastAppStateAt: null, sendActive: 0, sendFailures: 0, sendSuccess: 0, retryCount: 0,
        mediaUploadErrors: 0, circuitOpen: false, circuitReason: "", circuitOpenedAt: null,
        sourceWatcherEnabled: false,
    })
}

module.exports = {
    beginSend,
    closeCircuit,
    endSend,
    getSnapshot,
    openCircuit,
    recordAppState,
    recordConnection,
    recordMediaUploadError,
    recordReconnect,
    recordRetry,
    resetForTest,
    setClockForTest,
    setSourceWatcherEnabled,
    shouldEmitAlert,
}
