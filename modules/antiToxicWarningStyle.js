"use strict"

const MAX_HISTORY = 600
const lastByPeer = new Map()

const GROUP_OPENINGS = [
    "jaga bahasanya, ya",
    "kata-katanya ditahan dulu",
    "tolong pilih kata yang lebih baik",
    "obrolannya jangan dibawa kasar",
    "santai, tidak perlu pakai kata begitu",
    "boleh beda pendapat, tetap jaga tutur",
    "emosinya direm, bahasanya dirapikan",
    "mari tetap saling menghormati",
    "hindari kata yang bisa melukai",
    "cukup sampai di sini kata kasarnya",
    "suasananya kita jaga tetap sehat",
    "teguran singkat: jangan ulangi bahasa itu",
]

const PRIVATE_OPENINGS = [
    "tolong jaga bahasanya, ya",
    "kata-katanya ditahan dulu, ya",
    "coba pilih kata yang lebih baik",
    "tidak perlu memakai kata sekasar itu",
    "santai dulu dan rapikan bahasanya",
    "boleh kesal, tetapi tetap jaga tutur",
    "emosinya direm sebentar, ya",
    "mari tetap saling menghormati",
    "hindari kata yang bisa melukai",
    "cukup sampai di sini kata kasarnya",
    "obrolannya kita jaga tetap sehat",
    "jangan ulangi bahasa seperti itu, ya",
]

const CLOSINGS = [
    "Ucapan yang baik menjaga harga diri.",
    "Kata yang tenang lebih mudah diterima.",
    "Menahan lisan sering lebih kuat daripada membalas.",
    "Jaga rasa, jaga kata, jaga sesama.",
    "Tutur yang baik membuat ruang bicara tetap aman.",
    "Satu kata baik bisa meredakan banyak hal.",
]

function clipSentence(value, max = 112) {
    const clean = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
    if (!clean) return ""
    if (clean.length <= max) return /[.!?]$/.test(clean) ? clean : `${clean}.`
    const clipped = clean.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[,:;\s]+$/, "")
    return `${clipped || clean.slice(0, max - 1)}…`
}

function chooseIndex(length, lastSignature, random = Math.random) {
    if (length <= 1) return 0
    let index = Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * length)
    if (String(index) === String(lastSignature)) index = (index + 1) % length
    return index
}

function remember(peerKey, signature) {
    lastByPeer.delete(peerKey)
    lastByPeer.set(peerKey, signature)
    while (lastByPeer.size > MAX_HISTORY) lastByPeer.delete(lastByPeer.keys().next().value)
}

function mentionTag(jid) {
    const user = String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "")
    return user ? `@${user}` : "@pengguna"
}

function buildWarning(options = {}) {
    const scope = options.scope === "group" ? "group" : "private"
    const peerKey = String(options.peerKey || `${scope}:${options.mentionJid || options.firstName || "unknown"}`)
    const previous = lastByPeer.get(peerKey) || ""
    const openings = scope === "group" ? GROUP_OPENINGS : PRIVATE_OPENINGS
    const previousOpening = previous.split(":")[0]
    const openingIndex = chooseIndex(openings.length, previousOpening, options.random)
    let closingIndex = chooseIndex(CLOSINGS.length, previous.split(":")[1], options.random)
    if (`${openingIndex}:${closingIndex}` === previous) closingIndex = (closingIndex + 1) % CLOSINGS.length
    const signature = `${openingIndex}:${closingIndex}`
    remember(peerKey, signature)

    const quote = clipSentence(options.quote?.quote || "", 108) || CLOSINGS[closingIndex]
    const evidence = clipSentence(options.evidence || "", 118)
    if (scope === "group") {
        const tag = mentionTag(options.mentionJid)
        return {
            text: [`⚠️ ATTENTION ${tag}, ${openings[openingIndex]}.`, evidence, quote].filter(Boolean).join("\n"),
            mentions: options.mentionJid ? [options.mentionJid] : [],
            signature,
        }
    }

    const firstName = String(options.firstName || "Kak").trim() || "Kak"
    return {
        text: [`${firstName}, ${openings[openingIndex]}.`, evidence, quote].filter(Boolean).join("\n"),
        signature,
    }
}

function resetHistory() {
    lastByPeer.clear()
}

module.exports = {
    buildWarning,
    clipSentence,
    resetHistory,
    _GROUP_OPENINGS: GROUP_OPENINGS,
    _PRIVATE_OPENINGS: PRIVATE_OPENINGS,
}
