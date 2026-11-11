"use strict"

function normalizeJid(value) {
    const raw = String(value || "").trim().toLowerCase()
    if (!raw) return ""
    const match = raw.match(/^([^@]+)@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/i)
    if (!match) return raw
    const user = match[1].split(":")[0].replace(/[^0-9]/g, "")
    return user ? `${user}@${match[2].toLowerCase()}` : ""
}

function uniqueJids(values = []) {
    return [...new Set((Array.isArray(values) ? values : [values]).map(normalizeJid).filter(Boolean))]
}

function socketSelfJids(sock) {
    return uniqueJids([
        sock?.user?.id,
        sock?.user?.lid,
        sock?.authState?.creds?.me?.id,
        sock?.authState?.creds?.me?.lid,
    ])
}

function expandAliases(values, lidAliasStore) {
    const output = uniqueJids(values)
    if (!lidAliasStore) return output
    if (typeof lidAliasStore.resolveBestJid === "function") {
        for (const jid of [...output]) {
            try {
                const resolved = normalizeJid(lidAliasStore.resolveBestJid(jid))
                if (resolved && !output.includes(resolved)) output.push(resolved)
            } catch {}
        }
    }
    if (typeof lidAliasStore.listAliases === "function") {
        try {
            for (const entry of lidAliasStore.listAliases() || []) {
                const lid = normalizeJid(entry?.lid)
                const pn = normalizeJid(entry?.pn)
                if (!lid || !pn) continue
                if (output.includes(lid) && !output.includes(pn)) output.push(pn)
                if (output.includes(pn) && !output.includes(lid)) output.push(lid)
            }
        } catch {}
    }
    return output
}

function buildExcludedJids(options = {}) {
    const provided = Array.isArray(options.ownerJids) ? options.ownerJids : [options.ownerJids]
    return new Set(expandAliases([
        ...provided,
        options.ownerJid,
        ...socketSelfJids(options.sock),
    ], options.lidAliasStore))
}

function isExcludedJid(value, excludedJids, options = {}) {
    const jid = normalizeJid(value)
    if (!jid) return false
    const excluded = excludedJids instanceof Set ? excludedJids : buildExcludedJids(options)
    if (excluded.has(jid)) return true
    if (options.lidAliasStore && typeof options.lidAliasStore.resolveBestJid === "function") {
        try {
            return excluded.has(normalizeJid(options.lidAliasStore.resolveBestJid(jid)))
        } catch {}
    }
    return false
}

function trustedContactJids(values, options = {}) {
    const excluded = options.excludedJids instanceof Set
        ? options.excludedJids
        : buildExcludedJids(options)
    return expandAliases(values, options.lidAliasStore)
        .filter(jid => !isExcludedJid(jid, excluded, options))
}

function sanitizeFirstName(value) {
    const clean = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim()
    if (!clean) return ""
    for (const token of clean.split(" ")) {
        const first = token.replace(/[^\p{L}\p{N}._'-]/gu, "").slice(0, 40)
        if (!first || !/\p{L}/u.test(first)) continue
        if (/whatsapp|\.net$|^lid$/i.test(first)) continue
        return first
    }
    return ""
}

function resolveSavedFirstName(contactNameStore, values, options = {}) {
    const candidates = trustedContactJids(values, options)
    if (!contactNameStore) return options.fallback || "Kak"
    if (typeof contactNameStore.resolveSavedContactFirstName === "function") {
        try {
            const firstName = sanitizeFirstName(contactNameStore.resolveSavedContactFirstName(candidates))
            if (firstName) return firstName
        } catch {}
    }
    if (typeof contactNameStore.resolveSavedContactName === "function") {
        for (const jid of candidates) {
            try {
                const firstName = sanitizeFirstName(contactNameStore.resolveSavedContactName(jid))
                if (firstName) return firstName
            } catch {}
        }
    }
    return options.fallback || "Kak"
}

module.exports = {
    buildExcludedJids,
    isExcludedJid,
    normalizeJid,
    resolveSavedFirstName,
    sanitizeFirstName,
    socketSelfJids,
    trustedContactJids,
    uniqueJids,
}
