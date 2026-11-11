"use strict"

const crypto = require("crypto")
const { inspectBaileysCapabilities } = require("./baileysCapabilities")

const PREVIEW_TTL_MS = 2 * 60 * 1000
const ACTION_COOLDOWN_MS = 30 * 1000
const previews = new Map()
let lastActionAt = 0

function normalizeNewsletterTarget(value) {
    const clean = String(value || "").trim()
    if (/^[0-9]+@newsletter$/i.test(clean)) return { type: "jid", key: clean.toLowerCase() }
    const invite = clean.match(/(?:whatsapp\.com\/channel\/|^)([A-Za-z0-9_-]{8,})$/i)
    return invite ? { type: "invite", key: invite[1] } : null
}

function safeMetadata(metadata) {
    return {
        id: String(metadata?.id || metadata?.jid || "").slice(0, 120),
        name: String(metadata?.name || metadata?.thread_metadata?.name?.text || "Channel tanpa nama").slice(0, 120),
        description: String(metadata?.description || metadata?.thread_metadata?.description?.text || "").slice(0, 240),
        subscribers: Number(metadata?.subscribers || metadata?.subscribers_count || 0) || null,
    }
}

function createToken() {
    return crypto.randomBytes(3).toString("hex").toUpperCase()
}

function prune(now = Date.now()) {
    for (const [token, preview] of previews) {
        if (now > preview.expiresAt) previews.delete(token)
    }
}

async function loadMetadata(sock, target) {
    if (typeof sock?.newsletterMetadata !== "function") return null
    return sock.newsletterMetadata(target.type, target.key)
}

function formatPreview(action, metadata, token) {
    const data = safeMetadata(metadata)
    return [
        `Preview channel ${action.toUpperCase()}`,
        `Nama: ${data.name}`,
        data.description ? `Deskripsi: ${data.description}` : null,
        data.subscribers != null ? `Subscriber: ${data.subscribers}` : null,
        `Ketik .channel confirm ${token} dalam 2 menit, atau .channel cancel ${token}.`,
    ].filter(Boolean).join("\n")
}

async function handleNewsletterCommand(sock, msg, context = {}) {
    const text = String(context.text || "").trim()
    if (!/^\.channel(?:\s|$)/i.test(text)) return false
    if (context.isGroup) return true
    const from = context.replyJid || context.from
    if (!(context.canControlOwner || context.isOwner)) {
        await sock.sendMessage(from, { text: "Akses Ditolak" }, { quoted: msg })
        return true
    }
    prune()
    const parts = text.replace(/^\.channel\b/i, "").trim().split(/\s+/).filter(Boolean)
    const action = String(parts.shift() || "status").toLowerCase()
    const capabilities = inspectBaileysCapabilities({ baileys: context.baileys, sock })

    if (action === "status") {
        await sock.sendMessage(from, {
            text: [
                `Metadata: ${capabilities.newsletter.metadata ? "SUPPORTED" : "UNSUPPORTED"}`,
                `Follow: ${capabilities.newsletter.follow ? "SUPPORTED" : "UNSUPPORTED"}`,
                `Unfollow: ${capabilities.newsletter.unfollow ? "SUPPORTED" : "UNSUPPORTED"}`,
                "Owner-private, satu channel eksplisit, preview + konfirmasi wajib.",
                "Format: .channel info <JID/link> | follow <JID/link> | unfollow <JID/link>",
            ].join("\n"),
        }, { quoted: msg })
        return true
    }
    if (action === "cancel") {
        const token = String(parts[0] || "").toUpperCase()
        const removed = previews.delete(token)
        await sock.sendMessage(from, { text: removed ? "Aksi channel dibatalkan." : "Preview channel tidak ditemukan/kedaluwarsa." }, { quoted: msg })
        return true
    }
    if (action === "confirm") {
        const token = String(parts[0] || "").toUpperCase()
        const preview = previews.get(token)
        if (!preview || Date.now() > preview.expiresAt || preview.ownerChat !== from) {
            previews.delete(token)
            await sock.sendMessage(from, { text: "Preview channel tidak ditemukan/kedaluwarsa." }, { quoted: msg })
            return true
        }
        previews.delete(token)
        if (Date.now() - lastActionAt < ACTION_COOLDOWN_MS) {
            await sock.sendMessage(from, { text: "Aksi channel sedang cooldown. Buat preview baru setelah 30 detik." }, { quoted: msg })
            return true
        }
        const method = preview.action === "follow" ? "newsletterFollow" : "newsletterUnfollow"
        if (typeof sock?.[method] !== "function") {
            await sock.sendMessage(from, { text: "Operasi channel tidak tersedia pada socket aktif." }, { quoted: msg })
            return true
        }
        lastActionAt = Date.now()
        try {
            await sock[method](preview.jid)
            await sock.sendMessage(from, { text: `Channel berhasil di-${preview.action}.` }, { quoted: msg })
        } catch (error) {
            await sock.sendMessage(from, { text: `Operasi channel gagal aman: ${String(error?.message || error).slice(0, 160)}` }, { quoted: msg })
        }
        return true
    }
    if (!["info", "follow", "unfollow"].includes(action)) {
        await sock.sendMessage(from, { text: "Format: .channel status | info/follow/unfollow <JID/link>" }, { quoted: msg })
        return true
    }
    const target = normalizeNewsletterTarget(parts.join(" "))
    if (!target || !capabilities.newsletter.metadata) {
        await sock.sendMessage(from, { text: target ? "Metadata channel tidak tersedia pada socket aktif." : "JID/link channel tidak valid." }, { quoted: msg })
        return true
    }
    try {
        const metadataRaw = await loadMetadata(sock, target)
        if (!metadataRaw) throw new Error("metadata channel tidak ditemukan")
        const metadata = safeMetadata(metadataRaw)
        const jid = String(metadataRaw.id || metadataRaw.jid || (target.type === "jid" ? target.key : ""))
        if (action === "info") {
            await sock.sendMessage(from, { text: formatPreview("info", metadataRaw, "-" ).replace(/\nKetik[\s\S]*$/, "") }, { quoted: msg })
            return true
        }
        if (!/@newsletter$/i.test(jid)) throw new Error("metadata tidak mengembalikan JID channel valid")
        const token = createToken()
        previews.set(token, { action, jid, ownerChat: from, expiresAt: Date.now() + PREVIEW_TTL_MS })
        await sock.sendMessage(from, { text: formatPreview(action, metadata, token) }, { quoted: msg })
    } catch (error) {
        await sock.sendMessage(from, { text: `Metadata channel gagal aman: ${String(error?.message || error).slice(0, 160)}` }, { quoted: msg })
    }
    return true
}

module.exports = {
    ACTION_COOLDOWN_MS,
    PREVIEW_TTL_MS,
    handleNewsletterCommand,
    normalizeNewsletterTarget,
    safeMetadata,
}
