"use strict"

const { inspectBaileysCapabilities } = require("./baileysCapabilities")
const groupRuntimePolicy = require("./groupRuntimePolicy")

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map()

function normalizeKnownUserJid(value) {
    const jid = groupRuntimePolicy.normalizeJid(value)
    return /@(s\.whatsapp\.net|lid|hosted)$/i.test(jid) ? jid : ""
}

function cacheKey(jid) {
    return String(jid || "").toLowerCase()
}

function getCached(jid, now = Date.now()) {
    const entry = cache.get(cacheKey(jid))
    if (!entry || now - entry.at > CACHE_TTL_MS) {
        cache.delete(cacheKey(jid))
        return null
    }
    return entry.value
}

function remember(jid, value, now = Date.now()) {
    cache.set(cacheKey(jid), { at: now, value })
    while (cache.size > 100) cache.delete(cache.keys().next().value)
    return value
}

async function lookupKnownUsername(sock, jid, options = {}) {
    const target = normalizeKnownUserJid(jid)
    if (!target) throw new Error("Target harus berupa JID akun yang sudah dikenal")
    const capabilities = inspectBaileysCapabilities({ baileys: options.baileys, sock })
    if (!capabilities.usernameUsync) return { supported: false, username: null }
    const cached = getCached(target, options.now)
    if (cached) return { ...cached, cached: true }

    const USyncQuery = options.baileys.USyncQuery
    const USyncUser = options.baileys.USyncUser
    const query = new USyncQuery().withUsernameProtocol().withUser(new USyncUser().withId(target))
    const result = await sock.executeUSyncQuery(query)
    const row = (result?.list || []).find(item => normalizeKnownUserJid(item?.id) === target) || result?.list?.[0]
    return remember(target, {
        supported: true,
        username: typeof row?.username === "string" ? row.username.slice(0, 100) : null,
        cached: false,
    }, options.now)
}

async function handleUsernameCommand(sock, msg, context = {}) {
    const text = String(context.text || "").trim()
    if (!/^\.username(?:\s|$)/i.test(text)) return false
    if (context.isGroup) return true
    if (!(context.canControlOwner || context.isOwner)) {
        await sock.sendMessage(context.replyJid || context.from, { text: "Akses Ditolak" }, { quoted: msg })
        return true
    }
    const from = context.replyJid || context.from
    const argument = text.replace(/^\.username\b/i, "").trim()
    const capabilities = inspectBaileysCapabilities({ baileys: context.baileys, sock })
    if (!argument || /^status$/i.test(argument)) {
        await sock.sendMessage(from, {
            text: [
                `Username USync lookup: ${capabilities.usernameUsync ? "SUPPORTED" : "UNSUPPORTED"}`,
                "Mutation username: UNSUPPORTED pada socket aktif.",
                "Lookup hanya untuk akun sendiri atau kontak tersimpan yang sudah dikenal; tidak ada enumerasi massal.",
                "Format: .username me | .username lookup <JID kontak tersimpan>",
            ].join("\n"),
        }, { quoted: msg })
        return true
    }

    let target = ""
    if (/^me$/i.test(argument)) target = normalizeKnownUserJid(sock?.user?.id || sock?.authState?.creds?.me?.id)
    else target = normalizeKnownUserJid(argument.replace(/^lookup\s+/i, ""))
    if (!target) {
        await sock.sendMessage(from, { text: "Target username tidak valid." }, { quoted: msg })
        return true
    }
    const isSelf = groupRuntimePolicy.getBotIdentityCandidates(sock)
        .some(candidate => groupRuntimePolicy.jidUser(candidate) === groupRuntimePolicy.jidUser(target))
    const saved = isSelf || Boolean(context.contactNameStore?.resolveSavedContactName?.(target))
    if (!saved) {
        await sock.sendMessage(from, { text: "Lookup ditolak: target bukan akun sendiri/kontak tersimpan yang terverifikasi." }, { quoted: msg })
        return true
    }
    try {
        const result = await lookupKnownUsername(sock, target, { baileys: context.baileys })
        const status = !result.supported ? "tidak tersedia pada versi aktif"
            : (result.username ? `tersedia: @${result.username.replace(/^@/, "")}` : "akun tidak mengembalikan username")
        await sock.sendMessage(from, { text: `Username lookup: ${status}${result.cached ? " (cache)" : ""}` }, { quoted: msg })
    } catch (error) {
        await sock.sendMessage(from, { text: `Username lookup gagal aman: ${String(error?.message || error).slice(0, 160)}` }, { quoted: msg })
    }
    return true
}

module.exports = {
    CACHE_TTL_MS,
    handleUsernameCommand,
    lookupKnownUsername,
    normalizeKnownUserJid,
}
